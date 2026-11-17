/**
 * The authorizer chain's review trail, captured per ask for the annotator
 * (asks-parity plan item 5, D4: read the ranking off the existing authorizer
 * result — no new model call).
 *
 * `escalate` hands the links a pass-through log so their `review` calls —
 * pi-jev-auto-mode's `jev_authorizer_verdict` above all — are both forwarded
 * to the session log and remembered against this ask's details object. The
 * terminal then attaches them to the payload it hands the annotator.
 *
 * Keyed by the details object, which every layer passes through unchanged
 * (`escalate` → prompter → chain → terminal), so asks in flight cannot read
 * each other's trail and the entry dies with the ask — a `WeakMap`, so there
 * is no cleanup step to forget.
 */
import type {
  AuthorizerReviewEntry,
  PromptPayload,
} from "#src/presentation/prompt-payload";
import type { AuthorizerLog } from "#src/service";
import type { PromptPermissionDetails } from "./permission-prompter";

const trails = new WeakMap<PromptPermissionDetails, AuthorizerReviewEntry[]>();

/**
 * A pass-through `AuthorizerLog` for one ask: every `review` call is recorded
 * against `details` and forwarded to `base`; `debug` only forwards — the debug
 * stream is not the decision trail.
 */
export function captureAuthorizerContext(
  details: PromptPermissionDetails,
  base: AuthorizerLog,
): AuthorizerLog {
  const captured: AuthorizerReviewEntry[] = [];
  trails.set(details, captured);
  return {
    review: (event, entry) => {
      captured.push(
        entry === undefined ? { event } : { event, details: entry },
      );
      base.review(event, entry);
    },
    debug: (event, entry) => base.debug(event, entry),
  };
}

/** The trail captured for this ask, if a chain captured one. */
export function authorizerContext(
  details: PromptPermissionDetails,
): readonly AuthorizerReviewEntry[] | undefined {
  return trails.get(details);
}

/**
 * The payload with this ask's trail attached for the annotate call.
 *
 * Identity when nothing was captured — a chain that wrote no review entry
 * hands the annotator exactly what it handed the dialog — and otherwise a
 * spread, so `request` and `evidence` keep the identity
 * `isRenderablePayload` requires.
 */
export function withAuthorizerContext(
  payload: PromptPayload,
  details: PromptPermissionDetails,
): PromptPayload {
  const captured = trails.get(details);
  return captured !== undefined && captured.length > 0
    ? { ...payload, authorizerContext: captured }
    : payload;
}
