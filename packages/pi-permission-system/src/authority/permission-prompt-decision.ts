import type { DialogKeyBindings, PromptAction } from "#src/config/dialog-keys";
import {
  createDeniedPermissionDecision,
  type PromptOptionAction,
  promptOptions,
  type UnattributedDecision,
} from "./permission-dialog";

/**
 * Pure decision model for the inline keybind permission dialog.
 *
 * The interaction logic — which hotkey produces which decision, double-press
 * arming, and which options an ask offers — lives here with no SDK or TUI
 * imports, so it is unit-testable directly. The `ctx.ui.custom` component
 * ({@link file://./permission-prompt-component.ts}) is a thin adapter that
 * forwards keystrokes to {@link reducePrompt} and renders the returned state.
 */

/**
 * The decision step's options, in display order.
 *
 * Straight through {@link promptOptions} — the one roster source the fallback
 * dialog and the component's rows also render — so which options an ask
 * offers is decided once, in the model, and the component renders whatever it
 * is handed.
 */
export function visibleActions(
  config: PromptModelConfig,
): readonly PromptOptionAction[] {
  return promptOptions(config).map((row) => row.action);
}

/**
 * The number rendered beside an option, following {@link visibleActions} order.
 *
 * The dialog's rows are numbered and herdr's Asks panel adopts those numbers as
 * its buttons (it presses the digit, then Enter), so the number a row shows and
 * the number that selects it have to come from this one function.
 *
 * Returns `0` for an action that is not in `visibleActions(config)` — the
 * roster a given ask actually offers — since such an action renders no row.
 */
export function actionOrdinal(
  config: PromptModelConfig,
  action: PromptAction,
): number {
  // The cast states the contract: an action outside the roster is looked up,
  // not rejected, so it finds nothing and numbers 0.
  return (
    (visibleActions(config) as readonly PromptAction[]).indexOf(action) + 1
  );
}

/**
 * The phrase the armed hint confirms with: "Press 2 again to allow for all
 * agents."
 *
 * Read from the roster, not from a table of its own — the scope a session row
 * grants is the ask's, so a verb fixed per action would confirm a grant the
 * operator is not making.
 */
function confirmVerb(
  config: PromptModelConfig,
  action: PromptOptionAction,
): string {
  const row = promptOptions(config).find((entry) => entry.action === action);
  // An armed action always comes from the roster; "confirm" keeps the hint
  // printable if a roster entry ever sets one without a verb.
  return row?.verb ?? "confirm";
}

/** Static configuration for a single prompt presentation. */
export interface PromptModelConfig {
  /** When true, a hotkey arms first and commits only on a second press. */
  doublePressToConfirm: boolean;
  /**
   * The character bound to each decision.
   *
   * What the dialog matches keystrokes against and what it renders, so an
   * option's identity and the key that selects it are separate values.
   */
  keys: DialogKeyBindings;
  /** Override for the session row's label (the gate's suggested pattern). */
  sessionLabel?: string;
  /**
   * Present iff this ask's session grant can be widened to both directions
   * (#813): its label is the session row's text, and committing a session
   * row records the `"family"` width. Absent leaves the least-privilege
   * default.
   */
  sessionWidth?: { label: string };
  /**
   * Present iff this ask was forwarded from a subagent: the session row
   * grants the requesting subagent's own session rather than the serving
   * session's.
   */
  forwarded?: boolean;
  /**
   * Forwarded asks carrying a scope choice: adds the whole-serving-session
   * row. The scope decision commits in the first prompt — there is no second
   * step.
   */
  sessionScope?: boolean;
}

/** The re-render view state the component draws from. */
export interface PromptViewState {
  highlightedAction: PromptOptionAction;
  /** Set only while awaiting the confirming second press of a hotkey. */
  armedAction?: PromptOptionAction;
  /** "Press 1 again to allow." while armed (echoing the pressed key, or the configured binding); empty otherwise. */
  hint: string;
}

/** An input event the reducer understands. */
export type PromptEvent =
  | { type: "nav"; direction: "up" | "down" }
  | {
      type: "hotkey";
      action: PromptOptionAction;
      key?: string;
    }
  | { type: "confirm" }
  | { type: "cancel" };

/** Either a re-render or a terminal decision. */
export type PromptOutcome =
  | { kind: "render"; state: PromptViewState }
  | { kind: "decision"; decision: UnattributedDecision };

export function initialPromptState(
  _config: PromptModelConfig,
): PromptViewState {
  return {
    highlightedAction: "approve",
    armedAction: undefined,
    hint: "",
  };
}

/**
 * Advance the dialog by one input event, returning either the next view state
 * to render or the committed {@link UnattributedDecision}.
 *
 * There is exactly one round: every option commits in the press (or the
 * confirming second press) that selects it — no reason or scope follow-up.
 *
 * The model states the outcome and not the decider: which human surface this
 * is gets attributed by the dispatcher that chose to render this dialog, so
 * the two cannot disagree about the surface.
 */
export function reducePrompt(
  config: PromptModelConfig,
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  switch (event.type) {
    case "nav":
      return render({
        ...state,
        highlightedAction: shiftAction(
          config,
          state.highlightedAction,
          event.direction,
        ),
        armedAction: undefined,
        hint: "",
      });
    case "hotkey":
      return visibleActions(config).includes(event.action)
        ? pressHotkey(config, state, event.action, event.key)
        : render(state);
    case "confirm":
      return pressHotkey(config, state, state.highlightedAction);
    case "cancel":
      return { kind: "decision", decision: createDeniedPermissionDecision() };
  }
}

function pressHotkey(
  config: PromptModelConfig,
  state: PromptViewState,
  action: PromptOptionAction,
  key?: string,
): PromptOutcome {
  if (!config.doublePressToConfirm || state.armedAction === action) {
    return commit(config, action);
  }
  return render({
    ...state,
    highlightedAction: action,
    armedAction: action,
    // Name the key the operator pressed: rows are numbered, so a digit press
    // must not be answered with "Press y again".
    hint: `Press ${key ?? config.keys[action]} again to ${confirmVerb(config, action)}.`,
  });
}

/**
 * The width this ask's session rows record: `"family"` iff the widened row
 * was offered (#813) — the width is the ask's and applies to either scope,
 * matching the pre-one-step choice — else absent, the least-privilege default
 * that serializes exactly as a narrow grant always has.
 */
function sessionGrantWidthFor(
  config: PromptModelConfig,
): Pick<UnattributedDecision, "sessionGrantWidth"> {
  return config.sessionWidth ? { sessionGrantWidth: "family" } : {};
}

function commit(
  config: PromptModelConfig,
  action: PromptOptionAction,
): PromptOutcome {
  switch (action) {
    case "approve":
      return {
        kind: "decision",
        decision: { approved: true, state: "approved" },
      };
    case "deny":
      return { kind: "decision", decision: createDeniedPermissionDecision() };
    case "approveSession":
      return {
        kind: "decision",
        decision: {
          approved: true,
          state: "approved_for_session",
          ...sessionGrantWidthFor(config),
        },
      };
    case "approveSessionBoth":
      return {
        kind: "decision",
        decision: {
          approved: true,
          state: "approved_for_serving_session",
          ...sessionGrantWidthFor(config),
        },
      };
  }
}

function shiftAction(
  config: PromptModelConfig,
  current: PromptOptionAction,
  direction: "up" | "down",
): PromptOptionAction {
  const actions = visibleActions(config);
  const index = actions.indexOf(current);
  const delta = direction === "down" ? 1 : -1;
  const next = (index + delta + actions.length) % actions.length;
  return actions[next] ?? current;
}

function render(state: PromptViewState): PromptOutcome {
  return { kind: "render", state };
}
