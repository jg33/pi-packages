// Self-check for ~/.config/herdr-app/mods/tabs-asks/engine.js (plain ESM, no test harness there).
//
//   node docs/superpowers/plans/artifacts/herdr-asks-engine-selfcheck.mjs [path/to/engine.js]
//
// engine.js imports the host-only module "herdr", so a resolve hook swaps it for an
// in-memory stub (shared state + a fake `hc read`). Node >= 23.5 (module.registerHooks).
// Imports engine.js by absolute path; reads nothing else from the mods tree and writes nothing.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const ENGINE =
  process.argv[2] ??
  `${process.env.HOME}/.config/herdr-app/mods/tabs-asks/engine.js`;
const MAIN = `${process.env.HOME}/.config/herdr-app/mods/asks/main.js`;
const FIFO = `${process.env.HOME}/.config/herdr-app/mods/asks-fifo/main.js`;
const SPACES = `${process.env.HOME}/.config/herdr-app/mods/spaces-asks/main.js`;

const STUB = `
export const terminals = () => globalThis.__terminals ?? [], agents = () => globalThis.__agents ?? [], focused = () => null, notify = () => {};
export const spaces = () => [], run = () => {}, theme = () => ({}), nextCommand = async () => null;
export const machines = () => [], panes = () => [], openOverlay = () => {}, watchFolder = () => {}, window = () => null, layout = () => null;
export const exec = async () => ({ code: 1, stdout: "", stderr: "" });
export const appHome = () => "/tmp";
export const readTextFile = async () => "";
export const shared = () => globalThis.__shared;
export const setShared = (_key, value) => { globalThis.__shared = value; };
export const hc = async (args) => {
  (globalThis.__hc ??= []).push(args);
  // Round 3: a scripted queue for hc read (dry read, then the painted dialog).
  if (args[0] === "read" && Array.isArray(globalThis.__reads)) return { code: 0, stdout: globalThis.__reads.shift() ?? JSON.stringify({ text: "" }), stderr: "" };
  if (args[0] === "keys" && args[2] === "enter") globalThis.__entered = true;
  if (args[0] === "get" && globalThis.__get) return { code: 0, stdout: JSON.stringify(globalThis.__entered && globalThis.__getAfter ? globalThis.__getAfter : globalThis.__get), stderr: "" };
  return { code: 0, stdout: JSON.stringify({ text: globalThis.__screen }), stderr: "" };
};
`;

// The Asks panel's UI layer is host-only: a recording node stands in for the fluent builder
// so card() runs for real; child()/children()/when() build a tree the tests walk (strings()).
const NODE = `
const node = () => {
  const target = { s: [], k: [] };
  const wrap = () => new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === "symbol") return () => "[node]";
      if (p === "child") return (x) => { if (typeof x === "string") t.s.push(x); else if (x && typeof x === "object") t.k.push(x); return wrap(); };
      if (p === "children") return (xs) => { for (const x of xs) { if (typeof x === "string") t.s.push(x); else if (x && typeof x === "object") t.k.push(x); } return wrap(); };
      if (p === "when") return (cond, fn) => { if (cond) fn(wrap()); return wrap(); };
      return () => wrap();
    },
  });
  return wrap();
};
`;
const GPUI_KIT = `${NODE}\nexport class View {}\nexport const div = node, svg = node, image = node;`;
const GPUI_BASE = `${NODE}\nexport const v_flex = node, h_flex = node, InputState = { new: () => node() }, Input = { new: () => node() };`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "herdr" ||
      specifier === "gpui-kit" ||
      specifier === "gpui-base"
    ) {
      const source =
        specifier === "herdr" ? STUB : specifier === "gpui-kit" ? GPUI_KIT : GPUI_BASE;
      return {
        url: `data:text/javascript,${encodeURIComponent(source)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { parseScreen, parseReport, Engine } = await import(
  pathToFileURL(ENGINE).href
);

const filler = (n) =>
  Array.from({ length: n }, (_, i) => `transcript line ${i}`).join("\n");

// An assistant message whose own numbered list is part of its prose. No cursor marker.
const PROSE_LIST = [
  "⏺ Three ways to fix the parser:",
  "  1. Rewrite the parser",
  "  2. Patch the regex",
  "  3. Leave it alone",
].join("\n");

// ask_user's wizard draws no digits at all: a rule, the question, rows with a › pointer.
const WIZARD = [
  "──────────────────────────────",
  " Which one should I do?",
  "",
  " › Rewrite",
  "   Patch",
  "   ✎ Other (custom)",
  "",
  " ↑↓ move · enter select · ^C cancel",
  "──────────────────────────────",
].join("\n");

// pi-permission-system / Claude Code style dialog: ❯ on the selected row.
const DIALOG = [
  "──────────────────────────────",
  " Allow bash: rm -rf build?",
  "",
  " ❯ 1. Allow once",
  "   2. Allow for this session",
  "   3. Deny",
  "",
  " enter confirm · esc cancel",
].join("\n");

test("parseScreen: dialog at the bottom -> its rows, cursor on the selected one", () => {
  const got = parseScreen(`${filler(10)}\n${DIALOG}`);
  assert.deepEqual(
    got.options.map((o) => [o.n, o.label]),
    [[1, "Allow once"], [2, "Allow for this session"], [3, "Deny"]],
  );
  assert.equal(got.cursor, 1);
});

test("parseScreen: prose list carries no cursor marker", () => {
  const got = parseScreen(`${PROSE_LIST}\n${WIZARD}`);
  assert.equal(got.cursor, null, "a prose list must never look like a dialog");
});

test("parseScreen: prose list far above the bottom is not scanned (Task 4)", () => {
  const got = parseScreen(`${PROSE_LIST}\n${filler(60)}\n${WIZARD}`);
  assert.deepEqual(got.options, []);
});

test("parseScreen: dialog still wins when a far prose list sits above it", () => {
  const got = parseScreen(`${PROSE_LIST}\n${filler(60)}\n${DIALOG}`);
  assert.deepEqual(got.options.map((o) => o.label), [
    "Allow once",
    "Allow for this session",
    "Deny",
  ]);
});

test("parseReport: multi-question producer output carries the first question's options (Task 1)", () => {
  const got = parseReport({
    kind: "question",
    msg: "answer: First pick? (y · n · ✎ Other [custom])",
  });
  assert.equal(got.kind, "DECISION");
  assert.equal(got.question, "First pick?");
  assert.deepEqual(got.options.map((o) => o.label), ["y", "n", "✎ Other [custom]"]);
});

test("parseReport: sanitized labels (brackets, no middle dot) keep every option", () => {
  const got = parseReport({
    kind: "question",
    msg: "answer: Debug? (fix [bug] now · Pro (recommended) · alpha - beta · ✎ Other [custom])",
  });
  assert.equal(got.options.length, 4);
  assert.equal(got.recommended, 1);
});

test("parseReport: no answer wrapper -> free-text QUESTION, no options", () => {
  const got = parseReport({ kind: "question", msg: "Name your favorite color?" });
  assert.equal(got.kind, "QUESTION");
  assert.deepEqual(got.options, []);
});

/** Seed one report-sourced ask, run the real Engine.enrich against a fake screen, return the stored ask. */
async function enrich(reportAsk, screen) {
  globalThis.__screen = screen;
  const ask = {
    id: "t1:0:x", address: "t1", state: "pending", turn: 0, msg: "m",
    kind: "QUESTION", question: "", options: [], recommended: null,
    context: "", raw: "", source: "report", confidence: 1, enriched: false,
    ...reportAsk,
  };
  globalThis.__shared = { schema: 1, asks: [ask] };
  const engine = new Engine();
  engine.config = { classify: "off" };
  const spawns = [];
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: (_ms, cb) => { cb(); } }, notify() {} };
  engine.enrich(ask.id, cx);
  // Drain every chained spawn (enrich plus its one bounded retry) before asserting.
  for (let i = 0; i < 4 && spawns.length; i++) await Promise.all(spawns.splice(0));
  return globalThis.__shared.asks[0];
}

test("enrich: report-sourced QUESTION + prose list in the transcript -> no buttons (the phantom-options bug)", async () => {
  const got = await enrich({ kind: "QUESTION", question: "Which one?" }, `${PROSE_LIST}\n${WIZARD}`);
  assert.deepEqual(got.options, []);
  assert.equal(got.kind, "QUESTION");
});

test("enrich: report-sourced APPROVAL still gets its buttons from the dialog's rows (pi-permission-system flow)", async () => {
  const got = await enrich({ kind: "APPROVAL", question: "Allow bash: rm -rf build" }, `${PROSE_LIST}\n${DIALOG}`);
  assert.deepEqual(got.options.map((o) => [o.n, o.label]), [
    [1, "Allow once"],
    [2, "Allow for this session"],
    [3, "Deny"],
  ]);
});

test("enrich: report options win; screen only supplies numbering when it lines up", async () => {
  const options = [
    { n: 1, label: "Allow once", detail: "" },
    { n: 2, label: "Allow for this session", detail: "" },
    { n: 3, label: "Deny", detail: "" },
  ];
  const got = await enrich({ kind: "DECISION", options }, DIALOG);
  assert.deepEqual(got.options.map((o) => o.label), options.map((o) => o.label));
});

const { default: Asks } = await import(pathToFileURL(MAIN).href);
const { default: Fifo } = await import(pathToFileURL(FIFO).href);
const { waiting } = await import(pathToFileURL(SPACES).href);

/** Every string a card render put on screen, walking the recording gpui tree. */
const strings = (n) => [...(n?.s ?? []), ...((n?.k ?? []).flatMap(strings))];

const makeAsk = (over = {}) => ({
  id: "a1:0:x", address: "t3", state: "pending", turn: 1, msg: "Pick one?",
  kind: "APPROVAL", question: "Allow it?", options: [], recommended: null,
  context: "", raw: "", source: "report", confidence: 1, enriched: true,
  detected_at: Date.now(), answer: null, answered_at: null, error: null, note: null,
  ...over,
});

const newPanel = () => {
  const panel = new Asks();
  panel.drafts = {}; panel.other = null; panel.all = false;
  return panel;
};

test("round 2: the ✎ row never renders as a button; the filtered count drives the render guard", async () => {
  const panel = newPanel();
  const now = Date.now();
  const mixed = strings(panel.card(makeAsk({ kind: "DECISION", question: "Pick a fruit?", options: [
    { n: 1, label: "Banana" }, { n: 2, label: "Orange" }, { n: 3, label: "✎ Other [custom]" },
  ] }), {}, now));
  assert.ok(mixed.includes("Banana") && mixed.includes("Orange"), "every real option renders");
  assert.ok(!mixed.some((s) => s.startsWith("✎")), "the custom row must not appear in the card tree");

  const onlyCustom = strings(panel.card(makeAsk({ kind: "DECISION", options: [{ n: 1, label: "✎ Other [custom]" }] }), {}, now));
  assert.ok(!onlyCustom.some((s) => s.startsWith("✎")), "no custom label");
  assert.ok(!onlyCustom.includes("1"), "post-filter count 0: no option row or digit badge at all");
});

test("round 2: answer() on a ✎ option is inert — note set, whole hc log empty", async () => {
  globalThis.__terminals = [];
  globalThis.__shared = { schema: 1, asks: [makeAsk({ kind: "DECISION", options: [{ n: 1, label: "✎ Other [custom]" }] })] };
  globalThis.__hc = [];
  const panel = newPanel();
  const ask = globalThis.__shared.asks[0];
  panel.answer(ask, ask.options[0], { notify() {} });
  assert.equal(globalThis.__shared.asks[0].note, "Answer ✎ in the terminal");
  assert.equal(globalThis.__shared.asks[0].state, "pending", "no state change toward answering");
  assert.deepEqual(globalThis.__hc, [], "zero hc calls of any kind");
});

test("round 2: a real dialog card still renders all its options and answers via the digit path", async () => {
  const panel = newPanel();
  const now = Date.now();
  const ask = makeAsk({ options: [{ n: 1, label: "Allow once" }, { n: 2, label: "Deny" }] });
  const rendered = strings(panel.card(ask, {}, now));
  assert.ok(rendered.includes("Allow once") && rendered.includes("Deny"), "every real option renders");

  globalThis.__terminals = [{ address: "t3", name: "t3", state: "live", turn: 1, status: { state: "blocked", msg: ask.msg } }];
  globalThis.__shared = { schema: 1, asks: [ask] };
  globalThis.__hc = [];
  const spawns = [];
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: (_ms, cb) => { cb(); } }, notify() {} };
  panel.answer(globalThis.__shared.asks[0], ask.options[1], cx);
  await Promise.all(spawns);
  assert.deepEqual(globalThis.__hc.filter((a) => a[0] === "keys")[0], ["keys", "t3", "2"], "the chosen row's digit");
  assert.ok(!globalThis.__hc.some((a) => a[0] === "send"), "a real option never falls back to hc send");
  assert.equal(globalThis.__shared.asks[0].state, "delivered");
});

/** Run one Engine.tick against the given terminals; returns the spawned tasks (checkTurn/enrich). */
async function tick(terminals, config) {
  globalThis.__terminals = terminals;
  globalThis.__shared = { schema: 1, asks: [] };
  globalThis.__screen = "";
  const engine = new Engine();
  engine.config = config;
  const spawns = [];
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: (_ms, cb) => { cb(); } }, notify() {} };
  engine.tick(cx);
  await Promise.all(spawns);
  return { spawns, asks: globalThis.__shared.asks };
}

/** tick() plus every chained spawn (enrich and its one bounded retry) until nothing new appears. */
async function drain(terminals, config) {
  globalThis.__terminals = terminals;
  globalThis.__shared = { schema: 1, asks: [] };
  globalThis.__screen = "";
  const engine = new Engine();
  engine.config = config;
  const spawns = [];
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: (_ms, cb) => { cb(); } }, notify() {} };
  engine.tick(cx);
  for (let i = 0; i < 12 && spawns.length; i++) {
    const batch = spawns.splice(0);
    await Promise.all(batch);
  }
  return { engine, asks: globalThis.__shared.asks };
}

test("Task 7: trailing_questions: false -> a done turn spawns no scanner and makes no card (true control does)", async () => {
  const done = [{ address: "t1", name: "t1", state: "live", turn: 5, status: "done" }];
  const off = await tick(done, { classify: "auto", trailing_questions: false, toast: false });
  assert.equal(off.spawns.length, 0, "the flag alone must gate the scanner (classify stays auto)");
  assert.deepEqual(off.asks, [], "a finished turn must not produce a card");

  const on = await tick(done, { classify: "auto", trailing_questions: true, toast: false });
  assert.equal(on.spawns.length, 1, "control: with the flag true checkTurn runs");
  assert.deepEqual(on.asks, [], "the card itself still needs the classifier to see a question");
});

test("Task 7: trailing_questions: false -> a blocked turn still produces its card", async () => {
  const blocked = [{
    address: "t2", name: "t2", state: "live", turn: 2, status: "blocked",
    report: { kind: "question", msg: "answer: Pick a fruit? (Banana · Orange)" },
  }];
  const got = await tick(blocked, { classify: "off", trailing_questions: false, toast: false });
  assert.equal(got.asks.length, 1, "the real-prompt path must keep working");
  assert.equal(got.asks[0].kind, "DECISION");
  assert.equal(got.asks[0].source, "report");
  assert.deepEqual(got.asks[0].options.map((o) => o.label), ["Banana", "Orange"]);
});

// ---- round 3: dry-read retry + keystroke-card free text ----

const PERMISSION_TERMINAL = [{ address: "t1", name: "t1", state: "live", turn: 2, status: { state: "blocked", kind: "permission", msg: "approve bash: rm -rf /tmp/x" } }];
const PAINTED_DIALOG = ["Allow this command?", "", "❯ 1. Yes", "  2. No"].join("\n");
const R3_CFG = { classify: "off", trailing_questions: false, toast: false };
const queueReads = (...bodies) => { globalThis.__reads = bodies.map((b) => JSON.stringify({ text: b })); };
const hcReads = () => (globalThis.__hc ?? []).filter((a) => a[0] === "read").length;

test("round 3: a dry read retries once and lands the dialog's options; hc read runs exactly twice", async () => {
  globalThis.__hc = [];
  queueReads("", PAINTED_DIALOG);
  const { asks } = await drain(PERMISSION_TERMINAL, R3_CFG);
  assert.equal(asks.length, 1);
  assert.deepEqual(asks[0].options.map((o) => o.label), ["Yes", "No"], "the painted dialog's rows become the buttons");
  assert.equal(hcReads(), 2, "exactly two hc read calls: dry, then painted");
  assert.equal(asks[0].state, "pending");
});

test("round 3: the retry is bounded — a second dry pass never schedules a third", async () => {
  globalThis.__hc = [];
  queueReads("", ""); // the dialog never paints
  const { asks } = await drain(PERMISSION_TERMINAL, R3_CFG);
  assert.equal(hcReads(), 2, "exactly two hc read calls, never three");
  assert.equal(asks[0].options.length, 0);
  assert.equal(asks[0].state, "pending");
});

test("round 3: a first pass that finds options schedules no retry", async () => {
  globalThis.__hc = [];
  queueReads(PAINTED_DIALOG);
  const { asks } = await drain(PERMISSION_TERMINAL, R3_CFG);
  assert.equal(hcReads(), 1, "one read, no retry");
  assert.deepEqual(asks[0].options.map((o) => o.label), ["Yes", "No"]);
});

test("round 3: a non-report ask never retries", async () => {
  globalThis.__hc = [];
  queueReads("");
  const noReport = [{ address: "t9", name: "t9", state: "live", turn: 7, status: "blocked" }];
  const { asks } = await drain(noReport, R3_CFG);
  assert.equal(asks[0].source, "none");
  assert.equal(hcReads(), 1, "one read, no retry for source !== report");
});

test("round 3: free text on a keystroke (dialog) card is inert — whole hc log empty", async () => {
  globalThis.__hc = []; globalThis.__reads = null; globalThis.__terminals = [];
  globalThis.__shared = { schema: 1, asks: [makeAsk({ options: [{ n: 1, label: "Yes" }] })] };
  const panel = newPanel();
  const ask = globalThis.__shared.asks[0];
  panel.sendText(ask, "let it pass", { notify() {} });
  assert.equal(globalThis.__shared.asks[0].note, "Answer it in the terminal");
  assert.equal(globalThis.__shared.asks[0].state, "pending", "nothing was sent");
  assert.deepEqual(globalThis.__hc, [], "zero hc calls of any kind");
});

test("round 3: a delivery:'send' (prose turn) card keeps its free text", async () => {
  globalThis.__hc = []; globalThis.__reads = null;
  globalThis.__terminals = [{ address: "t3", name: "t3", state: "live", turn: 4, status: "idle" }];
  globalThis.__shared = { schema: 1, asks: [makeAsk({ delivery: "send", kind: "QUESTION", question: "Which path?", options: [], turn: 4, msg: "" })] };
  const panel = newPanel();
  panel.input = { set_value() {} };
  const spawns = [];
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: (_ms, cb) => { cb(); } }, notify() {} };
  panel.sendText(globalThis.__shared.asks[0], "use uv", cx);
  await Promise.all(spawns);
  assert.ok(globalThis.__hc.some((a) => a[0] === "send" && a.includes("use uv")), "the typed text must go out");
  assert.equal(globalThis.__shared.asks[0].state, "delivered");
});

// ---- round 4: R3b regression fix, retried cap, state recheck at fire time ----

test("round 4: a report QUESTION card with no options keeps its free text (R3b regression)", async () => {
  globalThis.__hc = []; globalThis.__reads = null;
  const msg = "answer: Name your favorite color?";
  globalThis.__terminals = [{ address: "t5", name: "t5", state: "live", turn: 3, status: { state: "blocked", msg } }];
  globalThis.__shared = { schema: 1, asks: [makeAsk({ address: "t5", turn: 3, msg, kind: "QUESTION", question: "Name your favorite color?", options: [] })] };
  const panel = newPanel();
  panel.input = { set_value() {} };
  const spawns = [];
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: (_ms, cb) => { cb(); } }, notify() {} };
  panel.sendText(globalThis.__shared.asks[0], "my answer", cx);
  await Promise.all(spawns);
  assert.ok(globalThis.__hc.some((a) => a[0] === "send" && a.includes("my answer")), "the typed text must go out");
  assert.equal(globalThis.__shared.asks[0].state, "delivered");
});

test("round 4: this.retried stays capped at MAX_CHECKED (the s.checked pattern)", async () => {
  globalThis.__hc = []; globalThis.__reads = null; globalThis.__terminals = [];
  const N = 305; // engine.js MAX_CHECKED = 300
  globalThis.__shared = { schema: 1, asks: Array.from({ length: N }, (_, i) => makeAsk({ id: `t${i}:2:h${i}`, address: `t${i}`, kind: "APPROVAL", question: `q ${i}`, options: [] })) };
  const engine = new Engine();
  engine.config = R3_CFG;
  const spawns = [];
  // Timers are never fired here: the assertion sees retried exactly as the 305 adds left it.
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: () => {} }, notify() {} };
  for (const ask of globalThis.__shared.asks) engine.enrich(ask.id, cx);
  await Promise.all(spawns.splice(0)); // pass 1s; the retry timers stay captured
  const ids = globalThis.__shared.asks.map((a) => a.id);
  assert.equal(engine.retried.size, 300, `exactly MAX_CHECKED entries after ${N} adds, got ${engine.retried.size}`);
  assert.ok(engine.retried.has(ids[N - 1]), "the newest id must survive the slice");
  assert.ok(!engine.retried.has(ids[0]), "the oldest id must be evicted");
});

test("round 4: the retry's second pass rechecks pending before applying its patch", async () => {
  globalThis.__hc = []; globalThis.__reads = null; globalThis.__terminals = [];
  globalThis.__shared = { schema: 1, asks: [makeAsk({ id: "t7:2:z", address: "t7", kind: "APPROVAL", question: "Allow it?", options: [] })] };
  const engine = new Engine();
  engine.config = R3_CFG;
  const spawns = [];
  let fire = null;
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: (_ms, cb) => { fire = cb; } }, notify() {} };
  engine.enrich("t7:2:z", cx);
  await Promise.all(spawns.splice(0)); // pass 1: dry, retry scheduled, its 2 s timer captured
  assert.equal(typeof fire, "function", "pass 1 must have scheduled the retry");
  globalThis.__shared.asks[0].state = "delivered"; // answered before the timer fired
  globalThis.__shared.asks[0].raw = "OLDRAW"; // marker written after pass 1 — pass 2 must leave it alone
  fire();
  await new Promise((r) => setImmediate(r)); // pass 2 runs to completion
  const after = globalThis.__shared.asks[0];
  assert.equal(after.state, "delivered");
  assert.equal(after.raw, "OLDRAW", "pass 2 must not Object.assign its patch onto a resolved ask");
});

test("round 5: a no-option APPROVAL card can never reach sendText", async () => {
  globalThis.__hc = []; globalThis.__reads = null; globalThis.__terminals = [];
  globalThis.__shared = { schema: 1, asks: [makeAsk({ kind: "APPROVAL", question: "Allow bash: rm -rf /tmp/x", options: [] })] };
  const panel = newPanel();
  panel.input = { set_value() {} };
  panel.sendText(globalThis.__shared.asks[0], "yes please", { notify() {} });
  assert.equal(globalThis.__shared.asks[0].note, "Answer it in the terminal");
  assert.equal(globalThis.__shared.asks[0].state, "pending", "nothing was sent");
  assert.deepEqual(globalThis.__hc, [], "zero hc calls — an Enter here would confirm the ❯ row (ALLOW)");
});

// ---- round 6: Enter-after-digit gate (pi-ask-herdr advances on the digit itself) ----

const pickTwo = () => ({
  terminals: [{ address: "t3", name: "t3", state: "live", turn: 1, status: { state: "blocked", msg: "Pick one?" } }],
  // get: the dialog still looks unchanged (hc read racing the repaint); after Enter: gone/idle.
  get: { state: "live", status: { state: "blocked", msg: "Pick one?" }, turn: 1 },
  getAfter: { state: "live", status: { state: "idle" }, turn: 2 },
});

async function clickOption(ask, index) {
  const panel = newPanel();
  const spawns = [];
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: (_ms, cb) => { cb(); } }, notify() {} };
  panel.answer(ask, ask.options[index], cx);
  await Promise.all(spawns);
  return globalThis.__hc.filter((a) => a[0] === "keys");
}

test("round 7: a report DECISION presses only the digit and fails honestly when the screen never changes (MF1/MF2)", async () => {
  const seed = pickTwo();
  globalThis.__hc = []; globalThis.__reads = null;
  globalThis.__terminals = seed.terminals;
  globalThis.__get = seed.get; globalThis.__getAfter = seed.getAfter; globalThis.__entered = false;
  globalThis.__shared = { schema: 1, asks: [makeAsk({ source: "report", kind: "DECISION", options: [{ n: 1, label: "Banana" }, { n: 2, label: "Orange" }] })] };
  const t0 = Date.now();
  const keys = await clickOption(globalThis.__shared.asks[0], 1);
  const elapsed = Date.now() - t0;
  assert.deepEqual(keys, [["keys", "t3", "2"]], "digit only: Enter would answer the next question with its default");
  assert.equal(globalThis.__shared.asks[0].state, "failed", "a still-same screen must fail honestly — never a false delivered");
  assert.match(globalThis.__shared.asks[0].error, /No reaction/);
  assert.ok(elapsed >= 7900, `the honest failure must wait out the full 8 s settle window (took ${elapsed}ms)`);
});

test("round 6: a foreign (screen-sourced) dialog still gets Enter after the digit", async () => {
  const seed = pickTwo();
  globalThis.__hc = []; globalThis.__reads = null;
  globalThis.__terminals = seed.terminals;
  globalThis.__get = seed.get; globalThis.__getAfter = seed.getAfter; globalThis.__entered = false;
  globalThis.__shared = { schema: 1, asks: [makeAsk({ source: "screen", options: [{ n: 1, label: "Yes" }, { n: 2, label: "No" }] })] };
  const keys = await clickOption(globalThis.__shared.asks[0], 1);
  assert.deepEqual(keys, [["keys", "t3", "2"], ["keys", "t3", "enter"]], "a foreign dialog may need Enter to confirm");
  assert.equal(globalThis.__shared.asks[0].state, "delivered");
});

test("MF1: a report APPROVAL still presses Enter — permission rows arm on the digit, Enter commits", async () => {
  const seed = pickTwo();
  globalThis.__hc = []; globalThis.__reads = null;
  globalThis.__terminals = seed.terminals;
  globalThis.__get = seed.get; globalThis.__getAfter = seed.getAfter; globalThis.__entered = false;
  globalThis.__shared = { schema: 1, asks: [makeAsk({ source: "report", kind: "APPROVAL", options: [{ n: 1, label: "Allow once" }, { n: 2, label: "Deny" }] })] };
  const keys = await clickOption(globalThis.__shared.asks[0], 0);
  assert.deepEqual(keys, [["keys", "t3", "1"], ["keys", "t3", "enter"]], "doublePressToConfirm: digit arms, Enter commits");
  assert.equal(globalThis.__shared.asks[0].state, "delivered");
});

test("MF3: choose in terminal: prefix maps to UNCLEAR and the card offers no free text", async () => {
  const got = parseReport({ kind: "question", msg: "choose in terminal: Which stack should we use?" });
  assert.equal(got.kind, "UNCLEAR");
  assert.equal(got.question, "Which stack should we use?");
  assert.deepEqual(got.options, []);
  assert.equal(got.source, "report");
  const plain = parseReport({ kind: "question", msg: "answer: Name your favorite color?" });
  assert.equal(plain.kind, "QUESTION", "plain text questions stay free-text QUESTIONs");

  const panel = newPanel();
  const rendered = strings(panel.card(makeAsk({ kind: got.kind, question: got.question, options: got.options, enriched: true }), {}, Date.now()));
  assert.ok(rendered.some((s) => s.includes("Open the terminal")), "the existing open-the-terminal affordance shows");
  assert.ok(!rendered.includes("Answer") && !rendered.includes("Other answer"), "no free-text control on a choose-in-terminal card");
});

test("MF4: the asks-fifo fork's ✎ guard is inert — note set, zero hc calls", async () => {
  globalThis.__hc = []; globalThis.__reads = null; globalThis.__terminals = [];
  globalThis.__shared = { schema: 1, asks: [makeAsk({ options: [{ n: 3, label: "✎ Other [custom]" }] })] };
  const panel = new Fifo();
  panel.drafts = {}; panel.other = null; panel.input = { set_value() {} };
  panel.answer(globalThis.__shared.asks[0], globalThis.__shared.asks[0].options[0], { notify() {} });
  assert.equal(globalThis.__shared.asks[0].note, "Answer ✎ in the terminal");
  assert.equal(globalThis.__shared.asks[0].state, "pending", "no state change toward answering");
  assert.deepEqual(globalThis.__hc, [], "zero hc calls — no digit, no Enter");
});

test("MF4: the asks-fifo fork's Enter gate — a report DECISION presses only the digit", async () => {
  const seed = pickTwo();
  globalThis.__hc = []; globalThis.__reads = null;
  globalThis.__terminals = seed.terminals;
  globalThis.__get = seed.get; globalThis.__getAfter = seed.getAfter; globalThis.__entered = false;
  globalThis.__shared = { schema: 1, asks: [makeAsk({ source: "report", kind: "DECISION", options: [{ n: 1, label: "Banana" }, { n: 2, label: "Orange" }] })] };
  const panel = new Fifo();
  panel.drafts = {}; panel.other = null; panel.input = { set_value() {} };
  const spawns = [];
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: (_ms, cb) => { cb(); } }, notify() {} };
  panel.answer(globalThis.__shared.asks[0], globalThis.__shared.asks[0].options[1], cx);
  const t0 = Date.now();
  await Promise.all(spawns);
  const elapsed = Date.now() - t0;
  const keys = globalThis.__hc.filter((a) => a[0] === "keys");
  assert.deepEqual(keys, [["keys", "t3", "2"]], "no Enter on a report DECISION");
  assert.equal(globalThis.__shared.asks[0].state, "failed", "stale screen fails honestly");
  assert.match(globalThis.__shared.asks[0].error, /No reaction/);
  assert.ok(elapsed >= 7900, `the honest failure must wait out the full 8 s settle window (took ${elapsed}ms)`);
});

// ---- round 8: exact legacy-custom matcher + fifo ports ----

const MIXED_CUSTOM = [{ n: 1, label: "✎ Other [custom]" }, { n: 2, label: "✎ edit by hand" }];
const newFifo = () => {
  const panel = new Fifo();
  panel.drafts = {}; panel.other = null; panel.all = false; panel.input = { set_value() {} };
  return panel;
};

test("G1: only the exact legacy custom row is filtered — a real ✎ label renders and answers", async () => {
  const panel = newPanel();
  const rendered = strings(panel.card(makeAsk({ kind: "DECISION", question: "Pick tags", options: MIXED_CUSTOM }), {}, Date.now()));
  assert.ok(rendered.includes("✎ edit by hand"), "a real model option beginning with ✎ must render");
  assert.ok(!rendered.includes("✎ Other [custom]"), "the stale legacy custom row must not render");

  globalThis.__hc = []; globalThis.__reads = null;
  globalThis.__get = null; globalThis.__getAfter = null; globalThis.__entered = false;
  globalThis.__terminals = [{ address: "t3", name: "t3", state: "live", turn: 1, status: { state: "blocked", msg: "Pick one?" } }];
  globalThis.__shared = { schema: 1, asks: [makeAsk({ kind: "DECISION", options: [{ n: 1, label: "✎ edit by hand" }] })] };
  const spawns = [];
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: (_ms, cb) => { cb(); } }, notify() {} };
  panel.answer(globalThis.__shared.asks[0], globalThis.__shared.asks[0].options[0], cx);
  await Promise.all(spawns);
  const keys = globalThis.__hc.filter((a) => a[0] === "keys");
  assert.deepEqual(keys, [["keys", "t3", "1"]], "the real option's digit must be pressed, not inerted");
  assert.equal(globalThis.__shared.asks[0].state, "delivered");
});

test("G2: the fifo card filters only the exact legacy custom row", () => {
  const panel = newFifo();
  const rendered = strings(panel.card(makeAsk({ kind: "DECISION", question: "Pick tags", options: MIXED_CUSTOM }), {}, Date.now()));
  assert.ok(rendered.includes("✎ edit by hand"), "a real model option beginning with ✎ must render");
  assert.ok(!rendered.includes("✎ Other [custom]"), "the stale legacy custom row must not render");
});

test("G2: the fifo ✎ guard matches the exact legacy label — a real ✎ option answers by digit", async () => {
  globalThis.__hc = []; globalThis.__reads = null;
  globalThis.__get = null; globalThis.__getAfter = null; globalThis.__entered = false;
  globalThis.__terminals = [{ address: "t3", name: "t3", state: "live", turn: 1, status: { state: "blocked", msg: "Pick one?" } }];
  globalThis.__shared = { schema: 1, asks: [makeAsk({ kind: "DECISION", options: [{ n: 1, label: "✎ edit by hand" }] })] };
  const panel = newFifo();
  const spawns = [];
  const cx = { spawn: (fn) => { spawns.push(fn(cx)); }, timer: { after: (_ms, cb) => { cb(); } }, notify() {} };
  panel.answer(globalThis.__shared.asks[0], globalThis.__shared.asks[0].options[0], cx);
  await Promise.all(spawns);
  const keys = globalThis.__hc.filter((a) => a[0] === "keys");
  assert.deepEqual(keys, [["keys", "t3", "1"]], "the real option's digit must be pressed, not inerted");
  assert.equal(globalThis.__shared.asks[0].state, "delivered");
});

test("G2: the fifo sendText guard is inert on an optioned keystroke card", async () => {
  globalThis.__hc = []; globalThis.__reads = null; globalThis.__get = null; globalThis.__terminals = [];
  globalThis.__shared = { schema: 1, asks: [makeAsk({ options: [{ n: 1, label: "Yes" }] })] };
  const panel = newFifo();
  panel.sendText(globalThis.__shared.asks[0], "let it pass", { notify() {} });
  assert.equal(globalThis.__shared.asks[0].note, "Answer it in the terminal");
  assert.equal(globalThis.__shared.asks[0].state, "pending", "nothing was sent");
  assert.deepEqual(globalThis.__hc, [], "zero hc calls of any kind");
});

test("NICE-2: the per-space pill counts report-sourced UNCLEAR (choose-in-terminal) asks", () => {
  globalThis.__shared = { schema: 1, asks: [
    { state: "pending", space: "s1", kind: "DECISION", source: "report" },
    { state: "pending", space: "s1", kind: "UNCLEAR", source: "report" },
    { state: "pending", space: "s1", kind: "UNCLEAR", source: "screen" },
    { state: "pending", space: "s2", kind: "QUESTION", source: "model" },
    { state: "stale", space: "s1", kind: "DECISION", source: "report" },
  ] };
  assert.equal(waiting("s1"), 2, "report-UNCLEAR counts; foreign-dialog UNCLEAR and non-pending do not");
  assert.equal(waiting("s2"), 1);
});
