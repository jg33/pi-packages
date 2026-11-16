import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestPermissionDecision } from "#src/authority/permission-prompt-component";
import {
  bashPayload,
  KEY,
  makeView,
  mountPrompt,
} from "./helpers/prompt-harness";

const USER = { kind: "user", via: "dialog" } as const;
const NOW = { doublePressToConfirm: false } as const; // commit on first press

describe("permission prompt gate semantics (characterization: must hold before AND after the restyle)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("outcomes", () => {
    it("y approves once", async () => {
      const m = mountPrompt({ view: NOW });
      m.type("y");
      await expect(m.decision).resolves.toStrictEqual({
        approved: true,
        state: "approved",
        decidedBy: USER,
      });
    });

    it("s approves for the session, narrow width", async () => {
      const m = mountPrompt({ view: NOW });
      m.type("s");
      await expect(m.decision).resolves.toStrictEqual({
        approved: true,
        state: "approved_for_session",
        decidedBy: USER,
      });
    });

    it("b approves both directions only when the ask offers it", async () => {
      const withScope = mountPrompt({
        view: NOW,
        options: { forwarded: true, sessionScope: true },
      });
      withScope.type("b");
      await expect(withScope.decision).resolves.toStrictEqual({
        approved: true,
        state: "approved_for_serving_session",
        decidedBy: USER,
      });

      const without = mountPrompt({ view: NOW });
      without.type("b");
      expect(without.done).not.toHaveBeenCalled();
    });

    it("n denies", async () => {
      const m = mountPrompt({ view: NOW });
      m.type("n");
      await expect(m.decision).resolves.toStrictEqual({
        approved: false,
        state: "denied",
        decidedBy: USER,
      });
    });

    it("esc on the decision step denies", async () => {
      const m = mountPrompt();
      m.type(KEY.esc);
      await expect(m.decision).resolves.toStrictEqual({
        approved: false,
        state: "denied",
        decidedBy: USER,
      });
    });

    it("keys that are bound to nothing never decide", () => {
      const m = mountPrompt({ view: NOW });
      m.type("x", "z", "q", "\t", " ");
      expect(m.done).not.toHaveBeenCalled();
    });

    it("first Enter arms the highlighted approve instead of deciding", () => {
      const m = mountPrompt(); // double-press to confirm is on by default here
      m.type(KEY.enter);
      expect(m.done).not.toHaveBeenCalled();
      expect(m.screen().join("\n")).toContain("Press y again to allow.");
    });

    it("second Enter approves", async () => {
      const m = mountPrompt();
      m.type(KEY.enter, KEY.enter);
      await expect(m.decision).resolves.toStrictEqual({
        approved: true,
        state: "approved",
        decidedBy: USER,
      });
    });

    it("Enter approves immediately when double-press to confirm is off", async () => {
      const m = mountPrompt({ view: NOW });
      m.type(KEY.enter);
      await expect(m.decision).resolves.toStrictEqual({
        approved: true,
        state: "approved",
        decidedBy: USER,
      });
    });

    it("Esc denies on the first press, no arming required", async () => {
      const m = mountPrompt();
      m.type(KEY.esc);
      await expect(m.decision).resolves.toStrictEqual({
        approved: false,
        state: "denied",
        decidedBy: USER,
      });
    });

    it("j/k navigate like ↓/↑ (they are reserved and never decide)", async () => {
      const m = mountPrompt({ view: NOW });
      m.type("j", "j", "k", "j");
      expect(m.done).not.toHaveBeenCalled();
      m.type(KEY.enter); // approve -> session -> deny -> session -> deny
      await expect(m.decision).resolves.toStrictEqual({
        approved: false,
        state: "denied",
        decidedBy: USER,
      });
    });

    it("↑/↓ moves the highlight and enter commits the highlighted option", async () => {
      const m = mountPrompt();
      // approve -> session -> deny (no width option), then arm + confirm
      m.type(KEY.down, KEY.down, KEY.enter, KEY.enter);
      await expect(m.decision).resolves.toStrictEqual({
        approved: false,
        state: "denied",
        decidedBy: USER,
      });
    });
  });

  describe("the scope choice in the first prompt", () => {
    const options = {
      forwarded: true,
      sessionScope: true,
    };

    it("renders both scope rows; s grants this agent", async () => {
      const m = mountPrompt({ view: NOW, options });
      expect(m.screen().join("\n")).toContain("allow for this agent");
      expect(m.screen().join("\n")).toContain("allow for all agents");
      m.type("s");
      await expect(m.decision).resolves.toStrictEqual({
        approved: true,
        state: "approved_for_session",
        decidedBy: USER,
      });
    });

    it("b widens to the serving session", async () => {
      const m = mountPrompt({ view: NOW, options });
      m.type("b");
      await expect(m.decision).resolves.toStrictEqual({
        approved: true,
        state: "approved_for_serving_session",
        decidedBy: USER,
      });
    });
  });

  describe("doublePressToConfirm", () => {
    it("a hotkey arms first and commits on the second press of the same key", async () => {
      const m = mountPrompt({ view: { doublePressToConfirm: true } });
      m.type("y");
      expect(m.done).not.toHaveBeenCalled();
      expect(m.screen().join("\n")).toContain("Press y again to allow.");
      m.type("y");
      await expect(m.decision).resolves.toStrictEqual({
        approved: true,
        state: "approved",
        decidedBy: USER,
      });
    });

    it("pressing a different hotkey re-arms instead of committing", () => {
      const m = mountPrompt({ view: { doublePressToConfirm: true } });
      m.type("y", "n");
      expect(m.done).not.toHaveBeenCalled();
      expect(m.screen().join("\n")).toContain("Press n again to deny.");
    });

    it("navigation disarms", () => {
      const m = mountPrompt({ view: { doublePressToConfirm: true } });
      m.type("y", KEY.down);
      // Not "again to": the resting hint also says "then again to confirm" (before and after the restyle).
      expect(m.screen().join("\n")).not.toContain("Press y again to allow.");
      m.type("y"); // arms again, does not commit
      expect(m.done).not.toHaveBeenCalled();
    });

    it("off: the first press commits", async () => {
      const m = mountPrompt({ view: NOW });
      m.type("n");
      await expect(m.decision).resolves.toMatchObject({
        approved: false,
        state: "denied",
      });
    });
  });

  describe("permissionDialogKeys remapping", () => {
    const dialogKeys = {
      approve: "a",
      approveSession: "c",
      approveSessionBoth: "d",
      deny: "e",
      denyWithReason: "f",
    };

    it("answers to the bound key and not the default letter", async () => {
      const m = mountPrompt({ view: { ...NOW, dialogKeys } });
      m.type("y");
      expect(m.done).not.toHaveBeenCalled();
      m.type("a");
      await expect(m.decision).resolves.toStrictEqual({
        approved: true,
        state: "approved",
        decidedBy: USER,
      });
    });

    it("numbers rows by position, not by the configured key", () => {
      const m = mountPrompt({ view: { ...NOW, dialogKeys } });
      const text = m.screen().join("\n");
      expect(text).toMatch(/1\W+allow/);
      // Rows are numbered by position, not by the remapped character: on this
      // narrow ask deny sits third, because the scope row is absent.
      expect(text).toMatch(/3\W+deny\b/);
    });
  });

  describe("promptTimeoutMs", () => {
    it("denies as unanswered when the window expires untouched — never approves", async () => {
      const m = mountPrompt({ view: { promptTimeoutMs: 5000 } });
      vi.advanceTimersByTime(4999);
      expect(m.done).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      const decision = await m.decision;
      expect(decision).toStrictEqual({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        decidedBy: { kind: "unanswered", timeoutMs: 5000 },
      });
      expect(m.done).toHaveBeenCalledTimes(1);
      expect(m.done).toHaveBeenCalledWith(undefined);
    });

    it("announces the deadline, and the first keystroke stops the clock and the announcement", async () => {
      const m = mountPrompt({ view: { promptTimeoutMs: 5000 } });
      // Whitespace-normalized: at width 100 the hint wraps mid-phrase on stock code.
      const deadline = () => m.screen().join(" ").replace(/\s+/g, " ");
      expect(deadline()).toContain("denies in 5s");
      m.type(KEY.down);
      vi.advanceTimersByTime(60_000);
      expect(m.done).not.toHaveBeenCalled();
      expect(deadline()).not.toContain("denies in");
      m.type("y", "y");
      await expect(m.decision).resolves.toMatchObject({
        approved: true,
        state: "approved",
      });
    });

    it("no timeout configured: never expires", () => {
      const m = mountPrompt();
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      expect(m.done).not.toHaveBeenCalled();
    });
  });

  describe("promptNotifications", () => {
    it("writes the configured sequence once, at mount, and never again on render or input", () => {
      const m = mountPrompt({ view: { promptNotifications: ["bell"] } });
      expect(m.write).toHaveBeenCalledTimes(1);
      expect(m.write).toHaveBeenCalledWith("\x07");
      m.render(80);
      m.type(KEY.down);
      expect(m.write).toHaveBeenCalledTimes(1);
    });

    it("writes nothing when no channel is configured", () => {
      const m = mountPrompt();
      expect(m.write).not.toHaveBeenCalled();
    });
  });

  describe("non-TUI fallback", () => {
    it("uses select/input and never mounts a component", async () => {
      const custom = vi.fn();
      const view = makeView({ mode: "rpc" }, custom);
      vi.mocked(view.ui.select).mockResolvedValue("allow");
      await expect(
        requestPermissionDecision(view, "Permission Required", bashPayload()),
      ).resolves.toStrictEqual({
        approved: true,
        state: "approved",
        decidedBy: { kind: "user", via: "select" },
      });
      expect(custom).not.toHaveBeenCalled();
    });
  });

  it("mounts inline (never as an overlay)", () => {
    const m = mountPrompt();
    expect(m.custom).toHaveBeenCalledWith(expect.any(Function), {
      overlay: false,
      blocked: { kind: "permission", message: "approve bash: rm -rf /tmp/x" },
    });
  });
});
