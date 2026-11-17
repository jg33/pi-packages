import { describe, expect, it, vi } from "vitest";
import {
  createDeniedPermissionDecision,
  isPermissionDecisionState,
  normalizePermissionDenialReason,
  type PermissionDecisionUi,
  requestPermissionDecisionFromUi,
} from "#src/authority/permission-dialog";

describe("isPermissionDecisionState", () => {
  it("accepts approved", () => {
    expect(isPermissionDecisionState("approved")).toBe(true);
  });

  it("accepts denied", () => {
    expect(isPermissionDecisionState("denied")).toBe(true);
  });

  it("accepts denied_with_reason", () => {
    expect(isPermissionDecisionState("denied_with_reason")).toBe(true);
  });

  it("accepts approved_for_session", () => {
    expect(isPermissionDecisionState("approved_for_session")).toBe(true);
  });

  it("accepts approved_for_serving_session", () => {
    expect(isPermissionDecisionState("approved_for_serving_session")).toBe(
      true,
    );
  });

  it("rejects unknown strings", () => {
    expect(isPermissionDecisionState("unknown")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isPermissionDecisionState(42)).toBe(false);
    expect(isPermissionDecisionState(null)).toBe(false);
  });
});

describe("requestPermissionDecisionFromUi", () => {
  it("returns approved when user selects allow", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("allow"),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: true, state: "approved" });
  });

  it("returns approved_for_session when user selects the session option", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("allow for all agents"),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: true, state: "approved_for_session" });
  });

  it("returns denied when user selects deny", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("deny"),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: false, state: "denied" });
  });

  it("returns denied when user dismisses dialog (undefined)", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue(undefined),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: false, state: "denied" });
  });

  it("passes the one-step roster to ui.select", async () => {
    const selectFn = vi.fn().mockResolvedValue("allow");
    const ui: PermissionDecisionUi = {
      select: selectFn,
    };
    await requestPermissionDecisionFromUi(ui, "Title", "Message");
    const options = selectFn.mock.calls[0][1] as string[];
    expect(options).toEqual(["allow", "allow for all agents", "deny"]);
  });

  it("uses custom sessionLabel when provided", async () => {
    const selectFn = vi.fn().mockResolvedValue("allow");
    const ui: PermissionDecisionUi = {
      select: selectFn,
    };
    await requestPermissionDecisionFromUi(ui, "Title", "Message", {
      sessionLabel: 'Yes, allow "git *" for this session',
    });
    const options = selectFn.mock.calls[0][1] as string[];
    expect(options[1]).toBe('Yes, allow "git *" for this session');
  });

  it("still returns approved_for_session when user selects the custom session label", async () => {
    const customLabel = 'Yes, allow "git *" for this session';
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue(customLabel),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { sessionLabel: customLabel },
    );
    expect(result).toEqual({ approved: true, state: "approved_for_session" });
  });

  it("falls back to the default session row label when no options provided", async () => {
    const selectFn = vi.fn().mockResolvedValue("allow");
    const ui: PermissionDecisionUi = {
      select: selectFn,
    };
    await requestPermissionDecisionFromUi(ui, "Title", "Message");
    const options = selectFn.mock.calls[0][1] as string[];
    expect(options[1]).toBe("allow for all agents");
  });

  describe("the scope choice in the same select", () => {
    const SCOPE = { forwarded: true, sessionScope: true } as const;

    it("offers the all-agents row in the first select, not a second one", async () => {
      const selectFn = vi.fn().mockResolvedValue("allow");
      const ui: PermissionDecisionUi = { select: selectFn };
      await requestPermissionDecisionFromUi(ui, "Title", "Message", SCOPE);
      expect(selectFn).toHaveBeenCalledTimes(1);
      expect(selectFn.mock.calls[0][1]).toEqual([
        "allow",
        "allow for this agent",
        "allow for all agents",
        "deny",
      ]);
    });

    it("maps the agent-only session row to approved_for_session", async () => {
      const ui: PermissionDecisionUi = {
        select: vi.fn().mockResolvedValue("allow for this agent"),
      };
      const result = await requestPermissionDecisionFromUi(
        ui,
        "Title",
        "Message",
        SCOPE,
      );
      expect(result).toEqual({ approved: true, state: "approved_for_session" });
    });

    it("maps the all-agents row to approved_for_serving_session", async () => {
      const ui: PermissionDecisionUi = {
        select: vi.fn().mockResolvedValue("allow for all agents"),
      };
      const result = await requestPermissionDecisionFromUi(
        ui,
        "Title",
        "Message",
        SCOPE,
      );
      expect(result).toEqual({
        approved: true,
        state: "approved_for_serving_session",
      });
    });

    it("decides from the first select alone when the user picks plain allow", async () => {
      const selectFn = vi.fn().mockResolvedValueOnce("allow");
      const ui: PermissionDecisionUi = { select: selectFn };
      const result = await requestPermissionDecisionFromUi(
        ui,
        "Title",
        "Message",
        SCOPE,
      );
      expect(selectFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ approved: true, state: "approved" });
    });
  });

  describe("dismissal by an expired answer window", () => {
    /** A scripted answer that waits for the signal to dismiss it, as Pi's dialogs do. */
    const AWAIT_DISMISSAL = Symbol("await dismissal");
    type Scripted = string | undefined | typeof AWAIT_DISMISSAL;
    interface DialogOptions {
      signal?: AbortSignal;
    }

    function respond(
      queue: Scripted[],
      opts: DialogOptions | undefined,
    ): Promise<string | undefined> {
      const next = queue.shift();
      if (next !== AWAIT_DISMISSAL) {
        return Promise.resolve(next);
      }
      return new Promise((resolve) => {
        opts?.signal?.addEventListener(
          "abort",
          () => {
            resolve(undefined);
          },
          { once: true },
        );
      });
    }

    function scriptedUi(selects: Scripted[]) {
      const select = vi.fn(
        (_title: string, _options: string[], opts?: DialogOptions) =>
          respond(selects, opts),
      );
      const ui: PermissionDecisionUi = { select };
      return { ui, select };
    }

    async function dismissWhilePending(
      ui: PermissionDecisionUi,
      options?: Parameters<typeof requestPermissionDecisionFromUi>[3],
    ) {
      const window = new AbortController();
      const answer = requestPermissionDecisionFromUi(
        ui,
        "Title",
        "Message",
        options,
        window.signal,
      );
      await Promise.resolve();
      await Promise.resolve();
      window.abort();
      return answer;
    }

    it("hands the signal to the select, so the host can dismiss it", async () => {
      const { ui, select } = scriptedUi(["Yes"]);
      const window = new AbortController();

      await requestPermissionDecisionFromUi(
        ui,
        "Title",
        "Message",
        undefined,
        window.signal,
      );

      expect(select).toHaveBeenCalledWith("Title\nMessage", expect.any(Array), {
        signal: window.signal,
      });
    });

    it("answers nothing when the window dismisses the decision select", async () => {
      const { ui } = scriptedUi([AWAIT_DISMISSAL]);
      expect(await dismissWhilePending(ui)).toBeUndefined();
    });

    it("still denies a select the human cancelled while the window was open", async () => {
      const { ui } = scriptedUi([undefined]);
      const window = new AbortController();

      const result = await requestPermissionDecisionFromUi(
        ui,
        "Title",
        "Message",
        undefined,
        window.signal,
      );

      expect(result).toEqual({ approved: false, state: "denied" });
    });
  });
});

describe("normalizePermissionDenialReason", () => {
  it("returns trimmed string for non-empty input", () => {
    expect(normalizePermissionDenialReason("  reason  ")).toBe("reason");
  });

  it("returns undefined for empty string", () => {
    expect(normalizePermissionDenialReason("")).toBeUndefined();
  });

  it("returns undefined for non-string", () => {
    expect(normalizePermissionDenialReason(42)).toBeUndefined();
  });
});

describe("createDeniedPermissionDecision", () => {
  it("returns denied_with_reason when reason provided", () => {
    expect(createDeniedPermissionDecision("nope")).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "nope",
    });
  });

  it("returns denied when no reason", () => {
    expect(createDeniedPermissionDecision()).toEqual({
      approved: false,
      state: "denied",
    });
  });
});
