# herdr Asks: real options show as buttons, prose lists never do — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `ask_user` that has choices shows them as clickable buttons in herdr's Asks panel, and a numbered list that is only part of a prompt's prose never becomes buttons.

**Architecture:** One causal chain, fixed at both ends. Producer (`pi-ask-herdr`): report the question the wizard is *showing*, with that question's options, and re-report when the wizard moves to another question. Consumer (`~/.config/herdr-app/mods/tabs-asks/engine.js`): adopt screen-scraped numbered rows for a report-sourced ask only when they are a live dialog (a row carries the `❯` cursor), and scan only the bottom of the screen.

**Tech Stack:** TypeScript (producer, `node:test`, `tsc`, biome); plain ESM JavaScript (consumer, no harness; checked by a node self-check that stubs the host module `"herdr"`).

**Spec:** `/Users/jesse/.pi/agent/sessions/--Users-jesse-Developer-repos--/artifacts/01a1ec39-a628-727f-bbf6-01ae44ec27b3/context/planner-asks-fix-2026-11-18T01-27-19.md` (context brief; scope chosen by the user: both sides, minimal — no permission/approval routing, no refactors).

**Evidence:** `docs/superpowers/plans/artifacts/evidence-herdr-asks-options.md` (HEAD 400762e1). Absolute: `/Users/jesse/Developer/repos/pi/pi-packages/docs/superpowers/plans/artifacts/evidence-herdr-asks-options.md`

## Global Constraints

- Scope: producer `packages/pi-ask-herdr/` and consumer `~/.config/herdr-app/mods/tabs-asks/engine.js` only. No permission/approval routing, no refactors, no new dependencies.
- No new files except tests and the one self-check script (already written: `docs/superpowers/plans/artifacts/herdr-asks-engine-selfcheck.mjs`).
- Repo commands run from the repo root `/Users/jesse/Developer/repos/pi/pi-packages` as `pnpm -C packages/pi-ask-herdr run <script>` — `cd packages/<pkg>` is a deny rule there (`AGENTS.md`).
- Commit messages are conventional (`committed.toml`: types `feat|fix|perf|revert|docs|style|chore|refactor|test|build|ci`), scope `pi-ask-herdr`, and are signed as Jesse Garrison <jesse@nightlight.io>. Use `git commit -m`, never `-F` from a heredoc (deny rule).
- English only in code, comments, commits.
- Consumer is user-local JS outside any git repo: back up before editing, no commit (see "Where things live").

---

## Where things live (version control)

| Location | Git? | Consequence |
|---|---|---|
| `/Users/jesse/Developer/repos/pi/pi-packages` (contains `packages/pi-ask-herdr`) | yes, HEAD `400762e1` [E32] | plan, ledger, self-check and the producer change live here; commit normally |
| `/Users/jesse/.config/herdr-app/mods/` (and `~/.config/herdr-app/`) | **no** — `git rev-parse` fails in both [E22] | no history, no review flow. House convention is a sibling backup `engine.js.bak-<YYYYMMDD-HHMMSS>` (cf. `main.js.bak-20261116-115628`). Mods hot-reload [E22], so an edit is live the moment it is saved |
| Pi loads the extension from the working tree | `~/.pi/agent/settings.json:38` [E23] | a producer edit needs only a pi `/reload` (or a new session) [A2] |

`asks-fifo/` and `asks/` are view-only panels: each imports only its own `./state.js` and there is exactly one `engine.js`, in `tabs-asks/` [E21]. **Nothing to mirror — do not duplicate the engine change into `asks-fifo/`.**

---

## Problem

One chain, two symptoms:

1. The producer drops options. `askBlockedStatus` returns the bare first question for any multi-question batch [E1], and for a question with fewer than two usable labels (a text question — legitimately). The report then arrives as `kind: "question"`, `msg: "<question>"` → consumer `parseReport` → `{kind: "QUESTION", options: []}` [E31].
2. The consumer then runs `parseScreen`, which scans every visible line for a `1. 2. …` run [E14] — and `hc read` returns the whole visible screen [E18]. If the model's prose above the prompt contains a numbered list, that list is found.
3. `engine.js:239-241` adopts it as clickable options for any report-sourced ask that has none [E15].
4. Clicking a button presses its digit into the live dialog, and presses Enter if nothing changed [E17]. The digit hits whatever the terminal is really showing.

Symptom (a): multi-question asks lose their real choices (step 1). Symptom (b): prose lists become buttons (steps 2–3).

Note the wizard draws **no digits** on its rows [E8]: for `ask_user` the screen never contains the dialog's own numbered options, so for a report-sourced `ask_user` card the screen scrape can only ever produce phantoms.

## Two corrections to the brief (verified, not opinion)

**Correction 1 — the brief's Edit 2 (delete `engine.js:239-241`) is wrong; do not apply it.** pi-permission-system *does* route its prompts: it reports `kind: "permission"`, which `parseReport` turns into an APPROVAL ask with `options: []`, and **its Allow/Deny buttons come from exactly the branch the brief deletes** — its own code comment says so [E19], and an earlier plan was built on it [E20]. Experiment: with only that branch deleted, the self-check's "report-sourced APPROVAL still gets its buttons" test fails [E25]. Replacement (Task 3): keep the branch, add `&& parsed.cursor != null`. The permission dialog renders `❯ 1. …` on the selected row [E19]; prose lists have no `❯`. With the guard, all 10 self-check cases pass [E26].

**Correction 2 — the brief's Edit 1 assumption ("answering advances the wizard to question 2 and a fresh report follows") does not hold.** The `blocked` option is computed once at `ctx.ui.custom(...)` and the host type is a static `{kind, message}` [E4]; the extension re-emits only at mount [E5]; `advance()`/`back()` report nothing [E7]. Consequence if Edit 1 shipped alone: after clicking an option for question 1 the panel keeps showing question 1's buttons (same `msg`, so `stillAsking` is true and the card never goes stale) [E16][E17], and its "press Enter if the dialog looks unchanged" step then **presses Enter on question 2 and auto-answers it with the cursor row**. Fix (Task 2): a small `onQuestionChange` hook so each question change re-emits that question's status; the changed `msg` makes the consumer retire the old card and create a new one [E16], and makes the panel's Enter-check see a changed dialog [E17]. Experiment: with the hook, 36/36 producer tests pass; with the hook call removed, the new wizard test fails [E27].

**Tasks 1 and 2 ship together or not at all.**

---

## Task table

| id | owner | depends on | parallel group | files | verification command |
|---|---|---|---|---|---|
| T1 | Worker | — | A | `packages/pi-ask-herdr/src/herdr-status.ts`, `packages/pi-ask-herdr/tests/herdr-status.test.ts` | `pnpm -C packages/pi-ask-herdr exec node --import ./tests/typescript-transform-hooks.mjs --test tests/herdr-status.test.ts` → 11 pass |
| T2 | Worker | T1 | A | `packages/pi-ask-herdr/src/ui.ts`, `packages/pi-ask-herdr/src/tool.ts`, `packages/pi-ask-herdr/tests/program-status.test.ts` | `pnpm -C packages/pi-ask-herdr run typecheck && pnpm -C packages/pi-ask-herdr run test` → 36 pass |
| T3 | Worker | — | B | `/Users/jesse/.config/herdr-app/mods/tabs-asks/engine.js` (guard) | `node docs/superpowers/plans/artifacts/herdr-asks-engine-selfcheck.mjs` → 9 pass / 1 fail (the window test) |
| T4 | Worker | T3 | B | `/Users/jesse/.config/herdr-app/mods/tabs-asks/engine.js` (window) | same command → 10 pass / 0 fail |
| T5 | caller (needs a live pi + herdr) | T1–T4 | — | none | manual e2e checklist below |

Parallel groups: A (T1→T2) and B (T3→T4) touch disjoint files in disjoint locations; the only shared symbol is the *wire format* (`answer: <q> (a · b)`), which neither group changes [E2][E30]. Within a group tasks are sequential (T2 consumes T1's new signature; T3 and T4 edit the same file). Landing order if staged: T3/T4 are safe alone (they only remove phantom buttons); T1 must not land without T2.

---

### Task 1: Producer — report the question on screen, with its own options

**Files:**
- Modify: `packages/pi-ask-herdr/src/herdr-status.ts:46-75` [E1][E2][E3]
- Modify: `packages/pi-ask-herdr/tests/herdr-status.test.ts:147-159` [E11]

**Interfaces:**
- Consumes: `questionOptions(q: AskQuestion): OptionItem[]` (`src/options.ts:33-47`) [E3]; existing `sanitizeLabel`, `singleLine` (unchanged) [E2].
- Produces: `askBlockedStatus(params: AskParams, index = 0): AskBlockedStatus | undefined` — the status for `params.questions[index]`; `undefined` when that index does not exist. Existing callers pass one argument and keep working [E30]. Task 2 calls it with `index`.

The `labels.length < 2` guard stays: a text question legitimately has no options and reports the bare question.

- [ ] **Step 1: Replace the pinned-downgrade test with the new contract (red)**

In `packages/pi-ask-herdr/tests/herdr-status.test.ts`, replace exactly this block (lines 147-159):

```ts
test("2-question batch degrades to the bare first question", () => {
  const message = blocked({
    questions: [
      { question: "First pick?", type: "select", options: ["y", "n"] },
      { question: "Second pick?", type: "text" },
    ],
  });
  assert.equal(message, "First pick?");
  assert.ok(
    !ANSWER_RE.test(message),
    "batches cannot be answered by one keypress",
  );
});
```

with:

```ts
test("confirm reports Yes / No", () => {
  const { question, options } = parseAnswer(
    blocked({ questions: [{ question: "Proceed?", type: "confirm" }] }),
  );
  assert.equal(question, "Proceed?");
  assert.deepEqual(options, ["Yes", "No"]);
});

test("fewer than 2 usable labels stays a bare question", () => {
  const message = blocked({
    questions: [{ question: "Pick?", type: "select", options: ["", " "] }],
  });
  assert.equal(message, "Pick?");
  assert.ok(!ANSWER_RE.test(message), "a lone custom row is not a choice");
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
  assert.deepEqual(options, ["y", "n", "✎ Other [custom]"]);
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
```

Already covered by existing tests in the same file (do not duplicate): 1 select with N labels → `answer: … (a · b · …)`; label containing `·` and parens sanitized and still matching the consumer regex (`parseAnswer` uses the consumer's real regex); text question → bare question.

- [ ] **Step 2: Run to verify red**

Run: `pnpm -C packages/pi-ask-herdr exec node --import ./tests/typescript-transform-hooks.mjs --test tests/herdr-status.test.ts`
Expected: FAIL — `index selects the question on screen` (the 2nd argument is ignored) and `2+ question batch reports the first question with its own labels` (message is the bare `First pick?`, so `parseAnswer` asserts "must match herdr's answer pattern").

- [ ] **Step 3: Implement**

In `packages/pi-ask-herdr/src/herdr-status.ts` replace lines 46-75:

Current:

```ts
/**
 * Button-bearing status for exactly one question whose option list carries two
 * or more usable labels (confirm's Yes/No, a select's options plus its custom
 * row); the bare first question otherwise (multi-question asks cannot be
 * answered by a single number press); `undefined` for an empty batch.
 */
export function askBlockedStatus(
  params: AskParams,
): AskBlockedStatus | undefined {
  const first = params.questions[0];
  if (!first) return undefined;
  const question = singleLine(first.question);

  if (params.questions.length !== 1) {
    return { kind: "question", message: question };
  }

  // Single source: the same questionOptions(q) the wizard and the transcript
  // line render — model options plus the custom row, or confirm's Yes/No.
  const labels = questionOptions(first)
    .map((item) => sanitizeLabel(item.label))
    .filter((label) => label.length > 0);
  if (labels.length < 2) return { kind: "question", message: question };
  return {
    kind: "question",
    message: `answer: ${question} (${labels.join(" · ")})`,
  };
}
```

Target:

```ts
/**
 * Button-bearing status for the question the wizard is showing (`index`; the
 * wire format carries one question and one option set) when its option list
 * carries two or more usable labels (confirm's Yes/No, a select's options plus
 * its custom row); the bare question otherwise; `undefined` when there is no
 * such question.
 */
export function askBlockedStatus(
  params: AskParams,
  index = 0,
): AskBlockedStatus | undefined {
  const current = params.questions[index];
  if (!current) return undefined;
  const question = singleLine(current.question);

  // Single source: the same questionOptions(q) the wizard and the transcript
  // line render — model options plus the custom row, or confirm's Yes/No.
  const labels = questionOptions(current)
    .map((item) => sanitizeLabel(item.label))
    .filter((label) => label.length > 0);
  if (labels.length < 2) return { kind: "question", message: question };
  return {
    kind: "question",
    message: `answer: ${question} (${labels.join(" · ")})`,
  };
}
```

- [ ] **Step 4: Run to verify green**

Run: `pnpm -C packages/pi-ask-herdr exec node --import ./tests/typescript-transform-hooks.mjs --test tests/herdr-status.test.ts`
Expected: PASS, 11 tests (8 before, minus the 1 replaced test, plus 4 new).
Run: `pnpm -C packages/pi-ask-herdr run typecheck`
Expected: only `$ tsc --noEmit`, no diagnostics.

- [ ] **Step 5: Lint the touched files**

Run: `pnpm exec biome check packages/pi-ask-herdr/src/herdr-status.ts packages/pi-ask-herdr/tests/herdr-status.test.ts`
Expected: no errors (both were clean at baseline).

- [ ] **Step 6: Commit** — deferred: Tasks 1 and 2 ship together, so commit once, after Task 2 step 6. `pnpm -C packages/pi-ask-herdr run test` at this point: `ℹ pass 35` (32 − 1 + 4).

---

### Task 2: Producer — re-report when the wizard shows another question

**Files:**
- Modify: `packages/pi-ask-herdr/src/ui.ts:296-299` (constructor), `:456` and `:466` (`advance`/`back`), `:595-600` (`AskWizardHooks`), `:617-624` (`new AskWizard`) [E5][E7]
- Modify: `packages/pi-ask-herdr/src/tool.ts:129-141` (hooks object passed to `askBatchInTui`) [E5]
- Test: `packages/pi-ask-herdr/tests/program-status.test.ts` (append)

**Interfaces:**
- Consumes: `askBlockedStatus(params, index)` (Task 1); `reportAskBlocked(terminal, message)` (`src/program-status.ts:48`) [E9].
- Produces: `AskWizardHooks.onQuestionChange?: (tui: TUI, index: number) => void` — called after the wizard's current index changes (an answer advances, Esc steps back), never at mount and never on the last answer.

Why a hook and not a refactor: the wizard owns `index` privately [E7]; the tool owns the terminal-status writes [E5]. This mirrors the existing `onBlocked`/`onSettled` seam, adds ~15 lines, and the pi host does not interfere (its reporter re-emits only on its own state changes [E10][A3]).

- [ ] **Step 1: Write the failing test (red)**

Append to `packages/pi-ask-herdr/tests/program-status.test.ts` (it already defines `makeTerminal`, `lastWrite`, `ProgramStatusWrite`, `registerAskuserTool`, `AskParams`):

```ts

test("showing another question re-reports that question's options", async () => {
  let tool: any;
  registerAskuserTool({
    registerTool(config: any) {
      tool = config;
    },
    events: { emit() {} },
  } as any);

  const writes: ProgramStatusWrite[] = [];
  const tui: any = {
    terminal: makeTerminal(writes, "ok"),
    requestRender() {},
  };
  let wizard: any;
  const ctx: any = {
    mode: "tui",
    sessionManager: { getSessionName: () => "demo-session" },
    ui: {
      custom(factory: any) {
        return new Promise((resolve) => {
          wizard = factory(tui, {}, { matches: () => false }, resolve);
        });
      },
    },
  };
  const params: AskParams = {
    questions: [
      { question: "First pick?", type: "select", options: ["a", "b"] },
      { question: "Second pick?", type: "select", options: ["c", "d"] },
    ],
  };

  const promise = tool.execute("call-1", params, undefined, () => {}, ctx);
  assert.equal(
    lastWrite(writes)?.message,
    "answer: First pick? (a · b · ✎ Other [custom])",
  );

  wizard.handleInput("1"); // a digit picks the row and advances
  assert.equal(lastWrite(writes)?.state, "blocked");
  assert.equal(
    lastWrite(writes)?.message,
    "answer: Second pick? (c · d · ✎ Other [custom])",
  );

  wizard.handleInput("\x1b"); // Esc steps back
  assert.equal(
    lastWrite(writes)?.message,
    "answer: First pick? (a · b · ✎ Other [custom])",
  );

  wizard.handleInput("\x03"); // Ctrl+C cancels the batch
  const result = await promise;
  assert.equal(result.details.cancelled, true);
  assert.equal(lastWrite(writes)?.state, "working");
});
```

(`{ matches: () => false }` is needed: `OptionList.handleInput` calls `keybindings.matches` for any non-digit key [E6]. The test ends cancelled so the wizard's `finish()` runs and `onSettled` writes `working`.)

- [ ] **Step 2: Run to verify red**

Run: `pnpm -C packages/pi-ask-herdr exec node --import ./tests/typescript-transform-hooks.mjs --test tests/program-status.test.ts`
Expected: FAIL `showing another question re-reports that question's options` — after `handleInput("1")` the last write is still the first question's message.

- [ ] **Step 3: Implement the hook in `src/ui.ts`**

Four edits, 2-space indentation (this file uses spaces).

(a) Constructor — add a last parameter. Current (`ui.ts:296-299`):

```ts
    private doneCb: (result: AskDetails[] | null) => void,
    private abortSignal?: AbortSignal,
  ) {
```

Target:

```ts
    private doneCb: (result: AskDetails[] | null) => void,
    private abortSignal?: AbortSignal,
    private onQuestionChange?: (index: number) => void,
  ) {
```

(b) `advance()` — current (`:456-458`):

```ts
    this.index++;
    this.child = this.buildChild();
  }
```

Target:

```ts
    this.index++;
    this.onQuestionChange?.(this.index);
    this.child = this.buildChild();
  }
```

(c) `back()` — current (`:466-468`):

```ts
    this.index--;
    this.child = this.buildChild();
  }
```

Target:

```ts
    this.index--;
    this.onQuestionChange?.(this.index);
    this.child = this.buildChild();
  }
```

(d) `AskWizardHooks` and the `new AskWizard(...)` call. Current (`:595-600`):

```ts
export interface AskWizardHooks {
  /** Called once the wizard is on screen and waiting for the user. */
  onBlocked?: (tui: TUI) => void;
  /** Called after the wizard returns, whether it was answered or cancelled. */
  onSettled?: (tui: TUI) => void;
}
```

Target:

```ts
export interface AskWizardHooks {
  /** Called once the wizard is on screen and waiting for the user. */
  onBlocked?: (tui: TUI) => void;
  /** Called when the wizard shows another question (an answer advances, Esc steps back). */
  onQuestionChange?: (tui: TUI, index: number) => void;
  /** Called after the wizard returns, whether it was answered or cancelled. */
  onSettled?: (tui: TUI) => void;
}
```

Current (`:617-624`):

```ts
        return new AskWizard(
          params,
          wizardTui,
          theme,
          keybindings,
          done,
          signal,
        );
```

Target:

```ts
        return new AskWizard(
          params,
          wizardTui,
          theme,
          keybindings,
          done,
          signal,
          (index) => hooks?.onQuestionChange?.(wizardTui, index),
        );
```

- [ ] **Step 4: Wire the hook in `src/tool.ts`**

`tool.ts` indents with **tabs**. Insert between the `onBlocked` and `onSettled` entries (current `:129-136`):

```ts
					onBlocked: (tui) => {
						try {
							reportAskBlocked(tui.terminal, askBlockedStatus(params)?.message);
						} catch (err) {
							console.error("[pi-ask-herdr] failed to report ask blocked status:", err);
						}
					},
					onSettled: (tui) => {
```

Target:

```ts
					onBlocked: (tui) => {
						try {
							reportAskBlocked(tui.terminal, askBlockedStatus(params)?.message);
						} catch (err) {
							console.error("[pi-ask-herdr] failed to report ask blocked status:", err);
						}
					},
					// The wire format carries one question: re-report whenever the wizard shows another,
					// so the panel's buttons (and its Enter-after-digit check) follow the question on screen.
					onQuestionChange: (tui, index) => {
						try {
							reportAskBlocked(tui.terminal, askBlockedStatus(params, index)?.message);
						} catch (err) {
							console.error("[pi-ask-herdr] failed to report ask blocked status:", err);
						}
					},
					onSettled: (tui) => {
```

- [ ] **Step 5: Run everything (green)**

Run: `pnpm -C packages/pi-ask-herdr run typecheck`
Expected: only `$ tsc --noEmit`.
Run: `pnpm -C packages/pi-ask-herdr run test`
Expected: `ℹ tests 36` / `ℹ pass 36` / `ℹ fail 0` (32 baseline − 1 replaced + 4 new in Task 1 + 1 new in Task 2) [E27].

- [ ] **Step 6: Lint and commit**

Run: `pnpm exec biome check packages/pi-ask-herdr/src/herdr-status.ts packages/pi-ask-herdr/tests/herdr-status.test.ts packages/pi-ask-herdr/tests/program-status.test.ts`
Expected: no errors. `src/ui.ts` keeps its baseline 1 warning and `src/tool.ts` its baseline 1 error + 1 warning (pre-existing, unrelated — verified identical counts before and after on the scratch copy [E27]); do not "fix" them here.

```bash
git add packages/pi-ask-herdr/src/herdr-status.ts packages/pi-ask-herdr/src/ui.ts packages/pi-ask-herdr/src/tool.ts packages/pi-ask-herdr/tests/herdr-status.test.ts packages/pi-ask-herdr/tests/program-status.test.ts
git commit --author="Jesse Garrison <jesse@nightlight.io>" -m "fix(pi-ask-herdr): report the question on screen with its own options and re-report on question change"
```

---

### Task 3: Consumer — buttons only from a live dialog (replaces the brief's Edit 2)

**Files:**
- Modify: `/Users/jesse/.config/herdr-app/mods/tabs-asks/engine.js:239-241` [E15]
- Run: `docs/superpowers/plans/artifacts/herdr-asks-engine-selfcheck.mjs` (already written; imports `engine.js` by path and stubs `"herdr"`)

**Interfaces:**
- Consumes: `parseScreen(text)` → `{options, cursor, context, question}` where `cursor` is the option number of the row carrying `❯`, else `null` [E14].
- Produces: nothing new; behaviour change only inside `Engine.enrich` (`engine.js:229-260`).

**Regression check the brief asked for — answered:** yes, a real flow depends on this branch: every pi-permission-system prompt (report `kind: "permission"`, `options: []`) and any report-sourced dialog that carries no options in its report [E19][E20][E15]. Deleting the branch removes their buttons [E25]. The guard keeps them (their selected row has `❯`) and drops prose lists (no `❯`) [E26].

- [ ] **Step 1: Back up**

```bash
cp /Users/jesse/.config/herdr-app/mods/tabs-asks/engine.js /Users/jesse/.config/herdr-app/mods/tabs-asks/engine.js.bak-$(date +%Y%m%d-%H%M%S)
```

- [ ] **Step 2: Run the self-check against the current file (red, baseline)**

Run (from the repo root): `node docs/superpowers/plans/artifacts/herdr-asks-engine-selfcheck.mjs`
Expected: `ℹ pass 8` / `ℹ fail 2` — failing: `parseScreen: prose list far above the bottom is not scanned (Task 4)` and `enrich: report-sourced QUESTION + prose list in the transcript -> no buttons (the phantom-options bug)` [E24]. (A `MODULE_TYPELESS_PACKAGE_JSON` warning is harmless noise.)

- [ ] **Step 3: Edit**

Current (`engine.js:239-241`):

```js
          } else if (!ask.options.length && parsed.options.length) {
            patch.options = parsed.options;
          }
```

Target:

```js
          } else if (!ask.options.length && parsed.options.length && parsed.cursor != null) {
            // Only a live dialog (a row carries the ❯ cursor) supplies buttons; a numbered list in the transcript has none.
            patch.options = parsed.options;
          }
```

- [ ] **Step 4: Run the self-check (green except Task 4's case)**

Run: `node docs/superpowers/plans/artifacts/herdr-asks-engine-selfcheck.mjs`
Expected: `ℹ pass 9` / `ℹ fail 1`; the one failure is `parseScreen: prose list far above the bottom is not scanned (Task 4)` (fixed by Task 4). Passing now: the phantom case and `report-sourced APPROVAL still gets its buttons` (the regression guard).

No commit (not a git repo). The backup from step 1 is the rollback.

---

### Task 4: Consumer — scan only the bottom of the screen (the brief's Edit 3)

**Files:**
- Modify: `/Users/jesse/.config/herdr-app/mods/tabs-asks/engine.js:55-56` (constant), `:59-64` (loop start), `:74` (`first` lookup) [E14]

**Interfaces:**
- Consumes: nothing from Task 3 except that both edit the same file (so run after it).
- Produces: `parseScreen` returns only options from the last 40 lines of its input; `context` and the question walk-up still read the full text.

**Is it necessary?** Not for the reported bug — with Task 3's guard the phantom needs a `❯` on a prose row. It is cheap hardening: it makes the code match its own comment (`:61` says "Only the dialog at the bottom…" but scans everything) [E14], matches the `slice(-40)` capture window at `:234` [E15], and it also covers the **screen-sourced** branch (`:243-247`, no report, no cursor requirement), which Task 3 does not touch. Limit: `hc read` returns only the visible screen [E18], so the window changes behaviour only on panes taller than 40 rows. Drop this task first if a smaller diff is wanted; nothing else depends on it.

- [ ] **Step 1: Edit**

(a) Current (`engine.js:55-56`):

```js
const OPTION = /^\s*(❯\s*)?(\d{1,2})\.\s+(.*?)\s*$/;
const RULE = /^[\s─╌═━]+$/;
```

Target:

```js
const OPTION = /^\s*(❯\s*)?(\d{1,2})\.\s+(.*?)\s*$/;
const RULE = /^[\s─╌═━]+$/;
const DIALOG_LINES = 40;
```

(b) Current (`:59-63`):

```js
export function parseScreen(text) {
  const lines = (text ?? "").replace(/\r/g, "").split("\n");
  // Only the dialog at the bottom: start after the last rule above the first option run.
  let options = [], cursor = null, context = "", question = "";
  for (let i = 0; i < lines.length; i++) {
```

Target:

```js
export function parseScreen(text) {
  const lines = (text ?? "").replace(/\r/g, "").split("\n");
  // Only the dialog at the bottom: numbered rows further up are the transcript's own lists.
  const from = Math.max(0, lines.length - DIALOG_LINES);
  let options = [], cursor = null, context = "", question = "";
  for (let i = from; i < lines.length; i++) {
```

(c) Current (`:74`):

```js
    const first = lines.findIndex((l) => OPTION.exec(l)?.[2] === "1" && l.includes(options[0].label));
```

Target:

```js
    const first = lines.findIndex((l, i) => i >= from && OPTION.exec(l)?.[2] === "1" && l.includes(options[0].label));
```

Safety of the question walk-up (`:75-81`): it keeps reading the full `lines` array upward from `first` (≤12 lines), so a question line above the window start is still found; `context` (`sentPrompt`, `⏺` lines) is untouched. If `first` were `-1` the loop condition `i >= 0` fails immediately and `question` stays `""`, which the callers already treat as "no parsed question" (`if (parsed.question) …` at `:242`, `:247`). `first` cannot be `-1` here because `options` is non-empty only when the scan found a `1.` row at `i >= from`.

- [ ] **Step 2: Run the self-check (all green)**

Run: `node docs/superpowers/plans/artifacts/herdr-asks-engine-selfcheck.mjs`
Expected: `ℹ pass 10` / `ℹ fail 0` [E26].

- [ ] **Step 3: Syntax/host sanity**

Mods hot-reload [E22]; confirm the file still loads: watch `herdr-app`'s mod log / the Asks tab for an error after saving (a syntax error disables the mod). If unsure: `node --check /Users/jesse/.config/herdr-app/mods/tabs-asks/engine.js` (it is ESM with host imports, so `--check` only validates syntax — expected exit 0).

---

### Task 5: End-to-end manual check (caller; needs a live pi in herdr)

Pi: `/reload` (or start a new pi session) so it loads the producer change [A2]. Asks created before the consumer edit keep their old options (the engine enriches each ask once) — dismiss them first. Use fresh asks.

**Do check 3 BEFORE applying Tasks 3–4 once, to confirm the repro, then again after.**

1. **Normal 3-option select.** Prompt pi: *"Call ask_user once with one select question 'Pick a fruit' and options Banana, Orange, Cherry."* Expect: one Asks card, buttons `Banana`, `Orange`, `Cherry`, `✎ Other [custom]`. Click `Orange` → terminal records the answer `Orange`; card → delivered. (Do **not** click `✎ Other [custom]` — see open question 3.)
2. **Two-question ask.** Prompt: *"Call ask_user with two questions: a select 'First pick?' with options a, b; then a select 'Second pick?' with options c, d."* Expect: card shows `First pick?` with `a`, `b`, Other. Click `a` → the terminal moves to "Question 2/2" **and is not answered by a stray Enter**; within ~1–3 s the First card goes to Resolved/delivered and a new card appears for `Second pick?` with `c`, `d`. Click `c` → batch completes. Variant: make question 2 `type: text` → card 2 has no buttons, only the "Answer" control; typing an answer there submits it.
3. **Prose numbered list (the phantom).** Prompt: *"Write a numbered list of three options (1. Rewrite 2. Patch 3. Leave) in your reply, then call ask_user with a single text question 'Which one?'."* Before the fix: the card shows buttons `Rewrite / Patch / Leave`. After Tasks 3–4: no buttons, the "Answer" control present, card text `Which one?`. Variant: a single text question whose own text contains lines `1. …` `2. …`.
4. **Permission regression.** Trigger a pi-permission-system prompt (any tool call whose policy is `ask`). Expect: APPROVAL card with its numbered Allow/Deny buttons exactly as before [E19].

---

## Unresolved findings and questions (need a decision or a yes)

1. **Deviation from the brief, Edit 2.** Approve replacing "delete `engine.js:239-241`" with the `parsed.cursor != null` guard? Deleting it removes every pi-permission-system Allow/Deny button [E19][E25]. The only way to delete it safely is to make pi-permission-system report options in the `answer:` format — a change in a third package and the "approval routing" the brief put out of scope.
2. **Deviation from the brief, Edit 1.** Task 2 (the `onQuestionChange` hook, ~15 lines in `ui.ts`/`tool.ts` plus one test) is required for Task 1 to be safe [E4][E7][E16][E17]. If you want only the three edits as written, the safe subset is **Task 3 + Task 4 only** (producer unchanged: multi-question asks keep reporting the bare first question → a free-text card, no buttons; symptom (b) fully fixed, symptom (a) fixed for single-question asks only). Recommendation: Tasks 1+2+3 (+4).
3. **Pre-existing, not touched:** the `✎ Other [custom]` button is a trap. The wizard ignores the digit for the custom row, the panel sees an unchanged dialog and presses Enter, and the wizard selects the cursor row — option 1 [E29]. Cheapest fix when wanted: have the consumer drop a label starting `✎` from buttons (the panel already has an "Other answer" control, `asks/main.js:227`); the alternative, dropping the row from the report, changes two producer tests that pin it.
4. **Left alone on purpose:** the screen-sourced branch (`engine.js:243-247`, asks with no report) still adopts any numbered list in the bottom 40 lines as DECISION buttons with no cursor check. Not the reported chain; other programs may rely on it.
5. **Edge, not fixed:** two consecutive questions with an identical question text and option set produce an identical `msg`, so the panel's Enter-after-digit check cannot tell the wizard advanced and presses Enter on question 2. Making `msg` unique per question (e.g. an `(n/m)` prefix) would change the card text the consumer shows; not worth it for a pathological batch.
6. Assumptions to confirm during T5: **A1** the mods read only the OSC 7501 `blocked` report (not the socket `report_metadata` channel); **A2** `/reload` reloads the extension from the working tree; **A3** the host's reporter does not re-emit the stale question-1 message while question 2 is open [E10].

## Verification summary (what the planner ran, 2026-11-17)

Baseline before any edit: `pnpm -C packages/pi-ask-herdr run typecheck` clean; `run test` 32/32 [E13]. Scratch copies in `/tmp` (real sources untouched): producer with Tasks 1+2 applied → `tsc` clean, 36/36 pass, and the new wizard test fails if the hook call is removed [E27]; consumer variants: brief's Edit 2 → APPROVAL buttons lost, 8/10 [E25]; guard + window → 10/10 [E26]; guard only → 9/10 (window case fails as expected). No source file outside `docs/` in the real tree was modified. Not exercised: a live pi/herdr session (T5), CGC (the repo was not queried through CGC; the `askBlockedStatus` caller list in [E30] is a text search).

## Self-review

- **Spec coverage:** (a) multi-question + real options → T1+T2; (b) prose list never buttons → T3 (+T4); text question stays bare → kept `labels.length < 2` guard (T1); producer tests for 1×select, 2 questions, text, `·`/parens sanitization → T1 (+existing); consumer node check for `parseScreen`/`parseReport` → self-check; e2e → T5; version-control question → "Where things live"; `asks-fifo` mirroring → "Where things live" (none needed).
- **Placeholders:** none; every edit shows current and target code and the commands show expected output.
- **Type consistency:** `askBlockedStatus(params, index = 0)` (T1) is what `tool.ts` calls with `index` (T2); `AskWizardHooks.onQuestionChange(tui, index)` (T2) matches the `(index) => hooks?.onQuestionChange?.(wizardTui, index)` adapter and the `tool.ts` handler signature `(tui, index)`; `parsed.cursor` (T3) is the `cursor` field `parseScreen` already returns [E14].
