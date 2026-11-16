/**
 * Contract check for the ask_user transcript (renderCall) lines.
 *
 * Run (no test-runner dependency beyond node:test — the upstream package ships none):
 *   node --test tests/render-call.test.ts
 *
 * local patch: mirrors src/render-call.ts, which upstream does not ship; re-apply
 * after package updates from upstream.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { askCallLines } from "../src/render-call.ts";
import type { OptionObject } from "../src/types.ts";
import { CUSTOM_LABEL } from "../src/types.ts";

test("batch of 2 select questions -> 2 option-bearing lines, labels in declaration order", () => {
	const lines = askCallLines([
		{ question: "Pick a fruit", type: "select", options: ["apple", "banana", "cherry"] },
		{ question: "Pick veggies", type: "multiselect", options: ["carrot", "pea", "bean"] },
	]);
	assert.equal(lines.length, 2);
	assert.equal(lines[0], `  1. Pick a fruit — apple / banana / cherry / ${CUSTOM_LABEL}`);
	assert.equal(lines[1], `  2. Pick veggies — carrot / pea / bean / ${CUSTOM_LABEL}`);
});

test("select with 2 options renders A / custom row", () => {
	const lines = askCallLines([{ question: "Pick", type: "select", options: ["A", "B"] }]);
	assert.deepEqual(lines, [`  1. Pick — A / B / ${CUSTOM_LABEL}`]);
});

test("multiselect includes the dialog's custom row", () => {
	const lines = askCallLines([{ question: "Tags", type: "multiselect", options: ["x"] }]);
	assert.deepEqual(lines, [`  1. Tags — x / ${CUSTOM_LABEL}`]);
});

test("non-array options does not throw and yields just the question line", () => {
	const bad = ["apple", undefined, {}] as unknown as (string | OptionObject)[];
	for (const options of bad) {
		const lines = askCallLines([{ question: "Fruit?", type: "select", options }]);
		assert.deepEqual(lines, ["  1. Fruit?"], `options=${JSON.stringify(options)}`);
	}
});

test("option object without a label -> question + custom row, no bare separator", () => {
	for (const option of [{}, { label: null }]) {
		const options = [option] as unknown as OptionObject[];
		const lines = askCallLines([{ question: "Pick", type: "select", options }]);
		assert.deepEqual(lines, [`  1. Pick — ${CUSTOM_LABEL}`], `option=${JSON.stringify(option)}`);
	}
});

test("well-formed option object label unaffected by the empty-label guard", () => {
	const lines = askCallLines([{ question: "Pick", type: "select", options: [{ label: "A" }] }]);
	assert.deepEqual(lines, [`  1. Pick — A / ${CUSTOM_LABEL}`]);
});

test("{ label, description } options -> labels used, descriptions ignored", () => {
	const lines = askCallLines([
		{
			question: "Choose a plan",
			type: "select",
			options: [
				{ label: "Basic", description: "free tier" },
				{ label: "Pro", description: "best value" },
			],
		},
	]);
	assert.deepEqual(lines, [`  1. Choose a plan — Basic / Pro / ${CUSTOM_LABEL}`]);
});

test("confirm -> Yes / No", () => {
	const lines = askCallLines([{ question: "Continue?", type: "confirm" }]);
	assert.deepEqual(lines, ["  1. Continue? — Yes / No"]);
});

test("confirm with allow_custom -> custom label appended", () => {
	const lines = askCallLines([{ question: "Continue?", type: "confirm", allow_custom: true }]);
	assert.deepEqual(lines, [`  1. Continue? — Yes / No / ${CUSTOM_LABEL}`]);
});

test("text question -> question text only, no option suffix", () => {
	const lines = askCallLines([{ question: "Name your favorite color?", type: "text" }]);
	assert.deepEqual(lines, ["  1. Name your favorite color?"]);
	assert.ok(!lines[0].includes(" / "), "text lines must not contain ' / '");
});

test("long question and labels containing newlines/spaces collapse to one line", () => {
	const lines = askCallLines([
		{
			question: "A very long\nquestion   with extra\twhitespace",
			type: "select",
			options: ["first\n  choice", "second   one"],
		},
	]);
	assert.deepEqual(lines, [`  1. A very long question with extra whitespace — first choice / second one / ${CUSTOM_LABEL}`]);
	for (const line of lines) {
		assert.ok(!line.includes("\n"), "lines must be single-line");
	}
});

test("counts/questions render with 1-based numbering", () => {
	const lines = askCallLines([
		{ question: "One?", type: "text" },
		{ question: "Two?", type: "text" },
		{ question: "Three?", type: "text" },
	]);
	assert.equal(lines.length, 3);
	lines.forEach((line, i) => {
		assert.ok(line.startsWith(`  ${i + 1}. `), `line ${i} must be numbered ${i + 1}`);
	});
});
