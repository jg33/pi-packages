import type { PromptAction } from "#src/config/dialog-keys";
import type { SessionGrantWidth } from "#src/session/approval-grant";
import type { DecisionSource } from "./decision-source";

export type PermissionDecisionState =
  | "approved"
  | "approved_for_session"
  | "approved_for_serving_session"
  | "denied"
  | "denied_with_reason";

export type PermissionPromptDecision = {
  approved: boolean;
  state: PermissionDecisionState;
  denialReason?: string;
  /**
   * True when no human ever ruled on this ask: either no live authority was
   * reachable at all (`DenyingAuthorizer`, a no-UI non-subagent session) or the
   * forwarding path gave up before reaching one (`ParentAuthorizer` — target
   * unresolvable, request undeliverable, target not serving, or no answer
   * within the timeout), or a prompt was shown and nobody answered it within
   * its `promptTimeoutMs` window (`AnswerWindow`). Consumed by the gate (block reason) and
   * `PermissionPrompter` (review-entry resolution) to report
   * "confirmation_unavailable" rather than a plain user denial — a user who
   * was never asked denied nothing (#719). The decision-event resolution
   * reads the `unavailable` decider below instead (#772).
   */
  confirmationUnavailable?: true;
  /**
   * How wide a whole-session grant the human chose, when they chose one.
   *
   * Orthogonal to `state` rather than a value of it: the two directions and
   * the subagent/serving scope vary independently, and an unrecognized `state`
   * is rejected outright by the forwarded-response reader, where an
   * unrecognized field is merely dropped. Absent means `"proven"` — the
   * direction the gate named, which is what every producer chose before #813.
   */
  sessionGrantWidth?: SessionGrantWidth;
  /**
   * What decided this request, stamped by the site that decided it.
   *
   * Required: every decision names its decider, and the type is what
   * guarantees it rather than a convention each producer has to remember — the
   * same discipline `PromptPermissionDetails.payload` carries (#726).
   */
  decidedBy: DecisionSource;
};

/**
 * A decision before its decider is known.
 *
 * The inner producers — the dialog's decision model, the `select`/`input`
 * fallback, the verdict mapper — state the outcome; which decider to attribute
 * it to is settled one layer up, at the site that chose the producer. The same
 * shape `GateBypass.decision` uses for the request id: a producer emits only
 * what it knows.
 */
export type UnattributedDecision = Omit<PermissionPromptDecision, "decidedBy">;

/** What the fallback hands each host dialog: the signal that may dismiss it. */
export interface PermissionDialogOptions {
  signal?: AbortSignal;
}

/**
 * The decisions the one-step prompt can offer.
 *
 * `denyWithReason` has no row: gate-authored denial reasons ride the config,
 * and the interactive prompt decides in one round.
 */
export type PromptOptionAction = Exclude<PromptAction, "denyWithReason">;

/** One numbered row of the prompt. */
export interface PromptOptionRow {
  readonly action: PromptOptionAction;
  readonly label: string;
}

/**
 * The prompt's option rows, in display order — the one source every surface
 * renders: the inline dialog's numbered rows, the `select`/`input` fallback's
 * option list, and (through `visibleActions`) the roster herdr's Asks panel
 * adopts as its buttons.
 *
 * The labels are the fixed one-step roster: `allow` / the session row /
 * `allow for all agents` when a scope choice applies / `deny`. Only the
 * gate-supplied `sessionLabel` refines the session row's text; `forwarded`
 * names whose session that row grants (the requesting subagent's, not the
 * serving session's).
 */
export function promptOptions(
  options?: Pick<
    RequestPermissionOptions,
    "sessionLabel" | "forwarded" | "sessionScope"
  >,
): readonly PromptOptionRow[] {
  const rows: PromptOptionRow[] = [
    { action: "approve", label: "allow" },
    {
      action: "approveSession",
      label:
        options?.sessionLabel ??
        (options?.forwarded ? "allow for this agent" : "allow for all agents"),
    },
  ];
  if (options?.sessionScope) {
    rows.push({ action: "approveSessionBoth", label: "allow for all agents" });
  }
  rows.push({ action: "deny", label: "deny" });
  return rows;
}

export interface PermissionDecisionUi {
  select(
    title: string,
    options: string[],
    opts?: PermissionDialogOptions,
  ): Promise<string | undefined>;
}

export function normalizePermissionDenialReason(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createDeniedPermissionDecision(
  denialReason?: string,
): UnattributedDecision {
  const normalizedReason = normalizePermissionDenialReason(denialReason);
  return normalizedReason
    ? {
        approved: false,
        state: "denied_with_reason",
        denialReason: normalizedReason,
      }
    : {
        approved: false,
        state: "denied",
      };
}

export function isPermissionDecisionState(
  value: unknown,
): value is PermissionDecisionState {
  return (
    value === "approved" ||
    value === "approved_for_session" ||
    value === "approved_for_serving_session" ||
    value === "denied" ||
    value === "denied_with_reason"
  );
}

export interface RequestPermissionOptions {
  /** Override the session option's label (e.g. to show the suggested pattern). */
  sessionLabel?: string;
  /**
   * Present iff this ask was forwarded from a subagent: without it the
   * session row grants the serving session's own, not the requester's.
   */
  forwarded?: boolean;
  /**
   * Forwarded asks carrying a scope choice (the child's gate suggested
   * session grants): adds the whole-serving-session row beside the
   * requesting-subagent one.
   */
  sessionScope?: boolean;
}

/**
 * Ask through the host's `select`/`input` dialogs.
 *
 * `signal` reaches every dialog, and the host resolves a dismissed one
 * `undefined` — the same value a human cancel produces. The two are told apart
 * by the signal: an `undefined` while it is aborted answers `undefined` (the
 * prompt was dismissed, so no human ruled), and one while it is live keeps its
 * meaning as the human's cancel.
 */
export async function requestPermissionDecisionFromUi(
  ui: PermissionDecisionUi,
  title: string,
  message: string,
  options?: RequestPermissionOptions,
  signal?: AbortSignal,
): Promise<UnattributedDecision | undefined> {
  const dialogOptions: PermissionDialogOptions = { signal };
  const dismissed = (answer: string | undefined): boolean =>
    answer === undefined && signal?.aborted === true;
  const rows = promptOptions(options);

  const selected = await ui.select(
    `${title}\n${message}`,
    rows.map((row) => row.label),
    dialogOptions,
  );
  if (dismissed(selected)) {
    return undefined;
  }

  // A cancelled select (undefined, signal live) falls through to deny, the
  // same answer the old trailing fallthrough gave it.
  switch (rows.find((row) => row.label === selected)?.action) {
    case "approve":
      return { approved: true, state: "approved" };
    case "approveSession":
      return { approved: true, state: "approved_for_session" };
    case "approveSessionBoth":
      return { approved: true, state: "approved_for_serving_session" };
    default:
      return createDeniedPermissionDecision();
  }
}
