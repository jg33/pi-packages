/**
 * One-shot contract check for the herdr Asks `blocked` message.
 *
 * Run (no test-runner dependency beyond node:test — the upstream package ships none):
 *   node --test tests/herdr-status.test.ts
 * (Node ≥ 23.6 strips types natively; the upstream `--experimental-transform-types`
 * script flag no longer exists on Node 26.)
 *
 * Asserts every representative batch against herdr's REAL patterns:
 *   answer: /^answer:\s*([\s\S]*?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/
 *   option split on " · " (space U+00B7 space) yields the expected labels in order.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { askBlockedStatus } from "../src/herdr-status.ts";
import type { AskParams } from "../src/types.ts";

const ANSWER_RE =
  /^answer:\s*([\s\S]*?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/;
const OPTION_SEP = " · ";

function parseAnswer(message: string): { question: string; options: string[] } {
  const m = ANSWER_RE.exec(message);
  assert.ok(
    m,
    `message must match herdr's answer pattern: ${JSON.stringify(message)}`,
  );
  return { question: m[1], options: m[2].split(OPTION_SEP) };
}

function blocked(params: AskParams): string {
  const status = askBlockedStatus(params);
  assert.ok(status, "expected a blocked status");
  assert.equal(status.kind, "question");
  return status.message;
}

test("single select, 3 plain options", () => {
  const message = blocked({
    questions: [
      {
        question: "Pick a fruit",
        type: "select",
        options: ["apple", "banana", "cherry"],
      },
    ],
  });
  const { question, options } = parseAnswer(message);
  assert.equal(question, "Pick a fruit");
  assert.deepEqual(options, ["apple", "banana", "cherry"]);
});

test("(recommended) survives sanitization intact", () => {
  const message = blocked({
    questions: [
      {
        question: "Choose a plan",
        type: "select",
        options: [
          { label: "Basic", description: "free tier" },
          { label: "Pro (recommended)", description: "best value" },
          { label: "Max" },
        ],
      },
    ],
  });
  const { options } = parseAnswer(message);
  assert.deepEqual(options, ["Basic", "Pro (recommended)", "Max"]);
  assert.ok(message.includes("(recommended)"), "marker must keep its parens");
  assert.ok(
    !message.includes("[recommended]"),
    "bracket form must not be produced",
  );
});

test("label containing ' · ' cannot shift numbering", () => {
  const message = blocked({
    questions: [
      {
        question: "Order?",
        type: "select",
        options: ["first", "alpha · beta", "third"],
      },
    ],
  });
  const { options } = parseAnswer(message);
  assert.deepEqual(options, ["first", "alpha - beta", "third"]);
  assert.equal(options.length, 3, "no extra split entries");
});

test("parens in a label are bracketed, never nested", () => {
  const message = blocked({
    questions: [
      {
        question: "Debug?",
        type: "select",
        options: ["fix (bug) now", "plain", "other (x"],
      },
    ],
  });
  const { options } = parseAnswer(message);
  assert.deepEqual(options, ["fix [bug] now", "plain", "other [x"]);
});

test("multiselect never gets a wrapper (a digit only toggles)", () => {
  const message = blocked({
    questions: [
      {
        question: "Pick tags",
        type: "multiselect",
        options: ["red", "green", "blue"],
      },
    ],
  });
  assert.equal(message, "choose in terminal: Pick tags");
  assert.ok(
    !ANSWER_RE.test(message),
    "buttons cannot express a multiselect answer",
  );
});

test("text question degrades to the bare question", () => {
  const message = blocked({
    questions: [{ question: "Name your favorite color?", type: "text" }],
  });
  assert.equal(message, "Name your favorite color?");
  assert.ok(
    !ANSWER_RE.test(message),
    "bare message must not parse as an answer",
  );
});

test("confirm reports Yes / No, custom row stays off the wire", () => {
  const message = blocked({
    questions: [{ question: "Proceed?", type: "confirm", allow_custom: true }],
  });
  const { question, options } = parseAnswer(message);
  assert.equal(question, "Proceed?");
  assert.deepEqual(options, ["Yes", "No"]);
  assert.ok(!message.includes("✎"), "the custom row never reaches the wire");
});

test("select with no usable label gets choose in terminal", () => {
  const message = blocked({
    questions: [{ question: "Pick?", type: "select", options: ["", " "] }],
  });
  assert.equal(message, "choose in terminal: Pick?");
  assert.ok(!ANSWER_RE.test(message), "digits cannot reach a blank row");
});

test("select with 1 real option gets choose in terminal", () => {
  const message = blocked({
    questions: [{ question: "Go alone?", type: "select", options: ["only"] }],
  });
  assert.equal(message, "choose in terminal: Go alone?");
  assert.ok(
    !ANSWER_RE.test(message),
    "a single button invites the Enter-press path",
  );
});

test("custom row is identified by value, not by label", () => {
  const message = blocked({
    questions: [
      {
        question: "Edit?",
        type: "select",
        options: ["a", "✎ edit by hand", "c"],
      },
    ],
  });
  const { question, options } = parseAnswer(message);
  assert.equal(question, "Edit?");
  assert.deepEqual(options, ["a", "✎ edit by hand", "c"]);
});

test("a real label that sanitizes to empty forces choose in terminal", () => {
  const message = blocked({
    questions: [
      { question: "Blank?", type: "select", options: ["a", "", "c"] },
    ],
  });
  assert.equal(message, "choose in terminal: Blank?");
  assert.ok(
    !ANSWER_RE.test(message),
    "filtering the blank would shift every later digit",
  );
});

test("2 real options still emit the wrapper", () => {
  const { question, options } = parseAnswer(
    blocked({
      questions: [{ question: "Go?", type: "select", options: ["go", "stop"] }],
    }),
  );
  assert.equal(question, "Go?");
  assert.deepEqual(options, ["go", "stop"]);
});

test("8 real options emit exactly those labels, no custom row", () => {
  const message = blocked({
    questions: [
      {
        question: "Eight picks?",
        type: "select",
        options: Array.from({ length: 8 }, (_, i) => `opt${i + 1}`),
      },
    ],
  });
  const { question, options } = parseAnswer(message);
  assert.equal(question, "Eight picks?");
  assert.deepEqual(options, [
    "opt1",
    "opt2",
    "opt3",
    "opt4",
    "opt5",
    "opt6",
    "opt7",
    "opt8",
  ]);
});

test("9 real options still emit the wrapper (custom row excluded)", () => {
  const message = blocked({
    questions: [
      {
        question: "Nine picks?",
        type: "select",
        options: Array.from({ length: 9 }, (_, i) => `opt${i + 1}`),
      },
    ],
  });
  assert.ok(!message.includes("✎"), "the custom row never reaches the wire");
  const { question, options } = parseAnswer(message);
  assert.equal(question, "Nine picks?");
  assert.deepEqual(options, [
    "opt1",
    "opt2",
    "opt3",
    "opt4",
    "opt5",
    "opt6",
    "opt7",
    "opt8",
    "opt9",
  ]);
  assert.ok(
    !options.some((o) => o.includes("✎")),
    "no ✎ label survives the consumer regex split",
  );
});

test("10 real options get choose in terminal", () => {
  const message = blocked({
    questions: [
      {
        question: "Many picks?",
        type: "select",
        options: Array.from({ length: 10 }, (_, i) => `opt${i + 1}`),
      },
    ],
  });
  assert.equal(message, "choose in terminal: Many picks?");
  assert.ok(
    !ANSWER_RE.test(message),
    "a 10th button would arrive as digits '1','0' and pick option 1",
  );
});

const BATCH: AskParams = {
  questions: [
    { question: "First pick?", type: "select", options: ["y", "n"] },
    { question: "Second pick?", type: "text" },
    { question: "Third pick?", type: "confirm" },
  ],
};

test("2+ question batch reports the first question with its own labels", () => {
  const { question, options } = parseAnswer(blocked(BATCH));
  assert.equal(question, "First pick?");
  assert.deepEqual(options, ["y", "n"]);
});

test("index selects the question on screen", () => {
  assert.equal(askBlockedStatus(BATCH, 1)?.message, "Second pick?");
  const { question, options } = parseAnswer(
    askBlockedStatus(BATCH, 2)!.message,
  );
  assert.equal(question, "Third pick?");
  assert.deepEqual(options, ["Yes", "No"]);
  assert.equal(askBlockedStatus(BATCH, 3), undefined);
});

test("empty batch produces no blocked option", () => {
  assert.equal(askBlockedStatus({ questions: [] }), undefined);
});

// Byte math for the fixtures below: "answer: "(8) + question + " ("(2) + labels + ")"(1),
// separators " · " are 4 bytes each (U+00B7 is 2 bytes).
test("an over-cap answer message falls back to choose in terminal", () => {
  // 9 × 40 CJK labels = 1080 B, 8 separators = 32 B, question = 972 B
  // → wrapper would be 2095 B, over pi's 2048-byte status cap.
  const question = "問".repeat(324);
  const message = blocked({
    questions: [
      {
        question,
        type: "select",
        options: Array.from({ length: 9 }, () => "漢".repeat(40)),
      },
    ],
  });
  assert.equal(message, `choose in terminal: ${question}`);
  assert.ok(
    !ANSWER_RE.test(message),
    "a truncated wrapper parses as a bare QUESTION with a free-text box",
  );
});

test("ASCII wrapper sits exactly at the 2048-byte cap", () => {
  // "answer: "(8) + question + " ("(2) + "aa · bb"(8) + ")"(1) = question + 19.
  const question = "x".repeat(2048 - 19);
  const underMsg = blocked({
    questions: [{ question, type: "select", options: ["aa", "bb"] }],
  });
  assert.ok(underMsg.startsWith("answer: "), "the 2048-byte wrapper survives");
  assert.equal(new TextEncoder().encode(underMsg).length, 2048);

  const overMsg = blocked({
    questions: [
      { question: `${question}x`, type: "select", options: ["aa", "bb"] },
    ],
  });
  assert.equal(overMsg, `choose in terminal: ${question}x`);
});
