/**
 * Registry for named prompt annotators (ADR 0011 §8).
 *
 * A downstream extension offers a named annotator via
 * `PermissionsService.registerAnnotator`; this registry stores it so the
 * `AnnotationRunner` can bind the operator's `annotatorChain` names to it. One
 * annotator per name; a duplicate registration throws.
 *
 * Registration alone shows nothing: an annotator runs only once the operator
 * names it in `annotatorChain` (the opt-in activation model, as for
 * `authorizerChain`). This registry is storage only.
 */

import type { PromptPayload } from "./prompt-payload";

/** What an annotator is shown. */
export interface AnnotatorInput {
  /** The complete payload the gate built (ADR 0011 §2); its annotations slot is empty. */
  readonly payload: PromptPayload;
  /** Aborted when the annotation deadline passes; an answer after that is discarded either way. */
  readonly signal: AbortSignal;
}

/**
 * An annotator: advisory text for the human deciding an ask, or `undefined` to
 * decline.
 *
 * The return type is the structural wall of ADR 0011 §8. It has no way to spell
 * allow, deny, defer, or "do not show this prompt": the chain's verdict type is
 * not reachable from it, so an annotator cannot influence the decision however
 * it is written. Attribution and the model-generated marking are stamped by
 * `AnnotationRunner` from the registered name, never supplied here.
 */
export type Annotator = (
  input: AnnotatorInput,
) => string | undefined | Promise<string | undefined>;

/** Read-only lookup used by the runner (ISP, mirroring `AuthorizerLookup`). */
export interface AnnotatorLookup {
  get(name: string): Annotator | undefined;
}

/** The write surface (ISP, mirroring `AuthorizerRegistrar`). */
export interface AnnotatorRegistrar {
  register(name: string, annotator: Annotator): () => void;
}

/**
 * Persistent registry mapping annotator names to their callbacks.
 *
 * Owned by the extension factory (`index.ts`) so one instance backs both the
 * `registerAnnotator` service surface and the runner's chain resolution.
 */
export class AnnotatorRegistry implements AnnotatorLookup, AnnotatorRegistrar {
  private readonly annotators = new Map<string, Annotator>();

  /**
   * Register `annotator` under `name`.
   *
   * Throws if a name is already taken, which keeps resolution deterministic.
   * Returns a disposer that is identity-guarded, so a stale call cannot evict a
   * later registration.
   */
  register(name: string, annotator: Annotator): () => void {
    if (this.annotators.has(name)) {
      throw new Error(`An annotator is already registered for '${name}'.`);
    }
    this.annotators.set(name, annotator);
    return () => {
      if (this.annotators.get(name) === annotator) {
        this.annotators.delete(name);
      }
    };
  }

  get(name: string): Annotator | undefined {
    return this.annotators.get(name);
  }
}
