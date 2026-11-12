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

const ANSWER_RE = /^answer:\s*([\s\S]*?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/;
const OPTION_SEP = " · ";

function parseAnswer(message: string): { question: string; options: string[] } {
	const m = ANSWER_RE.exec(message);
	assert.ok(m, `message must match herdr's answer pattern: ${JSON.stringify(message)}`);
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
		questions: [{ question: "Pick a fruit", type: "select", options: ["apple", "banana", "cherry"] }],
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
	assert.ok(!message.includes("[recommended]"), "bracket form must not be produced");
});

test("label containing ' · ' cannot shift numbering", () => {
	const message = blocked({
		questions: [{ question: "Order?", type: "select", options: ["first", "alpha · beta", "third"] }],
	});
	const { options } = parseAnswer(message);
	assert.deepEqual(options, ["first", "alpha - beta", "third"]);
	assert.equal(options.length, 3, "no extra split entries");
});

test("parens in a label are bracketed, never nested", () => {
	const message = blocked({
		questions: [{ question: "Debug?", type: "select", options: ["fix (bug) now", "plain", "other (x"] }],
	});
	const { options } = parseAnswer(message);
	assert.deepEqual(options, ["fix [bug] now", "plain", "other [x"]);
});

test("multiselect uses the answer format", () => {
	const message = blocked({
		questions: [{ question: "Pick tags", type: "multiselect", options: ["red", "green", "blue"] }],
	});
	const { question, options } = parseAnswer(message);
	assert.equal(question, "Pick tags");
	assert.deepEqual(options, ["red", "green", "blue"]);
});

test("text question degrades to the bare question", () => {
	const message = blocked({ questions: [{ question: "Name your favorite color?", type: "text" }] });
	assert.equal(message, "Name your favorite color?");
	assert.ok(!ANSWER_RE.test(message), "bare message must not parse as an answer");
});

test("2-question batch degrades to the bare first question", () => {
	const message = blocked({
		questions: [
			{ question: "First pick?", type: "select", options: ["y", "n"] },
			{ question: "Second pick?", type: "text" },
		],
	});
	assert.equal(message, "First pick?");
	assert.ok(!ANSWER_RE.test(message), "batches cannot be answered by one keypress");
});

test("empty batch produces no blocked option", () => {
	assert.equal(askBlockedStatus({ questions: [] }), undefined);
});
