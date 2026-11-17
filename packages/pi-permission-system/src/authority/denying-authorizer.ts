import type { TerminalAuthorizer } from "./authorizer";
import type { PermissionPromptDecision } from "./permission-dialog";

/** Why this authorizer denies; the provenance record's `reason` (#726). */
const NO_AUTHORITY_REASON = "No live authority was reachable for this session";

/**
 * Least-privilege Authorizer: no authority is reachable for this session
 * (no UI, not a subagent), so every ask is denied.
 *
 * The denial carries the `confirmationUnavailable` marker so the ask path can
 * distinguish "nobody could answer" from an interactive user denial when it
 * derives the review-entry and decision-event resolution.
 */
export class DenyingAuthorizer implements TerminalAuthorizer {
  authorize(): Promise<PermissionPromptDecision> {
    return Promise.resolve({
      approved: false,
      state: "denied",
      confirmationUnavailable: true,
      decidedBy: { kind: "unavailable", reason: NO_AUTHORITY_REASON },
    });
  }
}

/**
 * Why {@link NoForwardingParentAuthorizer} denies; the provenance record's
 * `reason` (#726), reused verbatim as the agent-facing `denialReason` so the
 * two cannot drift.
 */
const NO_FORWARDING_PARENT_REASON =
  "This subagent session names no serving parent to forward the approval to, " +
  "so the request was refused at once instead of waiting for a prompt no child " +
  "session can answer (set PI_SUBAGENT_PARENT_SESSION in the child environment)";

/**
 * Deny because a subagent's ask has nowhere to go: `selectAuthorizer` found a
 * context that is a child, has a UI of its own, and resolves no forwarding
 * target — a surface (e.g. an unattended herdr pane) where no human answers.
 * Failing at once beats opening the `promptTimeoutMs` window nobody will
 * close.
 *
 * Same `confirmationUnavailable` shape as {@link DenyingAuthorizer}: nobody
 * ruled, so the ask path must not report this as a user denial (#719).
 */
export class NoForwardingParentAuthorizer implements TerminalAuthorizer {
  authorize(): Promise<PermissionPromptDecision> {
    return Promise.resolve({
      approved: false,
      state: "denied",
      confirmationUnavailable: true,
      denialReason: NO_FORWARDING_PARENT_REASON,
      decidedBy: { kind: "unavailable", reason: NO_FORWARDING_PARENT_REASON },
    });
  }
}
