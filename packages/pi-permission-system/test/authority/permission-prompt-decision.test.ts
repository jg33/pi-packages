import { describe, expect, it } from "vitest";
import { promptOptions } from "#src/authority/permission-dialog";
import {
  actionOrdinal,
  initialPromptState,
  type PromptModelConfig,
  type PromptOutcome,
  reducePrompt,
  visibleActions,
} from "#src/authority/permission-prompt-decision";
import { DEFAULT_DIALOG_KEYS } from "#src/config/dialog-keys";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Narrow a reducer outcome to its render arm, failing the test if it decided.
 *
 * An assertion signature rather than a bare `throw`: reading `.state` off the
 * union needs narrowing, but a `throw` reports outside the assertion library,
 * so a wrong arm arrives as a stack trace naming neither what was expected nor
 * what came back. `expect.unreachable` returns `never`, so it narrows and
 * reports.
 */
function assertRender(
  outcome: PromptOutcome,
): asserts outcome is Extract<PromptOutcome, { kind: "render" }> {
  if (outcome.kind !== "render") {
    expect.unreachable(`expected a render, got ${JSON.stringify(outcome)}`);
  }
}

/** The hint a single hotkey press arms, for a config that double-presses. */
function armedHint(
  config: PromptModelConfig,
  action: "approve" | "approveSession" | "approveSessionBoth" | "deny",
): string {
  const outcome = reducePrompt(config, initialPromptState(config), {
    type: "hotkey",
    action,
  });
  assertRender(outcome);
  return outcome.state.hint;
}

function makeConfig(
  overrides: Partial<PromptModelConfig> = {},
): PromptModelConfig {
  return {
    doublePressToConfirm: true,
    sessionLabel: "Yes, for this session",
    keys: DEFAULT_DIALOG_KEYS,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("reducePrompt", () => {
  describe("initial state", () => {
    it("starts highlighting approve with nothing armed", () => {
      const state = initialPromptState(makeConfig());
      expect(state).toEqual({
        highlightedAction: "approve",
        armedAction: undefined,
        hint: "",
      });
    });
  });

  describe("double-press to confirm (enabled)", () => {
    it("confirms the session row in the scope the ask grants, not a fixed verb", () => {
      // The session row's scope is the ask's: arming it must name the grant it
      // commits, so a forwarded ask and a serving-session ask read differently.
      expect(armedHint(makeConfig(), "approveSession")).toBe(
        "Press s again to allow for all agents.",
      );
      expect(armedHint(makeConfig({ forwarded: true }), "approveSession")).toBe(
        "Press s again to allow for this agent.",
      );
    });

    it("arms the option on the first hotkey press without deciding", () => {
      const config = makeConfig();
      const outcome = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approve",
      });
      expect(outcome).toEqual({
        kind: "render",
        state: {
          highlightedAction: "approve",
          armedAction: "approve",
          hint: "Press y again to allow.",
        },
      });
    });

    it("commits the decision on the confirming second press of the same key", () => {
      const config = makeConfig();
      const armed = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approve",
      });
      assertRender(armed);
      const outcome = reducePrompt(config, armed.state, {
        type: "hotkey",
        action: "approve",
      });
      expect(outcome).toEqual({
        kind: "decision",
        decision: { approved: true, state: "approved" },
      });
    });

    it("re-arms when a different hotkey is pressed", () => {
      const config = makeConfig();
      const armedY = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approve",
      });
      assertRender(armedY);
      const armedN = reducePrompt(config, armedY.state, {
        type: "hotkey",
        action: "deny",
      });
      expect(armedN).toEqual({
        kind: "render",
        state: {
          highlightedAction: "deny",
          armedAction: "deny",
          hint: "Press n again to deny.",
        },
      });
    });

    it("commits deny on the second press of n", () => {
      const config = makeConfig();
      const armed = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "deny",
      });
      assertRender(armed);
      const outcome = reducePrompt(config, armed.state, {
        type: "hotkey",
        action: "deny",
      });
      expect(outcome).toEqual({
        kind: "decision",
        decision: { approved: false, state: "denied" },
      });
    });
  });

  describe("double-press to confirm (disabled)", () => {
    it("commits immediately on the first hotkey press", () => {
      const config = makeConfig({ doublePressToConfirm: false });
      const outcome = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approve",
      });
      expect(outcome).toEqual({
        kind: "decision",
        decision: { approved: true, state: "approved" },
      });
    });
  });

  describe("navigation and enter", () => {
    it("moves the highlight and clears any armed key without deciding", () => {
      const config = makeConfig();
      const armed = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approve",
      });
      assertRender(armed);
      const outcome = reducePrompt(config, armed.state, {
        type: "nav",
        direction: "down",
      });
      expect(outcome).toEqual({
        kind: "render",
        state: {
          highlightedAction: "approveSession",
          armedAction: undefined,
          hint: "",
        },
      });
    });

    it("wraps the highlight from the last option back to the first", () => {
      const config = makeConfig();
      let state = initialPromptState(config);
      for (const _ of [0, 1, 2]) {
        const outcome = reducePrompt(config, state, {
          type: "nav",
          direction: "up",
        });
        assertRender(outcome);
        state = outcome.state;
      }
      // up from y wraps to deny, then walks deny→session→allow over three presses
      expect(state.highlightedAction).toBe("approve");
    });

    it("arms the highlighted option on enter instead of deciding", () => {
      const config = makeConfig();
      const outcome = reducePrompt(config, initialPromptState(config), {
        type: "confirm",
      });
      expect(outcome).toEqual({
        kind: "render",
        state: {
          highlightedAction: "approve",
          armedAction: "approve",
          hint: "Press y again to allow.",
        },
      });
    });

    it("commits the highlighted option on the second enter press", () => {
      const config = makeConfig();
      const down = reducePrompt(config, initialPromptState(config), {
        type: "nav",
        direction: "down",
      });
      assertRender(down);
      // highlight is now s; move once more to n
      const down2 = reducePrompt(config, down.state, {
        type: "nav",
        direction: "down",
      });
      assertRender(down2);
      const armed = reducePrompt(config, down2.state, { type: "confirm" });
      assertRender(armed);
      expect(armed.state.armedAction).toBe("deny");
      expect(armed.state.highlightedAction).toBe("deny");
      const outcome = reducePrompt(config, armed.state, { type: "confirm" });
      expect(outcome).toEqual({
        kind: "decision",
        decision: { approved: false, state: "denied" },
      });
    });
  });

  describe("escape", () => {
    it("denies from the decision step", () => {
      const config = makeConfig();
      const outcome = reducePrompt(config, initialPromptState(config), {
        type: "cancel",
      });
      expect(outcome).toEqual({
        kind: "decision",
        decision: { approved: false, state: "denied" },
      });
    });
  });

  describe("the session grant in the first prompt", () => {
    it("commits approved_for_session directly when no sessionScope is offered", () => {
      const config = makeConfig({ doublePressToConfirm: false });
      const outcome = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approveSession",
      });
      expect(outcome).toEqual({
        kind: "decision",
        decision: { approved: true, state: "approved_for_session" },
      });
    });

    it("commits a family-width grant when the widened row was offered (#813)", () => {
      const config = makeConfig({
        doublePressToConfirm: false,
        sessionWidth: {
          label: "Yes, allow reads and writes for this session",
        },
      });
      const outcome = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approveSession",
      });
      expect(outcome).toEqual({
        kind: "decision",
        decision: {
          approved: true,
          state: "approved_for_session",
          sessionGrantWidth: "family",
        },
      });
    });

    it("grants family width to the all-agents row too: width is the ask's, scope is orthogonal", () => {
      const config = makeConfig({
        doublePressToConfirm: false,
        sessionScope: true,
        sessionWidth: {
          label: "Yes, allow reads and writes for this session",
        },
      });
      const outcome = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approveSessionBoth",
      });
      expect(outcome).toEqual({
        kind: "decision",
        decision: {
          approved: true,
          state: "approved_for_serving_session",
          sessionGrantWidth: "family",
        },
      });
    });
  });

  describe("the all-agents row (gate-gated)", () => {
    it("offers the all-agents row when the gate suggested session grants", () => {
      expect(visibleActions(makeConfig({ sessionScope: true }))).toEqual([
        "approve",
        "approveSession",
        "approveSessionBoth",
        "deny",
      ]);
    });

    it("stays at the four-option roster when the widened row replaces the session label (#813)", () => {
      expect(
        visibleActions(
          makeConfig({
            sessionScope: true,
            sessionWidth: {
              label: "Yes, allow reads and writes for this session",
            },
          }),
        ),
      ).toEqual(["approve", "approveSession", "approveSessionBoth", "deny"]);
    });

    it("arms b like any other hotkey under double-press", () => {
      const config = makeConfig({ sessionScope: true });
      const outcome = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approveSessionBoth",
      });
      expect(outcome).toEqual({
        kind: "render",
        state: {
          highlightedAction: "approveSessionBoth",
          armedAction: "approveSessionBoth",
          hint: "Press b again to allow for all agents.",
        },
      });
    });

    it("ignores b when the ask is not widenable", () => {
      const config = makeConfig({ doublePressToConfirm: false });
      const outcome = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approveSessionBoth",
      });
      expect(outcome).toEqual({
        kind: "render",
        state: initialPromptState(config),
      });
    });

    it("walks four options when the all-agents row is offered", () => {
      const config = makeConfig({ sessionScope: true });
      let state = initialPromptState(config);
      const seen: string[] = [];
      for (const _ of [0, 1, 2, 3]) {
        const outcome = reducePrompt(config, state, {
          type: "nav",
          direction: "down",
        });
        assertRender(outcome);
        state = outcome.state;
        seen.push(state.highlightedAction);
      }
      expect(seen).toEqual([
        "approveSession",
        "approveSessionBoth",
        "deny",
        "approve",
      ]);
    });

    it("skips the all-agents row when no session grants were suggested", () => {
      const config = makeConfig();
      let state = initialPromptState(config);
      const seen: string[] = [];
      for (const _ of [0, 1, 2]) {
        const outcome = reducePrompt(config, state, {
          type: "nav",
          direction: "down",
        });
        assertRender(outcome);
        state = outcome.state;
        seen.push(state.highlightedAction);
      }
      expect(seen).toEqual(["approveSession", "deny", "approve"]);
    });
  });

  describe("bound characters", () => {
    const REMAPPED = {
      approve: "a",
      approveSession: "c",
      approveSessionBoth: "d",
      deny: "e",
      denyWithReason: "f",
    } as const;

    it("names the bound character in the arming hint", () => {
      const config = makeConfig({ keys: REMAPPED });
      const outcome = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approve",
      });
      assertRender(outcome);
      expect(outcome.state.hint).toBe("Press a again to allow.");
    });

    it("names the default letter when no binding was configured", () => {
      const config = makeConfig();
      const outcome = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "deny",
      });
      assertRender(outcome);
      expect(outcome.state.hint).toBe("Press n again to deny.");
    });
  });
});

describe("option ordinals", () => {
  const narrow = makeConfig();
  const wide = makeConfig({ sessionScope: true });

  it("numbers the narrow roster 1..3, skipping the both-directions row", () => {
    expect(actionOrdinal(narrow, "approve")).toBe(1);
    expect(actionOrdinal(narrow, "approveSession")).toBe(2);
    expect(actionOrdinal(narrow, "deny")).toBe(3);
  });

  it("numbers the wide roster 1..4", () => {
    expect(actionOrdinal(wide, "approveSessionBoth")).toBe(3);
    expect(actionOrdinal(wide, "deny")).toBe(4);
  });

  it("returns 0 for an action the roster does not offer", () => {
    // Documented contract: an action with no row gets no number, so it can
    // never be selected by a digit.
    expect(actionOrdinal(narrow, "approveSessionBoth")).toBe(0);
    expect(actionOrdinal(wide, "approveSessionBoth")).toBe(3);
  });
});

describe("a digit hotkey (the key herdr presses)", () => {
  const config = makeConfig();

  it("arms and names the digit that was pressed", () => {
    const outcome = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "approve",
      key: "1",
    });
    expect(outcome).toMatchObject({
      kind: "render",
      state: { armedAction: "approve", hint: "Press 1 again to allow." },
    });
  });

  it("commits on the Enter herdr sends next", () => {
    const armed = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "approve",
      key: "1",
    });
    assertRender(armed);
    expect(reducePrompt(config, armed.state, { type: "confirm" })).toEqual({
      kind: "decision",
      decision: { approved: true, state: "approved" },
    });
  });

  it("still names the configured letter when no key is carried (Enter-driven arm)", () => {
    const outcome = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "approve",
    });
    expect(outcome).toMatchObject({
      state: { hint: "Press y again to allow." },
    });
  });
});

describe("the one-step roster", () => {
  it("offers exactly allow / allow for this agent / allow for all agents / deny for a forwarded ask with a scope choice", () => {
    const config = makeConfig({
      doublePressToConfirm: false,
      forwarded: true,
      sessionScope: true,
    });
    expect(visibleActions(config)).toEqual([
      "approve",
      "approveSession",
      "approveSessionBoth",
      "deny",
    ]);
  });

  it("drops the reason option: the first prompt is the only prompt", () => {
    const config = makeConfig({ doublePressToConfirm: false });
    expect(visibleActions(config)).toEqual([
      "approve",
      "approveSession",
      "deny",
    ]);
  });

  it("labels the roster from the one source the fallback dialog renders", () => {
    expect(
      promptOptions({ forwarded: true, sessionScope: true }).map(
        (row) => row.label,
      ),
    ).toEqual([
      "allow",
      "allow for this agent",
      "allow for all agents",
      "deny",
    ]);
    expect(promptOptions().map((row) => row.label)).toEqual([
      "allow",
      "allow for all agents",
      "deny",
    ]);
  });

  it("keeps a gate-supplied pattern label on the session row", () => {
    expect(
      promptOptions({ sessionLabel: "Yes, allow reading to /tmp/*" }).map(
        (row) => row.label,
      ),
    ).toEqual(["allow", "Yes, allow reading to /tmp/*", "deny"]);
  });

  it("commits approved_for_session in the first prompt when a scope choice is offered", () => {
    const config = makeConfig({
      doublePressToConfirm: false,
      forwarded: true,
      sessionScope: true,
    });
    const outcome = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "approveSession",
    });
    expect(outcome).toEqual({
      kind: "decision",
      decision: { approved: true, state: "approved_for_session" },
    });
  });

  it("commits approved_for_serving_session from the all-agents row", () => {
    const config = makeConfig({
      doublePressToConfirm: false,
      forwarded: true,
      sessionScope: true,
    });
    const outcome = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "approveSessionBoth",
    });
    expect(outcome).toEqual({
      kind: "decision",
      decision: { approved: true, state: "approved_for_serving_session" },
    });
  });
});
