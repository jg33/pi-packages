import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskDialogQueue } from "#src/authority/ask-dialog-queue";
import { captureAuthorizerContext } from "#src/authority/authorizer-context";
import { LocalUserAuthorizer } from "#src/authority/local-user-authorizer";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import { requestPermissionDecision } from "#src/authority/permission-prompt-component";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import {
  AnnotationRunner,
  type PayloadAnnotator,
} from "#src/presentation/annotation-runner";
import { AnnotatorRegistry } from "#src/presentation/annotator-registry";
import { renderPromptDialog } from "#src/presentation/dialog-renderer";
import type { NotificationSession } from "#src/presentation/prompt-notification";
import {
  modelGeneratedAnnotation,
  type PromptPayload,
} from "#src/presentation/prompt-payload";
import {
  hangingAnnotator,
  makeAnnotationLog,
  passThroughAnnotator,
  staticAnnotator,
} from "#test/helpers/annotator-fixtures";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import {
  makePromptDetails,
  makePromptPayload,
} from "#test/helpers/prompt-details-fixtures";
import { makePromptPreferences } from "#test/helpers/prompt-view-fixtures";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * This file's semantic defaults over the shared structural fixture: several
 * cases assert `agentName` and `toolName` on a no-override call.
 */
function makeDetails(
  overrides?: Partial<PromptPermissionDetails>,
): PromptPermissionDetails {
  return makePromptDetails({
    requestId: "req-123",
    agentName: "test-agent",
    toolName: "read",
    ...overrides,
  });
}

/** A `PermissionPromptUi` double; the tool-expansion accessors go unused here. */
function makePromptUi() {
  return {
    select: vi.fn(),
    input: vi.fn(),
    custom: vi.fn(),
    getToolsExpanded: vi.fn(() => false),
    setToolsExpanded: vi.fn(),
  };
}

/**
 * A `PermissionEventBus` double. `onEmit` observes the emission without
 * replacing it, so a test that cares about emit-versus-present ordering can
 * still build its deps through {@link makeDeps}.
 */
function makeEvents(onEmit?: () => void) {
  return {
    emit: vi.fn(() => {
      onEmit?.();
    }),
    on: vi.fn().mockReturnValue(() => undefined),
  };
}

/** Drain every pending microtask, so a queued presentation has had its turn. */
function settleMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

const APPROVED: PermissionPromptDecision = {
  approved: true,
  state: "approved",
  decidedBy: DECIDED_BY_HUMAN,
};

function makeDeps(
  overrides: {
    events?: ReturnType<typeof makeEvents>;
    dialogs?: AskDialogQueue;
    requestPermissionDecision?: typeof requestPermissionDecision;
    annotator?: PayloadAnnotator;
  } = {},
) {
  const describeSession = vi.fn(
    (): NotificationSession => ({ name: "refactor-auth", cwd: "/w/repo" }),
  );
  const events = overrides.events ?? makeEvents();
  const dialogs = overrides.dialogs ?? new AskDialogQueue();
  const ui = makePromptUi();
  const decisionFn =
    overrides.requestPermissionDecision ??
    vi.fn<typeof requestPermissionDecision>().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });
  return {
    deps: {
      ui,
      mode: "tui" as const,
      events,
      dialogs,
      getPromptPreferences: () => makePromptPreferences(),
      requestPermissionDecision: decisionFn,
      describeSession,
      annotator: overrides.annotator ?? passThroughAnnotator,
      getAnnotatorTimeoutMs: () => 1000,
    },
    describeSession,
    events,
    dialogs,
    ui,
    decisionFn,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("LocalUserAuthorizer", () => {
  it("emits a UI prompt event with normalized surface and value", async () => {
    const { deps, events } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(
      makeDetails({
        toolName: "bash",
        command: "git push",
        toolInputPreview: "git push",
      }),
    );

    expect(events.emit).toHaveBeenCalledWith("permissions:ui_prompt", {
      requestId: "req-123",
      source: "tool_call",
      surface: "bash",
      value: "git push",
      agentName: "test-agent",
      request: makePromptPayload().request,
      forwarding: null,
    });
  });

  it("normalizes skill prompt events to the skill surface", async () => {
    const { deps, events } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(
      makeDetails({
        source: "skill_input",
        toolName: undefined,
        skillName: "deploy-helper",
      }),
    );

    expect(events.emit).toHaveBeenCalledWith("permissions:ui_prompt", {
      requestId: "req-123",
      source: "skill_input",
      surface: "skill",
      value: "deploy-helper",
      agentName: "test-agent",
      request: makePromptPayload().request,
      forwarding: null,
    });
  });

  it("calls requestPermissionDecision with the threaded view, title, and payload", async () => {
    const { deps, ui, decisionFn } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);
    const details = makeDetails();

    await authorizer.authorize(details);

    expect(decisionFn).toHaveBeenCalledWith(
      {
        mode: "tui",
        ui,
        ...makePromptPreferences(),
        notice: {
          title: "pi \u2014 refactor-auth",
          body: "Permission Required: read",
        },
      },
      "Permission Required",
      details.payload,
      undefined,
    );
  });

  describe("notification notice", () => {
    it("reads the session when each prompt opens, not when the authorizer is built", async () => {
      const { deps, describeSession, decisionFn, ui } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(makeDetails());
      describeSession.mockReturnValue({ name: "renamed", cwd: "/w/repo" });
      await authorizer.authorize(makeDetails());

      expect(decisionFn).toHaveBeenLastCalledWith(
        {
          mode: "tui",
          ui,
          ...makePromptPreferences(),
          notice: {
            title: "pi \u2014 renamed",
            body: "Permission Required: read",
          },
        },
        "Permission Required",
        expect.anything(),
        undefined,
      );
    });
  });

  it("passes the sessionLabel option when present", async () => {
    const { deps, decisionFn } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(
      makeDetails({ sessionLabel: "Yes, for 'read' tool" }),
    );

    expect(decisionFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.anything(),
      { sessionLabel: "Yes, for 'read' tool" },
    );
  });

  describe("session label for a path ask that proves no direction", () => {
    it("names a bare external_directory directory approval by its contents glob", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          sessionApproval: {
            grants: [
              { surface: "external_directory", pattern: "/r/a" },
              { surface: "external_directory", pattern: "/r/a/*" },
            ],
          },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { sessionLabel: 'Yes, allow access to "/r/a/*" for this session' },
      );
    });

    it("names a bare path approval by its pattern", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          sessionApproval: { grants: [{ surface: "path", pattern: "/r/*" }] },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { sessionLabel: 'Yes, allow access to "/r/*" for this session' },
      );
    });

    it("keeps a gate-supplied label over the fallback", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          sessionLabel: 'Yes, allow edit "/r/*" for this session',
          sessionApproval: { grants: [{ surface: "path", pattern: "/r/*" }] },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { sessionLabel: 'Yes, allow edit "/r/*" for this session' },
      );
    });

    it("adds no label for a grant on a non-path surface", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          sessionApproval: { grants: [{ surface: "bash", pattern: "git *" }] },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        undefined,
      );
    });
  });

  it("emits the UI event before calling requestPermissionDecision", async () => {
    const calls: string[] = [];
    const decisionFn = vi.fn<typeof requestPermissionDecision>(() => {
      calls.push("dialog");
      return Promise.resolve({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      });
    });
    const { deps } = makeDeps({
      events: makeEvents(() => {
        calls.push("emit");
      }),
      requestPermissionDecision: decisionFn,
    });
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(makeDetails());

    expect(calls).toEqual(["emit", "dialog"]);
  });

  describe("forwarded provenance", () => {
    it("emits a non-degraded forwarded event with populated forwarding and the child's display projection", async () => {
      const { deps, events } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          source: "tool_call",
          agentName: "Explore",
          surface: "bash",
          value: "git push",
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
        }),
      );

      expect(events.emit).toHaveBeenCalledWith("permissions:ui_prompt", {
        requestId: "req-123",
        source: "tool_call",
        surface: "bash",
        value: "git push",
        agentName: "Explore",
        request: makePromptPayload().request,
        forwarding: {
          requesterAgentName: "Explore",
          requesterSessionId: "child-session",
        },
      });
    });

    it("uses the '(Subagent)' dialog title when the ask is forwarded", async () => {
      const { deps, ui, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);
      const details = makeDetails({
        forwarding: {
          requesterAgentName: "Explore",
          requesterSessionId: "child-session",
        },
      });

      await authorizer.authorize(details);

      // The notice carries the same forwarded title the dialog does.
      expect(decisionFn).toHaveBeenCalledWith(
        {
          mode: "tui",
          ui,
          ...makePromptPreferences(),
          notice: {
            title: "pi \u2014 refactor-auth",
            body: "Permission Required (Subagent): read",
          },
        },
        "Permission Required (Subagent)",
        details.payload,
        { forwarded: true },
      );
    });

    it("offers a sessionScope when the forwarded ask carries a suggestion", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          toolName: "bash",
          command: "git push",
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
          sessionApproval: { grants: [{ surface: "bash", pattern: "git *" }] },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        "Permission Required (Subagent)",
        expect.anything(),
        {
          forwarded: true,
          sessionScope: true,
        },
      );
    });

    it("names every path in the session label when the ask covers several", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          toolName: "bash",
          command: "cat /outside/a.ts > /elsewhere/b.ts",
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
          sessionApproval: {
            grants: [
              { surface: "external_directory_read", pattern: "/outside/*" },
              { surface: "external_directory_write", pattern: "/elsewhere/*" },
            ],
          },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        expect.objectContaining({
          forwarded: true,
          sessionScope: true,
          sessionLabel: expect.stringContaining("2 paths"),
        }),
      );
    });

    it("offers no sessionScope for a forwarded ask without a suggestion", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { forwarded: true },
      );
    });
  });

  describe("both-directions session grant (#813)", () => {
    /** Assert the options a bash ask with these grants reaches the dialog with. */
    async function expectOptionsFor(
      grants: { surface: string; pattern: string }[],
      expected: unknown,
    ) {
      const { deps, decisionFn } = makeDeps();
      await new LocalUserAuthorizer(deps).authorize(
        makeDetails({ toolName: "bash", sessionApproval: { grants } }),
      );
      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        expected,
      );
    }

    it("offers the direction label when every grant proves one direction", async () => {
      await expectOptionsFor(
        [{ surface: "external_directory_write", pattern: "/tmp/*" }],
        {
          sessionLabel: 'Yes, allow writes to "/tmp/*" for this session',
        },
      );
    });

    it("counts the paths when several grants prove the same direction", async () => {
      await expectOptionsFor(
        [
          { surface: "external_directory_read", pattern: "/outside/a/*" },
          { surface: "external_directory_read", pattern: "/outside/b/*" },
        ],
        {
          sessionLabel: "Yes, allow reads to 2 paths for this session",
        },
      );
    });

    it("offers no width option when the grants prove different directions", async () => {
      await expectOptionsFor(
        [
          { surface: "external_directory_read", pattern: "/outside/a/*" },
          { surface: "external_directory_write", pattern: "/outside/b/*" },
        ],
        { sessionLabel: "Yes, allow access to 2 paths for this session" },
      );
    });

    it("offers no width option for a non-directional surface", async () => {
      await expectOptionsFor(
        [{ surface: "bash", pattern: "git *" }],
        undefined,
      );
    });

    it("offers no width option for an ask with no suggestion at all", async () => {
      const { deps, decisionFn } = makeDeps();
      await new LocalUserAuthorizer(deps).authorize(makeDetails());
      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        undefined,
      );
    });
  });

  it("returns the decision from requestPermissionDecision", async () => {
    const decision: PermissionPromptDecision = {
      approved: false,
      state: "denied",
      decidedBy: DECIDED_BY_HUMAN,
    };
    const { deps } = makeDeps({
      requestPermissionDecision: vi
        .fn<typeof requestPermissionDecision>()
        .mockResolvedValue(decision),
    });
    const authorizer = new LocalUserAuthorizer(deps);

    const result = await authorizer.authorize(makeDetails());

    expect(result).toEqual(decision);
  });

  describe("one dialog at a time", () => {
    /**
     * A pair of asks whose first dialog stays open until the test answers it,
     * so "the second one has not been shown yet" is observable.
     */
    function makeOverlappingAsks() {
      const open = Promise.withResolvers<PermissionPromptDecision>();
      const decisionFn = vi
        .fn<typeof requestPermissionDecision>()
        .mockReturnValueOnce(open.promise)
        .mockResolvedValue(APPROVED);
      const { deps, events, dialogs } = makeDeps({
        requestPermissionDecision: decisionFn,
      });
      const authorizer = new LocalUserAuthorizer(deps);
      return {
        decisionFn,
        events,
        dialogs,
        answerFirst: () => {
          open.resolve(APPROVED);
        },
        first: authorizer.authorize(makeDetails()),
        second: authorizer.authorize(makeDetails()),
      };
    }

    describe("with an answer window", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("times each ask from when its own dialog is shown, not from when it queued", async () => {
        const { deps } = makeDeps({ requestPermissionDecision });
        // Pi's select resolves undefined when its signal dismisses it.
        deps.ui.select.mockImplementation(
          (
            _title: string,
            _options: string[],
            opts?: { signal?: AbortSignal },
          ) =>
            new Promise<string | undefined>((resolve) => {
              opts?.signal?.addEventListener(
                "abort",
                () => {
                  resolve(undefined);
                },
                { once: true },
              );
            }),
        );
        const authorizer = new LocalUserAuthorizer({
          ...deps,
          mode: "rpc",
          getPromptPreferences: () =>
            makePromptPreferences({ promptTimeoutMs: 60_000 }),
        });
        const unanswered = {
          approved: false,
          state: "denied",
          confirmationUnavailable: true,
          decidedBy: { kind: "unanswered", timeoutMs: 60_000 },
        };
        let secondSettled = false;

        const first = authorizer.authorize(makeDetails());
        const second = authorizer.authorize(makeDetails());
        void second.then(() => {
          secondSettled = true;
        });

        await vi.advanceTimersByTimeAsync(60_000);
        await expect(first).resolves.toStrictEqual(unanswered);
        expect(deps.ui.select).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(59_999);
        expect(secondSettled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(second).resolves.toStrictEqual(unanswered);
      });
    });

    it("does not present a second ask while the first dialog is open", async () => {
      const asks = makeOverlappingAsks();
      await settleMicrotasks();

      expect(asks.decisionFn).toHaveBeenCalledTimes(1);

      asks.answerFirst();
      await expect(asks.first).resolves.toEqual(APPROVED);
      await expect(asks.second).resolves.toEqual(APPROVED);
      expect(asks.decisionFn).toHaveBeenCalledTimes(2);
    });

    it("announces the second ask only when its dialog is presented", async () => {
      const asks = makeOverlappingAsks();
      await settleMicrotasks();

      expect(asks.events.emit).toHaveBeenCalledTimes(1);

      asks.answerFirst();
      await asks.first;
      await settleMicrotasks();

      expect(asks.events.emit).toHaveBeenCalledTimes(2);
      await asks.second;
    });

    it("answers a released ask as unavailable, never as a user denial", async () => {
      const asks = makeOverlappingAsks();
      await settleMicrotasks();

      asks.dialogs.releaseAll("the session ended");

      await expect(asks.first).resolves.toEqual({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        denialReason: "the session ended",
        decidedBy: { kind: "unavailable", reason: "the session ended" },
      });
      await expect(asks.second).resolves.toEqual({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        denialReason: "the session ended",
        decidedBy: { kind: "unavailable", reason: "the session ended" },
      });
    });
  });
});

describe("LocalUserAuthorizer — annotations", () => {
  function makeRunner(
    annotator: Parameters<AnnotatorRegistry["register"]>[1],
    timeoutMs = 1000,
  ) {
    const registry = new AnnotatorRegistry();
    registry.register("echo", annotator);
    return new AnnotationRunner({
      registry,
      getChain: () => ["echo"],
      getTimeoutMs: () => timeoutMs,
      log: makeAnnotationLog(),
    });
  }

  it("hands the dialog the payload exactly as the gate built it when nothing is added", async () => {
    const { deps, decisionFn } = makeDeps();
    const details = makeDetails();

    await new LocalUserAuthorizer(deps).authorize(details);

    expect(vi.mocked(decisionFn).mock.calls[0]?.[2]).toBe(details.payload);
  });

  it("passes the ask's captured authorizer context to the annotator, not the broadcast", async () => {
    const seen: Array<PromptPayload | undefined> = [];
    const { deps, events } = makeDeps({
      annotator: {
        annotate: (payload) => {
          seen.push(payload);
          return Promise.resolve(payload);
        },
      },
    });
    const details = makeDetails();
    // Stands in for what `escalate`'s pass-through log captured while the
    // chain judged this ask (plan item 5, D4).
    const log = captureAuthorizerContext(details, {
      review: vi.fn(),
      debug: vi.fn(),
    });
    log.review("jev_authorizer_verdict", {
      requestId: details.requestId,
      status: "deferred",
      source: "uncertain",
      rationale: "No condition was violated.",
    });

    await new LocalUserAuthorizer(deps).authorize(details);

    expect(seen[0]?.authorizerContext).toEqual([
      {
        event: "jev_authorizer_verdict",
        details: {
          requestId: "req-123",
          status: "deferred",
          source: "uncertain",
          rationale: "No condition was violated.",
        },
      },
    ]);
    // The broadcast stays built from the original details (ADR 0011 §6).
    expect(JSON.stringify(events.emit.mock.calls)).not.toContain(
      "jev_authorizer_verdict",
    );
  });

  it("shows the annotated payload but broadcasts the unannotated one", async () => {
    const annotated = {
      annotate: (payload: ReturnType<typeof makePromptPayload>) =>
        Promise.resolve({
          ...payload,
          annotations: [modelGeneratedAnnotation("echo", "routine push")],
        }),
    };
    const { deps, decisionFn, events } = makeDeps({ annotator: annotated });

    await new LocalUserAuthorizer(deps).authorize(makeDetails());

    expect(vi.mocked(decisionFn).mock.calls[0]?.[2].annotations).toEqual([
      modelGeneratedAnnotation("echo", "routine push"),
    ]);
    // ADR 0011 §6: the bus gets the request facts alone.
    expect(JSON.stringify(events.emit.mock.calls)).not.toContain(
      "routine push",
    );
  });

  it("annotates before it announces, so the broadcast is still immediately before the UI", async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      events: makeEvents(() => order.push("emit")),
      annotator: {
        annotate: (payload) => {
          order.push("annotate");
          return Promise.resolve(payload);
        },
      },
    });

    await new LocalUserAuthorizer(deps).authorize(makeDetails());

    expect(order).toEqual(["annotate", "emit"]);
  });

  it("puts the annotation on the select fallback surface too", async () => {
    const { deps, ui } = makeDeps();
    ui.select.mockResolvedValue("Yes");

    await new LocalUserAuthorizer({
      ...deps,
      mode: "rpc" as const,
      requestPermissionDecision,
      annotator: makeRunner(staticAnnotator("routine push")),
    }).authorize(makeDetails());

    expect(ui.select.mock.calls[0]?.[0]).toContain(
      "model-generated (echo) : routine push",
    );
  });

  it("shows the prompt unchanged when an annotator outlasts its deadline", async () => {
    vi.useFakeTimers();
    try {
      const { deps, decisionFn } = makeDeps({
        annotator: makeRunner(hangingAnnotator, 1000),
      });
      const details = makeDetails();
      const pending = new LocalUserAuthorizer(deps).authorize(details);
      await vi.advanceTimersByTimeAsync(1000);
      await pending;

      expect(decisionFn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(decisionFn).mock.calls[0]?.[2]).toBe(details.payload);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("LocalUserAuthorizer — a broken annotator cannot lose the ask", () => {
  const CEILING_MS = 1000 + 250;

  it("shows the prompt when the annotator throws synchronously", async () => {
    const { deps, decisionFn } = makeDeps({
      annotator: {
        annotate: () => {
          throw new Error("boom");
        },
      },
    });
    const details = makeDetails();

    await new LocalUserAuthorizer(deps).authorize(details);

    expect(vi.mocked(decisionFn).mock.calls[0]?.[2]).toBe(details.payload);
  });

  it("shows the prompt when the annotator rejects", async () => {
    const { deps, decisionFn } = makeDeps({
      annotator: { annotate: () => Promise.reject(new Error("boom")) },
    });
    const details = makeDetails();

    await new LocalUserAuthorizer(deps).authorize(details);

    expect(vi.mocked(decisionFn).mock.calls[0]?.[2]).toBe(details.payload);
  });

  it("records a clone failure and still decides the ask once", async () => {
    const log = makeAnnotationLog();
    const registry = new AnnotatorRegistry();
    registry.register("echo", () => "note");
    const payload = makePromptPayload();
    // A function is not structured-cloneable; inject one so the runner's own
    // clone, inside `consult`'s try, is what fails.
    (payload.request as unknown as Record<string, unknown>).value = () =>
      "uncloneable";
    const { deps, decisionFn } = makeDeps({
      annotator: new AnnotationRunner({
        registry,
        getChain: () => ["echo"],
        getTimeoutMs: () => 1000,
        log,
      }),
    });
    const details = makeDetails({ payload });

    await new LocalUserAuthorizer(deps).authorize(details);

    expect(decisionFn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(decisionFn).mock.calls[0]?.[2]).toBe(details.payload);
    expect(log.review).toHaveBeenCalledWith("annotator_failed", {
      requestId: "req-123",
      name: "echo",
      error: "DataCloneError",
    });
  });

  it("shows the prompt when the annotator never settles", async () => {
    vi.useFakeTimers();
    try {
      const { deps, decisionFn } = makeDeps({
        annotator: { annotate: () => new Promise(() => undefined) },
      });
      const details = makeDetails();
      const pending = new LocalUserAuthorizer(deps).authorize(details);

      await vi.advanceTimersByTimeAsync(CEILING_MS);
      await pending;

      expect(vi.mocked(decisionFn).mock.calls[0]?.[2]).toBe(details.payload);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not stall the next ask on the same session", async () => {
    vi.useFakeTimers();
    try {
      // One queue, as one session has: the hung ask must not hold the slot.
      const dialogs = new AskDialogQueue();
      const hanging = makeDeps({
        dialogs,
        annotator: { annotate: () => new Promise(() => undefined) },
      });
      const healthy = makeDeps({ dialogs });
      const hungDetails = makeDetails({ requestId: "req-hung" });
      const nextDetails = makeDetails({ requestId: "req-next" });
      const first = new LocalUserAuthorizer(hanging.deps).authorize(
        hungDetails,
      );
      const second = new LocalUserAuthorizer(healthy.deps).authorize(
        nextDetails,
      );

      await vi.advanceTimersByTimeAsync(CEILING_MS);
      await Promise.all([first, second]);

      expect(vi.mocked(hanging.decisionFn)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(healthy.decisionFn)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(hanging.decisionFn).mock.calls[0]?.[2]).toBe(
        hungDetails.payload,
      );
      expect(vi.mocked(healthy.decisionFn).mock.calls[0]?.[2]).toBe(
        nextDetails.payload,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("LocalUserAuthorizer — a malformed annotate result cannot lose the ask", () => {
  /** A decision double that renders like the real dialog, which reads the slot. */
  function makeRenderingDecision() {
    return vi.fn<typeof requestPermissionDecision>(
      async (_view, _title, payload) => {
        renderPromptDialog(payload, {
          ...makePromptPreferences().budget,
          width: 120,
        });
        return APPROVED;
      },
    );
  }

  const cases: [
    string,
    (payload: ReturnType<typeof makePromptPayload>) => unknown,
  ][] = [
    ["a non-object result", () => "not a payload"],
    [
      "a missing annotations slot",
      (payload) => {
        const { annotations: _annotations, ...rest } = payload;
        return rest;
      },
    ],
    [
      "a null annotations slot",
      (payload) => ({ ...payload, annotations: null }),
    ],
    [
      "a non-array annotations slot",
      (payload) => ({ ...payload, annotations: "nope" }),
    ],
    [
      "a junk slot member with no fields",
      (payload) => ({ ...payload, annotations: [{}] }),
    ],
    [
      "a non-string text",
      (payload) => ({
        ...payload,
        annotations: [{ source: "echo", text: 42, marking: "model-generated" }],
      }),
    ],
    ["a null slot member", (payload) => ({ ...payload, annotations: [null] })],
    [
      "a non-string source",
      (payload) => ({
        ...payload,
        annotations: [{ source: 7, text: "hi", marking: "model-generated" }],
      }),
    ],
    [
      "a slot member with no source",
      (payload) => ({
        ...payload,
        annotations: [{ text: "hi", marking: "model-generated" }],
      }),
    ],
    ["a payload with nothing but annotations", () => ({ annotations: [] })],
    [
      "a payload with request deleted",
      (payload) => {
        const { request: _request, ...rest } = payload;
        return rest;
      },
    ],
    [
      "a payload with evidence deleted",
      (payload) => {
        const { evidence: _evidence, ...rest } = payload;
        return rest;
      },
    ],
    ["an empty request object", (payload) => ({ ...payload, request: {} })],
    [
      "a throwing request getter",
      (payload) => {
        const hostile: Record<string, unknown> = {
          kind: payload.kind,
          evidence: payload.evidence,
          annotations: [],
        };
        Object.defineProperty(hostile, "request", {
          get() {
            throw new Error("hostile getter");
          },
        });
        return hostile;
      },
    ],
    [
      "a mixed annotations array (junk first)",
      (payload) => ({
        ...payload,
        annotations: [{}, modelGeneratedAnnotation("echo", "fine")],
      }),
    ],
    [
      "a mixed annotations array (junk last)",
      (payload) => ({
        ...payload,
        annotations: [modelGeneratedAnnotation("echo", "fine"), {}],
      }),
    ],
    [
      "a non-model-generated marking",
      (payload) => ({
        ...payload,
        annotations: [
          { source: "echo", text: "hi", marking: "verified-human" },
        ],
      }),
    ],
    [
      "a missing marking",
      (payload) => ({
        ...payload,
        annotations: [{ source: "echo", text: "hi" }],
      }),
    ],
  ];

  it.each(cases)(
    "falls back to the gate's payload for %s",
    async (_label, malformed) => {
      const dialogs = new AskDialogQueue();
      const broken = makeDeps({
        dialogs,
        requestPermissionDecision: makeRenderingDecision(),
        annotator: {
          annotate: (payload) =>
            Promise.resolve(malformed(payload) as PromptPayload),
        },
      });
      const healthy = makeDeps({
        dialogs,
        requestPermissionDecision: makeRenderingDecision(),
      });
      const brokenDetails = makeDetails({ requestId: "req-broken" });
      const nextDetails = makeDetails({ requestId: "req-next" });

      const first = new LocalUserAuthorizer(broken.deps).authorize(
        brokenDetails,
      );
      const second = new LocalUserAuthorizer(healthy.deps).authorize(
        nextDetails,
      );
      await Promise.all([first, second]);

      expect(vi.mocked(broken.decisionFn).mock.calls[0]?.[2]).toBe(
        brokenDetails.payload,
      );
      expect(vi.mocked(healthy.decisionFn).mock.calls[0]?.[2]).toBe(
        nextDetails.payload,
      );
    },
  );

  it("falls back when annotate itself resolves undefined", async () => {
    const dialogs = new AskDialogQueue();
    const broken = makeDeps({
      dialogs,
      requestPermissionDecision: makeRenderingDecision(),
      annotator: {
        annotate: () => Promise.resolve(undefined as unknown as PromptPayload),
      },
    });
    const healthy = makeDeps({
      dialogs,
      requestPermissionDecision: makeRenderingDecision(),
    });
    const brokenDetails = makeDetails({ requestId: "req-broken" });
    const nextDetails = makeDetails({ requestId: "req-next" });

    const first = new LocalUserAuthorizer(broken.deps).authorize(brokenDetails);
    const second = new LocalUserAuthorizer(healthy.deps).authorize(nextDetails);
    await Promise.all([first, second]);

    expect(vi.mocked(broken.decisionFn).mock.calls[0]?.[2]).toBe(
      brokenDetails.payload,
    );
    expect(vi.mocked(healthy.decisionFn).mock.calls[0]?.[2]).toBe(
      nextDetails.payload,
    );
  });

  it("still shows the prompt when the annotator drops the optional kind", async () => {
    const dialogs = new AskDialogQueue();
    const { deps, decisionFn } = makeDeps({
      dialogs,
      requestPermissionDecision: makeRenderingDecision(),
      annotator: {
        annotate: (payload) => {
          const { kind: _kind, ...rest } = payload;
          return Promise.resolve(rest as PromptPayload);
        },
      },
    });

    await new LocalUserAuthorizer(deps).authorize(makeDetails());

    expect(vi.mocked(decisionFn)).toHaveBeenCalledTimes(1);
  });

  it("still hands a well-formed result through unchanged", async () => {
    const details = makeDetails();
    // A well-behaved annotator authors only the slot, so `request` and
    // `evidence` stay the gate's own objects (by reference).
    const annotated = {
      ...details.payload,
      annotations: [modelGeneratedAnnotation("echo", "routine push")],
    };
    const { deps, decisionFn } = makeDeps({
      annotator: { annotate: () => Promise.resolve(annotated) },
    });

    await new LocalUserAuthorizer(deps).authorize(details);

    expect(vi.mocked(decisionFn).mock.calls[0]?.[2]).toBe(annotated);
  });
});
