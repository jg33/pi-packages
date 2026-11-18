/**
 * The `model-summary` prompt annotator: one model call per ask, returned as
 * advisory text, with the jev auto-mode weights appended when the ask's
 * authorizer trail carries them.
 *
 * Three rules make it safe to sit in a permission prompt:
 *
 * 1. **Advisory only.** The return type is `string | undefined` — the seam's
 *    structural wall (ADR 0011 §8). Nothing here can allow, deny, defer, or
 *    suppress an ask, and no fact on the payload is written to.
 * 2. **Weights are optional and never invented.** The jev line comes only from
 *    a `jev_authorizer_verdict` entry that actually carries numbers; a verdict,
 *    a threshold, or a probability that is absent stays absent.
 * 3. **Every failure falls back.** No config, no model, failed auth, timeout,
 *    throw, or an empty reply returns `undefined` (the unannotated prompt) — or,
 *    when the trail already has weights, a deterministic weights-only line —
 *    and records why in the review log.
 */

import type { PromptPayload } from "@gotgenes/pi-permission-system";

import type { ModelAnnotatorConfig } from "./config-schema";
import {
  formatJevStatus,
  formatJevWeights,
  type JevVerdictFacts,
  readJevVerdict,
} from "./jev-weights";
import {
  type CompleteFn,
  type ModelRegistryLike,
  renderAskPrompt,
  summarize,
} from "./summary";

/** The name the operator puts in `annotatorChain` to activate this annotator. */
export const ANNOTATOR_NAME = "model-summary";

/** The review-log event: one positive record per ask this annotator handles. */
export const DECISION_EVENT = "model_annotator.decision";

/**
 * The review-log seam an annotator receives from `AnnotationRunner`. Declared
 * structurally because the published permission-system types this package
 * compiles against predate the seam; a host that does not pass one simply gets
 * no audit entry.
 */
export interface AnnotatorLogLike {
  review(event: string, details?: Record<string, unknown>): void;
}

/** The annotator input, with the audit seam optional for older hosts. */
export interface AnnotatorInputLike {
  readonly payload: PromptPayload;
  readonly signal: AbortSignal;
  readonly requestId?: string;
  readonly log?: AnnotatorLogLike;
}

/** An annotator's answer: text, or `undefined` to decline. */
export type PromptAnnotator = (
  input: AnnotatorInputLike,
) => string | undefined | Promise<string | undefined>;

/** Collaborators, injected so the extension and tests wire them. */
export interface ModelAnnotatorDeps {
  /** The loaded config, read live per ask (absent until session config loads). */
  getConfig: () => ModelAnnotatorConfig | undefined;
  /** The session model registry, read live (captured at `session_start`). */
  getRegistry: () => ModelRegistryLike | undefined;
  /** The model-completion seam (production: `complete` from pi-ai). */
  complete: CompleteFn;
}

/** Why an ask produced no model text. */
type FallbackReason =
  | "model-unresolved"
  | "auth-failed"
  | "timeout"
  | "call-failed"
  | "empty-reply";

/** The deterministic line shown when the model produced nothing usable. */
function weightsOnlyLine(
  jev: JevVerdictFacts | undefined,
  weights: string | undefined,
): string | undefined {
  const status = formatJevStatus(jev);
  if (status === null && weights === undefined) {
    return undefined;
  }
  if (status === null) {
    return `jev-auto-mode: ${weights}`;
  }
  return weights === undefined
    ? `jev-auto-mode: ${status}`
    : `jev-auto-mode: ${status} — ${weights}`;
}

/** Append the jev line to the model's prose, when there is one to append. */
function withJevLine(
  text: string,
  jev: JevVerdictFacts | undefined,
  weights: string | undefined,
): string {
  const status = formatJevStatus(jev);
  if (status === null) {
    return text;
  }
  const jevLine =
    weights === undefined ? `jev ${status}` : `jev ${status}: ${weights}`;
  return `${text.replace(/\s+$/, "")} — ${jevLine}`;
}

/** Build the `annotate` callback registered on the chain. */
export function createModelAnnotator(
  deps: ModelAnnotatorDeps,
): PromptAnnotator {
  return async ({ payload, signal, requestId, log }) => {
    const config = deps.getConfig();
    if (config === undefined) {
      return undefined;
    }

    const jev = readJevVerdict(payload);
    const weights = config.includeJevWeights
      ? formatJevWeights(jev)
      : undefined;
    const modelId = `${config.provider}/${config.model}`;

    const record = (details: Record<string, unknown>): void => {
      try {
        log?.review(DECISION_EVENT, {
          ...(requestId === undefined ? {} : { requestId }),
          modelId,
          ...details,
        });
      } catch {
        // An audit entry is worth less than the annotation itself.
      }
    };

    const fallback = (
      reason: FallbackReason,
      modelCalled = false,
    ): string | undefined => {
      const line = weightsOnlyLine(jev, weights);
      record({
        status: "fallback",
        reason,
        modelCalled,
        latencyMs: null,
        api: null,
        weights: jev?.weights ?? null,
        weightsShown: weights ?? null,
        textLength: line?.length ?? null,
      });
      return line;
    };

    const registry = deps.getRegistry();
    if (registry === undefined) {
      return fallback("model-unresolved");
    }
    const model = registry.find(config.provider, config.model);
    if (model === undefined) {
      return fallback("model-unresolved");
    }
    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      return fallback("auth-failed");
    }

    const outcome = await summarize({
      config,
      model,
      complete: deps.complete,
      prompt: renderAskPrompt(payload, jev),
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal,
    });

    if (outcome.text === undefined) {
      return fallback(outcome.failure ?? "call-failed", true);
    }

    const text = withJevLine(outcome.text, jev, weights);
    record({
      status: "annotated",
      reason: null,
      modelCalled: true,
      latencyMs: outcome.latencyMs,
      api: outcome.api,
      weights: jev?.weights ?? null,
      weightsShown: weights ?? null,
      textLength: text.length,
    });
    return text;
  };
}
