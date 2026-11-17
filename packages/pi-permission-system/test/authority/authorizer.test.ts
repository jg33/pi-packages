import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ParentAuthorizer } from "#src/authority/approval-escalator";
import { selectAuthorizer } from "#src/authority/authorizer";
import {
  DenyingAuthorizer,
  NoForwardingParentAuthorizer,
} from "#src/authority/denying-authorizer";
import type { TargetServingLookup } from "#src/authority/forwarding-liveness";
import { LocalUserAuthorizer } from "#src/authority/local-user-authorizer";
import { SubagentDetection } from "#src/authority/subagent-detection";
import { posixPathFlavor } from "#src/path/path-flavor";
import type { PromptPayload } from "#src/presentation/prompt-payload";
import {
  makeAuthorizerSelectionDeps as makeDeps,
  makeDetection,
  neutralizeSubagentEnvHints,
} from "#test/helpers/authorizer-fixtures";
import { makeSubagentRegistry } from "#test/helpers/forwarding-fixtures";
import { makePromptDetails } from "#test/helpers/prompt-details-fixtures";

neutralizeSubagentEnvHints();

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(hasUI: boolean): ExtensionContext {
  return {
    hasUI,
    mode: "tui",
    ui: { select: vi.fn(), input: vi.fn(), custom: vi.fn() },
    sessionManager: {
      getSessionId: vi.fn().mockReturnValue("session-1"),
      getSessionDir: vi.fn().mockReturnValue("/sessions/session-1"),
      getEntries: vi.fn().mockReturnValue([]),
    },
  } as unknown as ExtensionContext;
}

/** A serving lookup answering a fixed verdict for any target. */
function makeServing(answer: boolean | null) {
  return {
    isServing: vi.fn<TargetServingLookup["isServing"]>(() => answer),
    describe: vi.fn<TargetServingLookup["describe"]>(() => ({
      channel: "none" as const,
      state: null,
      servingIds: [],
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("selectAuthorizer", () => {
  describe("terminal dispatch", () => {
    it("selects LocalUserAuthorizer when the context has UI", () => {
      const authority = selectAuthorizer(makeCtx(true), makeDeps());
      expect(authority.terminal).toBeInstanceOf(LocalUserAuthorizer);
    });

    it("selects the fail-fast denier for a subagent with UI that declares no parent", () => {
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({ detection: makeDetection(true) }),
      );
      expect(authority.terminal).toBeInstanceOf(NoForwardingParentAuthorizer);
      expect(authority.relayTarget).toBeUndefined();
    });

    it("selects ParentAuthorizer when there is no UI but the context is a subagent", () => {
      const authority = selectAuthorizer(
        makeCtx(false),
        makeDeps({ detection: makeDetection(true) }),
      );
      expect(authority.terminal).toBeInstanceOf(ParentAuthorizer);
    });

    it("selects DenyingAuthorizer when there is no UI and no subagent", () => {
      const authority = selectAuthorizer(
        makeCtx(false),
        makeDeps({ detection: makeDetection(false) }),
      );
      expect(authority.terminal).toBeInstanceOf(DenyingAuthorizer);
    });
  });

  describe("chain role", () => {
    it("adjudicates locally when the terminal is the human", () => {
      const authority = selectAuthorizer(makeCtx(true), makeDeps());
      expect(authority.adjudicatesLocally).toBe(true);
    });

    it("adjudicates locally when a subagent with its own UI declares no parent", () => {
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({ detection: makeDetection(true) }),
      );
      expect(authority.adjudicatesLocally).toBe(true);
    });

    it("relays instead of adjudicating when the terminal forwards to a serving node", () => {
      const authority = selectAuthorizer(
        makeCtx(false),
        makeDeps({ detection: makeDetection(true) }),
      );
      expect(authority.adjudicatesLocally).toBe(false);
    });

    it("adjudicates locally when the terminal denies for want of authority", () => {
      const authority = selectAuthorizer(
        makeCtx(false),
        makeDeps({ detection: makeDetection(false) }),
      );
      expect(authority.adjudicatesLocally).toBe(true);
    });
  });

  describe("a UI session that declares a parent", () => {
    it("relays to the session an env marker names while that session serves", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "lead-session");
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({
          detection: makeDetection(true),
          serving: makeServing(true),
        }),
      );
      expect(authority.terminal).toBeInstanceOf(ParentAuthorizer);
      expect(authority.adjudicatesLocally).toBe(false);
      expect(authority.relayTarget).toEqual({
        sessionId: "lead-session",
        source: "env",
      });
    });

    it("relays to a registry-resolved parent while that parent serves", () => {
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({
          detection: makeDetection(true),
          registry: makeSubagentRegistry("session-1", {
            parentSessionId: "lead-session",
          }),
          serving: makeServing(true),
        }),
      );
      expect(authority.terminal).toBeInstanceOf(ParentAuthorizer);
      expect(authority.relayTarget).toEqual({
        sessionId: "lead-session",
        source: "registry",
      });
    });

    it("asks the serving channel about the target it resolved", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "lead-session");
      const serving = makeServing(true);
      selectAuthorizer(
        makeCtx(true),
        makeDeps({ detection: makeDetection(true), serving }),
      );
      expect(serving.isServing).toHaveBeenCalledWith({
        sessionId: "lead-session",
        source: "env",
      });
    });

    it("fails fast when the declared parent is not serving", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "lead-session");
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({
          detection: makeDetection(true),
          serving: makeServing(false),
        }),
      );
      expect(authority.terminal).toBeInstanceOf(NoForwardingParentAuthorizer);
      expect(authority.adjudicatesLocally).toBe(true);
      expect(authority.relayTarget).toBeUndefined();
    });

    it("fails fast when no channel can answer for the parent", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "lead-session");
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({
          detection: makeDetection(true),
          serving: makeServing(null),
        }),
      );
      expect(authority.terminal).toBeInstanceOf(NoForwardingParentAuthorizer);
    });

    it("fails fast when the marker names the reading session", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "session-1");
      const serving = makeServing(true);
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({ detection: makeDetection(true), serving }),
      );
      expect(authority.terminal).toBeInstanceOf(NoForwardingParentAuthorizer);
      expect(serving.isServing).not.toHaveBeenCalled();
    });
  });

  describe("a headless subagent", () => {
    it("relays without consulting the serving channel", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "lead-session");
      const serving = makeServing(false);
      const authority = selectAuthorizer(
        makeCtx(false),
        makeDeps({ detection: makeDetection(true), serving }),
      );
      expect(authority.terminal).toBeInstanceOf(ParentAuthorizer);
      expect(serving.isServing).not.toHaveBeenCalled();
    });
  });

  describe("with the production subagent detector", () => {
    // The fake detection cannot catch the root's self-naming marker
    // (subagent-forwarding writes PI_SUBAGENT_PARENT_SESSION=<own id> into
    // every rooted session), so these two run the real detector.
    const realDetection = () =>
      new SubagentDetection({
        subagentSessionsDir: "/sessions/subagents",
        flavor: posixPathFlavor,
      });

    it("gives a self-marked root a real local prompt and never auto-denies", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "session-1"); // makeCtx's id
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({ detection: realDetection() }),
      );
      expect(authority.terminal).toBeInstanceOf(LocalUserAuthorizer);
      expect(authority.adjudicatesLocally).toBe(true);
    });

    it("still fails fast for a genuine child that declares no parent", () => {
      vi.stubEnv("PI_SUBAGENT_NAME", "worker"); // child hint, no candidate
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({ detection: realDetection() }),
      );
      expect(authority.terminal).toBeInstanceOf(NoForwardingParentAuthorizer);
    });
  });
});

describe("selectAuthorizer — annotations stay on the serving node", () => {
  it("never annotates an ask the relaying terminal actually handles", async () => {
    vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "lead-session");
    const forwardingDir = mkdtempSync(join(tmpdir(), "ps-relay-ask-"));
    try {
      const annotate = vi.fn((payload: PromptPayload) =>
        Promise.resolve(payload),
      );
      const deps = makeDeps({
        detection: makeDetection(true),
        serving: makeServing(true),
        forwardingDir,
        // Give up on the parent quickly; the point is the ask path, not the wait.
        getForwardingTimeoutMs: () => 1,
        annotator: { annotate },
      });

      const authority = selectAuthorizer(makeCtx(true), deps);
      expect(authority.terminal).toBeInstanceOf(ParentAuthorizer);

      // Drive a real ask through the relaying terminal: it forwards and waits.
      const decision = await authority.terminal.authorize(
        makePromptDetails({ requestId: "req-relay" }),
      );

      expect(decision.approved).toBe(false);
      // A relaying node has no human: the parent's node annotates, not this one.
      // `buildParentAuthorizer` takes no annotator, so this is structural, but
      // the assertion fails if a relaying ask ever reaches one.
      expect(annotate).not.toHaveBeenCalled();
    } finally {
      rmSync(forwardingDir, { recursive: true, force: true });
    }
  });
});
