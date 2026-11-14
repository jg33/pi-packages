/**
 * annotation-runner.ts — Resolve the operator's `annotatorChain` and write the
 * answers into a prompt payload's annotations slot (ADR 0011 §8).
 *
 * The runner is the only writer of that slot, and the only thing that stamps an
 * annotation: `source` is the registered name and the marking is the slot's
 * own, so neither is a discipline an annotator author must remember. It authors
 * the slot — whatever arrived in `payload.annotations` is discarded before any
 * annotator runs, so the output is never a union with a foreign entry. Its
 * output is a payload, never a verdict — nothing here imports or produces one.
 */

import type { Annotator, AnnotatorLookup } from "./annotator-registry";
import {
  annotationSourceLabel,
  sanitizeAnnotationText,
} from "./printable-text";
import {
  modelGeneratedAnnotation,
  type PromptAnnotation,
  type PromptPayload,
} from "./prompt-payload";

/**
 * How long the chain may take when `annotatorTimeoutMs` is not configured.
 * Declared in the config layer so the generated schema stays self-contained;
 * re-exported here because this is where consumers expect it.
 */
export { DEFAULT_ANNOTATOR_TIMEOUT_MS } from "#src/config/config-schema";

/** The narrow log seam the runner needs (ISP): a durable record and an operator warning. */
export interface AnnotationAuditLog {
  review(event: string, details?: Record<string, unknown>): void;
  warn(message: string): void;
}

/** The seam `LocalUserAuthorizer` drives: the payload with this node's annotations in its slot. */
export interface PayloadAnnotator {
  /**
   * The payload to show. Returns `payload` itself when nothing was added, so
   * an unchanged prompt is the same object, not merely an equal one.
   */
  annotate(payload: PromptPayload, requestId: string): Promise<PromptPayload>;
}

export interface AnnotationRunnerDeps {
  registry: AnnotatorLookup;
  /** The operator's configured names, read live per ask. */
  getChain: () => readonly string[];
  /** The deadline for the whole chain, read live per ask. */
  getTimeoutMs: () => number;
  log: AnnotationAuditLog;
}

interface NamedAnnotator {
  readonly name: string;
  readonly annotate: Annotator;
}

/**
 * What the deadline resolves to, so a timeout is distinguishable from an
 * annotator that declined (`undefined`).
 */
const TIMED_OUT = Symbol("annotator-timed-out");

/** Longest error name a review record carries, so the log stays bounded. */
const MAX_LOGGED_ERROR_NAME = 64;

/** What an error whose name cannot be read is reported as. */
const UNREADABLE_ERROR_NAME = "unreadable";

/** Whether this annotator's outcome has already been recorded. */
interface Outcome {
  settled: boolean;
}

/**
 * The error's *name* for the review log, never its message: a model call's
 * message can echo the request into the bounded log (ADR 0011 §6).
 *
 * Unreadable on purpose — `instanceof` and the `name` read can both throw (a
 * revoked proxy, a getter that throws), and this runs in the isolation path, so
 * nothing here may escape: an error path that throws would lose a healthy
 * sibling's annotation.
 */
function errorNameForLog(error: unknown): string {
  let isError: boolean;
  try {
    isError = error instanceof Error;
  } catch {
    return UNREADABLE_ERROR_NAME;
  }
  if (!isError) {
    return "non-error throw";
  }
  let name: unknown;
  try {
    name = (error as Error).name;
  } catch {
    return UNREADABLE_ERROR_NAME;
  }
  if (typeof name !== "string") {
    return UNREADABLE_ERROR_NAME;
  }
  // The name is attacker-influenced text bound for a bounded log: strip
  // control/format characters and cap it like any other label.
  const bounded = annotationSourceLabel(name, MAX_LOGGED_ERROR_NAME);
  return bounded === "" ? UNREADABLE_ERROR_NAME : bounded;
}

/**
 * The agent-facing text for a configured annotator that is not registered here.
 *
 * Names the likeliest cause and admits the other, as `unregisteredLinkMessage`
 * does: registration is honored any time before a prompt, so it may yet arrive.
 */
export function unregisteredAnnotatorMessage(name: string): string {
  return (
    `pi-permission-system: annotatorChain names "${name}", but no annotator ` +
    "with that name is registered in this session, so this prompt is shown " +
    "without it. Most often the extension providing the annotator is not " +
    "loaded here; it may also have failed to load. Every skipped prompt is " +
    "recorded in the permission review log as " +
    "annotator_chain_unregistered_link."
  );
}

export class AnnotationRunner implements PayloadAnnotator {
  private readonly warned = new Set<string>();

  constructor(private readonly deps: AnnotationRunnerDeps) {}

  async annotate(
    payload: PromptPayload,
    requestId: string,
  ): Promise<PromptPayload> {
    // The slot is this package's to author (ADR 0011 §8), so a foreign entry is
    // dropped before any annotator sees it and before the payload is returned.
    const own =
      payload.annotations.length === 0
        ? payload
        : { ...payload, annotations: [] };
    const annotators = this.resolve(requestId);
    if (annotators.length === 0) {
      return own;
    }
    // One deadline for the whole chain: annotators run together, so the prompt
    // is delayed by at most the timeout however long the chain is (ADR 0011 §8).
    const controller = new AbortController();
    const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve(TIMED_OUT), {
        once: true,
      });
    });
    const timer = setTimeout(
      () => controller.abort(),
      this.deps.getTimeoutMs(),
    );
    try {
      const answers = await Promise.all(
        annotators.map(async ({ name, annotate }) => {
          const outcome: Outcome = { settled: false };
          const answer = await Promise.race([
            this.consult(
              name,
              annotate,
              own,
              controller.signal,
              requestId,
              outcome,
            ),
            deadline,
          ]);
          if (answer === TIMED_OUT) {
            // Exactly one outcome per annotator per ask: a late failure must
            // not append a second record for the same name.
            if (!outcome.settled) {
              outcome.settled = true;
              this.record("annotator_timed_out", { requestId, name });
            }
            return undefined;
          }
          return answer;
        }),
      );
      const annotations = answers.filter(
        (answer): answer is PromptAnnotation => answer !== undefined,
      );
      return annotations.length === 0 ? own : { ...own, annotations };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The configured names that resolve, in config order. An unregistered name is
   * skipped fail-safe (more prompting, never less) and audited.
   *
   * A name configured twice runs twice, matching `resolveConfiguredLinks`: the
   * operator wrote it twice, and a duplicate advisory costs a row, not a
   * decision.
   */
  private resolve(requestId: string): NamedAnnotator[] {
    const resolved: NamedAnnotator[] = [];
    for (const name of this.deps.getChain()) {
      const annotate = this.deps.registry.get(name);
      if (annotate === undefined) {
        this.auditUnregistered(name, requestId);
        continue;
      }
      resolved.push({ name, annotate });
    }
    return resolved;
  }

  /**
   * One annotator's answer. Never rejects: a throw is the same as a decline,
   * because an annotator that fails must not be able to stop the prompt (ADR
   * 0011 §8, "unchanged-prompt fallback"). A late result after the deadline is
   * ignored by the race, and a late rejection still lands here, so none is left
   * unhandled.
   */
  private async consult(
    name: string,
    annotate: Annotator,
    payload: PromptPayload,
    signal: AbortSignal,
    requestId: string,
    outcome: Outcome,
  ): Promise<PromptAnnotation | undefined> {
    try {
      return toAnnotation(name, await annotate({ payload, signal }));
    } catch (error) {
      // Only the outcome that won the race is recorded (one per annotator per
      // ask), and the error's name is read safely (see `errorNameForLog`).
      if (!outcome.settled) {
        outcome.settled = true;
        this.record("annotator_failed", {
          requestId,
          name,
          error: errorNameForLog(error),
        });
      }
      return undefined;
    }
  }

  /** A review record; a broken sink must not reject the prompt path. */
  private record(event: string, details: Record<string, unknown>): void {
    try {
      this.deps.log.review(event, details);
    } catch {
      // Losing one audit record is cheaper than losing a prompt or a sibling
      // annotator's answer.
    }
  }

  /** An operator warning; same contract as `record`. */
  private report(message: string): void {
    try {
      this.deps.log.warn(message);
    } catch {
      // Same contract as `record`.
    }
  }

  /**
   * Record the skip for every ask (the auditor's durable record) and warn the
   * operator once per name (the person about to answer a prompt the annotator
   * should have annotated). Same two rates, and same reason, as
   * `AuthorizerChainAudit`.
   */
  private auditUnregistered(name: string, requestId: string): void {
    this.record("annotator_chain_unregistered_link", { requestId, name });
    if (this.warned.has(name)) {
      return;
    }
    this.warned.add(name);
    this.report(unregisteredAnnotatorMessage(name));
  }
}

/**
 * An answer as an annotation, or `undefined` when it says nothing.
 *
 * The `typeof` check is a runtime guard for an untyped caller: the type says
 * `string | undefined`, but a JavaScript annotator can return anything, and
 * only text becomes an annotation.
 *
 * Length is deliberately uncapped here: the renderer bounds every fact with
 * `capField` (`fieldMaxWidth`), so a huge answer costs rows, not the terminal.
 * Sanitization and its documented limits live in `printable-text.ts`.
 */
function toAnnotation(
  name: string,
  text: unknown,
): PromptAnnotation | undefined {
  if (typeof text !== "string") {
    return undefined;
  }
  const clean = sanitizeAnnotationText(text);
  return clean === "" ? undefined : modelGeneratedAnnotation(name, clean);
}
