/**
 * One source of truth for an ask's option list.
 *
 * The transcript line, the CLI wizard's rows, and the panel's answer line all
 * show the same options for the same question: same labels, same order, same
 * custom row. Any option a user can pick on one surface is pickable on the
 * others.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { askBlockedStatus } from "../src/herdr-status.ts";
import { questionOptions } from "../src/options.ts";
import { askCallLines } from "../src/render-call.ts";
import type { AskQuestion } from "../src/types.ts";

const CUSTOM_LABEL = "✎ Other (custom)";

/**
 * The panel's label form: the same label escaped for herdr's option-list regex
 * (one nesting level inside the answer line's parentheses) — the sanitizer's
 * contract, mirrored here so the test asserts what the panel actually shows.
 */
function panelForm(label: string): string {
  return label
    .replace(/\s+/g, " ")
    .trim()
    .replace(/·/g, "-")
    .replace(/\(/g, "[")
    .replace(/\)/g, "]");
}

function sourceLabels(q: AskQuestion): string[] {
  return questionOptions(q).map((item) => item.label);
}

test("select: the source, the transcript line, and the panel answer agree", () => {
  const q: AskQuestion = {
    question: "Which path?",
    type: "select",
    options: ["alpha", "beta"],
  };
  const labels = sourceLabels(q);
  assert.deepEqual(labels, ["alpha", "beta", CUSTOM_LABEL]);

  const line = askCallLines([q])[0];
  for (const label of labels) {
    assert.ok(line.includes(label), `transcript line shows ${label}: ${line}`);
  }

  const status = askBlockedStatus({ questions: [q] });
  assert.ok(
    status,
    "a select with a custom row always gets a button-bearing answer line",
  );
  // The wire carries only real labels; the custom row is the consumer's own
  // ✎-filter's job, not the panel answer line's.
  for (const label of labels.filter((l) => !/^✎/.test(l))) {
    assert.ok(
      status.message.includes(panelForm(label)),
      `panel answer line shows ${label}: ${status.message}`,
    );
  }
});

test("confirm: the source, the transcript line, and the panel answer agree", () => {
  const q: AskQuestion = {
    question: "Proceed?",
    type: "confirm",
    allow_custom: true,
  };
  const labels = sourceLabels(q);
  assert.deepEqual(labels, ["Yes", "No", CUSTOM_LABEL]);

  const line = askCallLines([q])[0];
  for (const label of labels) {
    assert.ok(line.includes(label), `transcript line shows ${label}: ${line}`);
  }

  const status = askBlockedStatus({ questions: [q] });
  assert.ok(
    status.message.startsWith("answer: "),
    `confirm gets an answer line: ${status.message}`,
  );
  // The wire carries only real labels; the custom row is the consumer's own
  // ✎-filter's job, not the panel answer line's.
  for (const label of labels.filter((l) => !/^✎/.test(l))) {
    assert.ok(
      status.message.includes(panelForm(label)),
      `panel answer line shows ${label}: ${status.message}`,
    );
  }
});

test("confirm without allow_custom stops at Yes/No", () => {
  const q: AskQuestion = { question: "Proceed?", type: "confirm" };
  assert.deepEqual(sourceLabels(q), ["Yes", "No"]);
});

test("a text question offers no options", () => {
  const q: AskQuestion = { question: "Name it", type: "text" };
  assert.deepEqual(sourceLabels(q), []);
  const status = askBlockedStatus({ questions: [q] });
  assert.equal(status.message.includes("answer: "), false);
});

test("object options keep their label and description, then the custom row", () => {
  const q: AskQuestion = {
    question: "Pick one",
    type: "select",
    options: [{ label: "read", description: "read the file" }, "write"],
  };
  const rows = questionOptions(q);
  assert.deepEqual(
    rows.map((row) => row.label),
    ["read", "write", CUSTOM_LABEL],
  );
  assert.equal(rows[0].description, "read the file");
  assert.equal(rows[0].value, "read");
  assert.equal(rows[2].value, "__askuser_custom__");
});
