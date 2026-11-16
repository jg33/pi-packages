import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PayloadAnnotator } from "#src/presentation/annotation-runner";
import {
  buildDirectionalSessionLabels,
  buildPathAccessSessionLabel,
  describeGrantTarget,
} from "#src/presentation/pattern-suggest";
import {
  describePromptNotice,
  type NotificationSession,
} from "#src/presentation/prompt-notification";
import {
  isRenderablePayload,
  type PromptPayload,
} from "#src/presentation/prompt-payload";
import {
  emitUiPromptEvent,
  type PermissionEventBus,
} from "#src/service/permission-events";
import { buildUiPrompt } from "#src/service/permission-ui-prompt";
import { provenDirectionOf } from "#src/session/approval-grant";
import type { AskDialogAdmission } from "./ask-dialog-queue";
import type { TerminalAuthorizer } from "./authorizer";
import { withAuthorizerContext } from "./authorizer-context";
import type {
  PermissionPromptDecision,
  RequestPermissionOptions,
} from "./permission-dialog";
import type {
  PermissionPromptUi,
  PromptPreferences,
  requestPermissionDecision,
} from "./permission-prompt-component";
import type { PromptPermissionDetails } from "./permission-prompter";

/**
 * What the terminal's own ceiling resolves to, so it is distinguishable from
 * an annotated payload.
 */
const ANNOTATOR_CEILING = Symbol("annotator-ceiling");

/**
 * Slack above the runner's own deadline. `AnnotationRunner` resolves at
 * `annotatorTimeoutMs`, so this ceiling only fires for an implementation that
 * ignores the contract; the margin keeps a well-behaved runner from losing a
 * race against its own deadline on a busy event loop. The guarantee: a broken
 * annotator delays one ask by at most `annotatorTimeoutMs + 250` ms, and never
 * blocks the next one.
 */
const ANNOTATOR_GUARD_GRACE_MS = 250;

/** Dependencies required by {@link LocalUserAuthorizer}. */
export interface LocalUserAuthorizerDeps {
  /** The active session's UI surface (select/input plus the inline `custom` dialog). */
  ui: PermissionPromptUi;
  /** The session run mode; the dispatcher renders the inline dialog only in `"tui"`. */
  mode: ExtensionContext["mode"];
  /** Event bus used for the `permissions:ui_prompt` broadcast. */
  events: PermissionEventBus;
  /** Serializes this session's dialogs so no ask replaces another (#965). */
  dialogs: AskDialogAdmission;
  /** Read live at prompt time so a settings-modal toggle takes effect on the next prompt. */
  getPromptPreferences: () => PromptPreferences;
  /** Injected for testability; production callers pass the real function. */
  requestPermissionDecision: typeof requestPermissionDecision;
  /** Read when each prompt opens, so a session named mid-session is picked up. */
  describeSession: () => NotificationSession;
  /** Writes this node's annotations into the payload the human is shown (ADR 0011 §8). */
  annotator: PayloadAnnotator;
  /**
   * The operator's annotator deadline, read live. The terminal uses it as the
   * base for its own containment ceiling, so a misbehaving `annotator` cannot
   * stall the ask beyond the configured wait.
   */
  getAnnotatorTimeoutMs: () => number;
}

/**
 * Authorizer for a session with an active UI: prompt the human here.
 *
 * Emits the `permissions:ui_prompt` broadcast (moved here from
 * `PermissionPrompter`'s `ctx.hasUI` arm) before showing the dialog, so
 * observers know a decision is imminent. This is the single emit site: a
 * forwarded ask carries its provenance on `details.forwarding`, which this
 * class renders (populated `forwarding` context + "(Subagent)" title) so the
 * broadcast stays non-degraded (#292) without a second emission path.
 *
 * Every ask goes through the session's `AskDialogAdmission`, because the host
 * holds one inline dialog slot: a second presentation mounts over the first and
 * strands its promise (#965).
 */
export class LocalUserAuthorizer implements TerminalAuthorizer {
  constructor(private readonly deps: LocalUserAuthorizerDeps) {}

  authorize(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    return this.deps.dialogs.run(() => this.present(details), releasedDecision);
  }

  /**
   * Annotate, announce, then show it.
   *
   * All three live inside the queued region: `permissions:ui_prompt` is
   * documented as firing immediately before the user-facing UI is invoked, so
   * an emit at admission would alert a notification consumer for a dialog that
   * is still minutes of deliberation away.
   */
  private async present(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    // Annotated first, inside the queued region: the broadcast below is
    // documented as firing immediately before the user-facing UI, and the
    // payload the human sees is the only one that carries annotations — the
    // broadcast stays built from the original `details` (ADR 0011 §6).
    const payload = await this.annotated(details);
    emitUiPromptEvent(this.deps.events, buildUiPrompt(details));
    const title = details.forwarding
      ? "Permission Required (Subagent)"
      : "Permission Required";
    return this.deps.requestPermissionDecision(
      {
        mode: this.deps.mode,
        ui: this.deps.ui,
        ...this.deps.getPromptPreferences(),
        notice: describePromptNotice(
          title,
          details.payload.request,
          this.deps.describeSession(),
        ),
      },
      title,
      payload,
      buildRequestOptions(details),
    );
  }

  /**
   * The payload to show, or the gate's own payload when annotation fails.
   *
   * `PayloadAnnotator` is an interface, so nothing in its type promises that it
   * settles, that it does not throw, or that it returns a payload at all — only
   * `AnnotationRunner` does. An annotator that suppresses a permission prompt
   * is the worst failure this feature can cause (ADR 0011 §8, "unchanged-prompt
   * fallback"), so this terminal does not trust the implementation: a throw, a
   * rejection, a promise still pending at the ceiling, and any result that
   * `isRenderablePayload` rejects (wrong or copied `request`/`evidence`, a
   * malformed annotations slot or member, a foreign marking) all fall back to
   * the original payload, wholesale.
   *
   * One failure it cannot contain: an annotator that blocks the thread
   * synchronously cannot be preempted — no timer can fire — so it can still
   * stall the queue. Everything asynchronous is bounded.
   *
   * No failure is logged here: the runner owns the audit, and a second, quieter
   * path would blur it.
   */
  private async annotated(
    details: PromptPermissionDetails,
  ): Promise<PromptPayload> {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ceiling = new Promise<typeof ANNOTATOR_CEILING>((resolve) => {
        timer = setTimeout(
          () => resolve(ANNOTATOR_CEILING),
          this.deps.getAnnotatorTimeoutMs() + ANNOTATOR_GUARD_GRACE_MS,
        );
      });
      try {
        // `unknown`, because the interface's type is not a promise an
        // arbitrary implementation keeps: the value is checked, not assumed.
        const annotated: unknown = await Promise.race([
          // The chain's trail for this ask rides on the payload as
          // annotate-time input; the gate's own facts keep their identity.
          this.deps.annotator.annotate(
            withAuthorizerContext(details.payload, details),
            details.requestId,
          ),
          ceiling,
        ]);
        // Validated, not just race-checked: the renderers traverse `request`,
        // `evidence` and every annotation member, so a malformed result would
        // throw inside `present` and lose the ask — the same outcome as a
        // throw. All-or-nothing, see `isRenderablePayload`.
        if (
          annotated === ANNOTATOR_CEILING ||
          !isRenderablePayload(annotated, details.payload)
        ) {
          return details.payload;
        }
        return annotated;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Sync throw, rejection, or a broken timeout thunk: show the prompt as
      // the gate built it rather than losing the ask.
      return details.payload;
    }
  }
}

/**
 * The answer an ask gets when the session released it before a human ruled.
 *
 * Mirrors `ParentAuthorizer`'s abandonment: `confirmationUnavailable` keeps it
 * out of the "User denied" family, since a user who was never asked denied
 * nothing (#719), and the agent-facing reason and the provenance record reuse
 * one string so what the model is told and what the log attributes cannot
 * drift (#726).
 */
function releasedDecision(reason: string): PermissionPromptDecision {
  return {
    approved: false,
    state: "denied",
    confirmationUnavailable: true,
    denialReason: reason,
    decidedBy: { kind: "unavailable", reason },
  };
}

/**
 * The dialog options this ask offers, composed from two independent groups.
 *
 * The label names what the session grant covers: the proven direction and
 * target for a directional path ask, else a gate-supplied label, else the
 * target alone for a path ask that proves no direction. A forwarded ask is
 * marked as such, and one whose gate suggested session grants additionally
 * gets the whole-serving-session row.
 *
 * They compose rather than exclude: a forwarded path ask gets both marks, and
 * an ask that qualifies for neither passes `undefined` so the dialog keeps its
 * defaults.
 */
function buildRequestOptions(
  details: PromptPermissionDetails,
): RequestPermissionOptions | undefined {
  const grants = details.sessionApproval?.grants ?? [];
  const direction = provenDirectionOf(grants);
  const widths = direction
    ? buildDirectionalSessionLabels(direction, describeGrantTarget(grants))
    : null;
  const sessionLabel =
    widths?.sessionLabel ??
    details.sessionLabel ??
    buildPathAccessSessionLabel(grants) ??
    undefined;

  const options: RequestPermissionOptions = {
    ...(sessionLabel ? { sessionLabel } : {}),
    ...(widths ? { sessionWidth: { label: widths.widenedLabel } } : {}),
    ...(details.forwarding ? { forwarded: true } : {}),
    ...(details.forwarding && grants.length > 0 ? { sessionScope: true } : {}),
  };
  return Object.keys(options).length > 0 ? options : undefined;
}
