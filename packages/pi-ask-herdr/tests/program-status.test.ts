/**
 * Behavioural contract for OSC 7501 program status around the ask_user wizard:
 * while the question waits, the pane reports `blocked`; every exit path
 * (answered, cancelled, error) restores `working`. A cosmetic status write must
 * never break the question itself.
 *
 * Run (no test-runner dependency beyond node:test; Node ≥ 23.6 strips types
 * natively — the upstream `--experimental-transform-types` script flag no
 * longer exists on Node 26):
 *   node --test tests/program-status.test.ts
 *
 * The terminal under test is the one pi hands to the `ctx.ui.custom` factory:
 * in pi 1.2.0 `showExtensionCustom` calls `factory(this.ui, ...)`, `this.ui`
 * proxies to the renderer (`createInteractiveTuiReference`), and its
 * `terminal` (pi-tui `tui.d.ts`: `terminal: Terminal`) exposes
 * `setProgramStatus` (pi-tui `terminal.d.ts`). That is exactly what
 * `onBlocked`/`onSettled` receive as `tui.terminal` in src/ui.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { registerAskuserTool } from "../src/tool.ts";
import type { AskParams } from "../src/types.ts";

interface ProgramStatusWrite {
  state: string;
  app?: string;
  kind?: string;
  message?: string;
}

type Outcome = "answer" | "cancel" | "error";
type TerminalMode = "ok" | "missing" | "throw";

const PARAMS: AskParams = {
  questions: [
    {
      question: "Pick a fruit",
      type: "select",
      options: ["Banana", "Orange", "Other"],
    },
  ],
};

const ANSWERED_DETAILS = [
  {
    question: "Pick a fruit",
    type: "select" as const,
    options: PARAMS.questions[0].options,
    answer: "Banana",
    cancelled: false,
    custom: false,
  },
];

/** A terminal double: records writes, simulates a build without the OSC 7501
 * API, or one whose write throws. */
function makeTerminal(writes: ProgramStatusWrite[], mode: TerminalMode) {
  if (mode === "missing") return {};
  return {
    setProgramStatus(status: ProgramStatusWrite) {
      if (mode === "throw") throw new Error("terminal write failed");
      writes.push(status);
    },
  };
}

/**
 * Run the registered tool against a fake `ctx.ui.custom` that controls the
 * wizard's lifetime: the blocked status must already be on the terminal once
 * the factory returns (question waiting), and `working` must be the last write
 * after the custom dialog settles — on every outcome.
 */
function runAsk(outcome: Outcome, terminalMode: TerminalMode = "ok") {
  let tool: any;
  const pi = {
    registerTool(config: any) {
      tool = config;
    },
    events: { emit() {} },
  };
  registerAskuserTool(pi as any);

  const writes: ProgramStatusWrite[] = [];
  const tui: any = { terminal: makeTerminal(writes, terminalMode) };
  const ctx: any = {
    mode: "tui",
    sessionManager: { getSessionName: () => "demo-session" },
    ui: {
      custom(factory: any) {
        return new Promise((resolve, reject) => {
          // Mounting the wizard runs onBlocked synchronously (src/ui.ts).
          factory(tui, {}, {}, resolve);
          queueMicrotask(() => {
            if (outcome === "answer") resolve(ANSWERED_DETAILS);
            else if (outcome === "cancel") resolve(null);
            else reject(new Error("wizard exploded"));
          });
        });
      },
    },
  };

  const promise = tool.execute("call-1", PARAMS, undefined, () => {}, ctx);
  return { promise, writes };
}

function lastWrite(
  writes: ProgramStatusWrite[],
): ProgramStatusWrite | undefined {
  return writes[writes.length - 1];
}

test("reports blocked while the question waits, working after it is answered", async () => {
  const { promise, writes } = runAsk("answer");

  // The factory has run and the question is waiting: blocked must already be reported.
  assert.equal(
    writes.length,
    1,
    `expected only the blocked write while waiting: ${JSON.stringify(writes)}`,
  );
  assert.equal(writes[0].state, "blocked");
  assert.equal(writes[0].app, "pi");
  assert.equal(writes[0].kind, "question");
  assert.match(
    writes[0].message ?? "",
    /Pick a fruit/,
    "message must be derived from the question",
  );

  const result = await promise;
  assert.equal(result.details.cancelled, false);
  assert.equal(
    lastWrite(writes)?.state,
    "working",
    `last write must restore working: ${JSON.stringify(writes)}`,
  );
  assert.equal(
    lastWrite(writes)?.message,
    "demo-session",
    "restore carries the session name like the host does",
  );
  assert.equal(
    writes.length,
    2,
    `exactly blocked then working: ${JSON.stringify(writes)}`,
  );
});

test("restores working when the wizard is cancelled", async () => {
  const { promise, writes } = runAsk("cancel");

  assert.equal(
    writes[0]?.state,
    "blocked",
    "cancel path must report blocked while waiting",
  );

  const result = await promise;
  assert.equal(result.details.cancelled, true);
  assert.equal(lastWrite(writes)?.state, "working");
  assert.equal(
    writes.length,
    2,
    `exactly blocked then working: ${JSON.stringify(writes)}`,
  );
});

test("restores working when the wizard throws", async () => {
  const { promise, writes } = runAsk("error");

  assert.equal(
    writes[0]?.state,
    "blocked",
    "error path must report blocked while waiting",
  );

  await assert.rejects(promise, /wizard exploded/);
  assert.equal(
    lastWrite(writes)?.state,
    "working",
    "finally-style restore must not be skipped on error",
  );
  assert.equal(
    writes.length,
    2,
    `exactly blocked then working: ${JSON.stringify(writes)}`,
  );
});

test("a terminal whose setProgramStatus throws cannot break the question", async () => {
  const originalConsoleError = console.error;
  console.error = () => {}; // the helper logs the failed write; keep test output clean
  try {
    const { promise, writes } = runAsk("answer", "throw");
    const result = await promise;
    assert.equal(result.details.cancelled, false);
    assert.equal(
      writes.length,
      0,
      "no write can be recorded when the terminal throws",
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("a terminal without setProgramStatus cannot break the question", async () => {
  const { promise, writes } = runAsk("answer", "missing");
  const result = await promise;
  assert.equal(result.details.cancelled, false);
  assert.equal(
    writes.length,
    0,
    "the helper must no-op when the API is absent",
  );
});
