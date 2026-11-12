# Herdr Approval Buttons via Numeric Permission-Dialog Rows (Route A′) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Evidence:** `docs/superpowers/plans/artifacts/evidence-permission-ask-buttons.md` (HEAD `0c206ec9`)

**Goal:** Make pi-permission-system's inline permission dialog render numbered option rows (`❯ 1. Yes`, `2. Yes, for this session`, …) and answer to digits `1..n` as well as the configured letters, so herdr's Asks panel scrapes those rows and shows one clickable APPROVAL button per option — with no herdr edits.

**Architecture:** The dialog's roster is already a single ordered list (`visibleActions` [E12]); this plan derives each row's ordinal from its position in that list, renders the ordinal where the letter used to be rendered [E5], and adds a second keystroke match for the ordinal in `toEvent` [E8]. herdr's scraper already adopts `N. label` runs from the plain screen text [E26], [E28] and presses the digit followed by Enter [E29], which the existing arm-then-confirm model [E9], [E10] already resolves.
The `blocked` report (`kind: "permission"`, message `approve <tool>: <target>`) is untouched [E1][E2][E3].

**Tech Stack:** TypeScript, pi-tui (`matchesKey`, `KeyId`, `wrapTextWithAnsi`) [E18], vitest, pnpm workspace.

**Spec:** the caller's CONTEXT BRIEF (user-confirmed outcome "route A′", 2026-11-12).
No separate spec file exists; this plan is the design record for it, and the fragility list in "Design decisions" is the boundary the spec declared.

## Task map

| id  | task                                                                  | owner   | depends on | parallel group       | files                                                                                                  |
| --- | --------------------------------------------------------------------- | ------- | ---------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| T1  | Spike: does the dialog's text reach `hc read --json`? (GO/NO-GO gate) | @worker | —          | S                    | ledger only                                                                                            |
| T2  | Decision model: `actionOrdinal`, pressed-key hint, digit→Enter commit | @worker | T1 GO      | A                    | `src/authority/permission-prompt-decision.ts`, `test/authority/permission-prompt-decision.test.ts`     |
| T3  | Component: numbered rows and digit keystrokes                         | @worker | T2         | B                    | `src/authority/permission-prompt-component.ts`, render/component/gate-semantics tests                  |
| T4  | Docs and help text for numbered rows                                  | @worker | T1 GO      | C (parallel with T3) | `README.md`, `docs/configuration.md`, `src/config/config-schema.ts`, `schemas/permissions.schema.json` |
| T5  | End-to-end check against herdr's Asks panel                           | @worker | T3, T4     | D                    | ledger only                                                                                            |

Groups A and C are file-disjoint, so T4 may run alongside T2/T3; T3 must follow T2 because it calls `actionOrdinal`, and T5 follows everything.

## Global Constraints

- **Do not edit herdr.**
  `~/.config/herdr-app/**` is read-only context [E26]–[E30].
  Route A′ is deliberately pi-side only.
- **The report is not this change's business.**
  `{ overlay: false, blocked: { kind: "permission", message: "approve <tool>: <target>" } }` stays byte-identical; three suites already pin it [E3].
  The uncommitted `blockedMessage` patch in the working tree must survive the whole change [E1].
- **No UX regression:** the default letters `y`/`s`/`b`/`n`/`r` must keep working exactly as today, including `permissionDialogKeys` remaps [E14][E15].
- **Numbering follows `visibleActions`**, never `OPTION_ORDER` — an ask without `widthLabel` has no row 3 for `approveSessionBoth` and its deny is row 3 [E12].
- No new dependencies.
  No new config surface.
  English only.
- Work in `packages/pi-permission-system`; every command below is run from there unless stated.

## Design decisions (read before Task 2)

1. **The ordinal is what rows show; the configured key becomes an alias.**
   Rendering both in one column is impossible: herdr's pattern requires `\d{1,2}\.` immediately after the optional pointer [E26], so `1/y. Yes` would match nothing.
   Rows therefore show `1. Yes`, and `y` keeps selecting it.
   Consequence to accept and document: the "each row shows the key bound to it" promise in the docs ends [E16] — the remap still works, it is just no longer advertised in the row.
2. **Configured binding wins over the ordinal on a collision.**
   A partial remap such as `{"deny": "1"}` (legal today [E14]) makes digit `1` deny, in both the terminal and herdr, because `toEvent` resolves configured keys first [E8].
   Consistency with what the user configured beats the card's label; this is assumption A4 and is not a shipped default.
3. **The armed hint names the key that was actually pressed.**
   Today it names `config.keys[action]` [E10].
   If someone presses `1` and reads "Press y again", the dialog is lying about its own vocabulary.
   `PromptEvent.hotkey` gains an optional `key` (A-typed, one field) so the hint can echo it, with the old `config.keys` fallback for Enter-driven arms — which is also why every existing hint assertion keeps passing [E21].
4. **`denyWithReason` is not answerable from herdr** and will not be made so (A5): the reason step needs typed text, and herdr only presses a digit and Enter, so the card's row 4/5 walks into an editor and stops.
   Documenting this is part of the deliverable; fixing it would mean an herdr-side or RPC-side surface the user has not asked for.
5. **What breaks A′, recorded so the next person knows:** (a) the options scroll off the visible screen — herdr scrapes only `hc read --json` `.text` with no history [E33]; (b) a row longer than the terminal width wraps, and the continuation can be read as that option's `detail` [E26] (harmless: the number still matches, the label is just split); (c) a numbered list rendered *after* the dialog's rows would win, because the scraper keeps the last consecutive run [E26] — the dialog renders its options last in the frame [E20], followed only by a border and the hint; (d) a terminal narrower than the 6-column `❯ 1.` prefix makes the prefix itself wrap, so no row matches; (e) pi rendering the `custom` dialog outside the screen text at all — that is Task 1's gate (A1).

---

### Task 1: Spike — does the dialog's rendered text reach `hc read --json`?

**Owner:** @worker · **Parallel group:** S (alone; gates every other task) · **Depends on:** nothing

**Files:**

- Create: `/tmp/herdr-ask-spike/*` (throwaway; nothing in the repo changes)
- Modify: `docs/superpowers/plans/artifacts/evidence-permission-ask-buttons.md` (append spike entries)

**Interfaces:**

- Consumes: nothing.
- Produces: a GO / NO-GO verdict plus captured text; Task 5 reuses the same capture procedure against the numbered build.

**Steps:**

- [ ] **Step 1: Start a throwaway pi session in a herdr pane**

In a scratch directory inside a herdr pane (this must be a session you do not mind answering — never someone else's live prompt):

```bash
mkdir -p /tmp/herdr-ask-spike && cd /tmp/herdr-ask-spike && pi
```

Note the terminal address herdr shows for that pane (e.g. `t9z`).
Call it `$ADDR` below.

- [ ] **Step 2: Trigger a blocked permission dialog**

In that pi session ask it to run a command the current policy blocks, e.g. `rm -rf /tmp/x`.
Leave the dialog open (do not answer it).

- [ ] **Step 3: Capture the screen text the way herdr does**

```bash
ADDR=<the pane address>
hc read "$ADDR" --json | jq -r .text | tee /tmp/herdr-ask-spike/before.txt
```

- [ ] **Step 4: Decide the gate**

```bash
grep -nE '^\s*(❯\s*)?[0-9]{1,2}\.\s+\S' /tmp/herdr-ask-spike/before.txt
grep -n '❯' /tmp/herdr-ask-spike/before.txt
grep -nE '^ *(y|s|n|r)\. ' /tmp/herdr-ask-spike/before.txt
```

The build today renders letters, not numbers, so what must be present is the *structure*: a line starting (at column 0–2) with `❯ y. Yes`, then the other three rows at the same indentation, each on its own line, un-wrapped at the dialog's width.

- **GO** if the four option rows are present verbatim in `.text` with the pointer and the `<key>.` prefix at the line start.
  Numbers are not required yet — they are Task 3's output.
- **NO-GO** if the rows are absent, reflowed into a paragraph, or the pointer/prefix is mangled.
  Then **stop the whole plan** and report: route A′ cannot work regardless of numbering, because the scraper [E26] and the enrich hook [E28] both read only this text.
  Do not implement Tasks 2–5; escalate to the caller with the captured file (the fallback would be an herdr-side change, which the user declined).
- If the rows are present but wrapped at this pane width, resize the pane wider and re-capture; record the width at which they stop wrapping.
- [ ] **Step 5: Record the spike in the ledger**

Append to `docs/superpowers/plans/artifacts/evidence-permission-ask-buttons.md` under a `## Spike results` heading, in the existing format, one entry per claim, e.g.:

```text
E34 | The blocked permission dialog's option rows appear verbatim in `hc read --json` `.text` (four rows, pointer + key prefix at column 0) | /tmp/herdr-ask-spike/before.txt:12-16 | read | `❯ y. Yes` / `  s. Yes, for this session`
E35 | The captured rows survive herdr's OPTION pattern unchanged | /tmp/herdr-ask-spike/before.txt:12-16 | read | (regex from E26 applied to the four lines)
E36 | The report message herdr sees is still `approve bash: rm -rf /tmp/x` | (note the `hc ls` / Asks entry) | read | —
```

Replace A1/assumption rows with `settled by E34`.

- [ ] **Step 6: Close the scratch session**

Answer the dialog (or kill the session with `hc kill "$ADDR"`) and remove `/tmp/herdr-ask-spike` at the end of Task 5.

---

### Task 2: Decision model — ordinals, pressed-key hint, digit→Enter commit

**Owner:** @worker · **Parallel group:** A · **Depends on:** Task 1 GO

**Files:**

- Modify: `packages/pi-permission-system/src/authority/permission-prompt-decision.ts:29-65` (new export after `visibleActions`), `:96-122` (`PromptEvent`), `:185-214` (`hotkey` case + `pressHotkey`)
- Test: `packages/pi-permission-system/test/authority/permission-prompt-decision.test.ts`

**Interfaces:**

- Consumes: `visibleActions(config)`, `OPTION_ORDER`/`NARROW_OPTION_ORDER` [E12], `PromptModelConfig` [E12].
- Produces:
  - `export function actionOrdinal(config: PromptModelConfig, action: PromptAction): number` — 1-based position in `visibleActions(config)` (Task 3 calls it for both rendering and keystroke matching).
  - `PromptEvent` hotkey variant becomes `{ type: "hotkey"; action: PromptAction; key?: string }` (Task 3 sets `key`).
  - `pressHotkey(config, state, action, key?)` — internal; the hint uses `key ?? config.keys[action]`.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `test/authority/permission-prompt-decision.test.ts`, below the existing `makeConfig`/`assertRender` helpers, and add `actionOrdinal` to the import from `#src/authority/permission-prompt-decision`:

```ts
describe("option ordinals", () => {
  const narrow = makeConfig();
  const wide = makeConfig({ widthLabel: 'Yes, both directions for "/tmp/*"' });

  it("numbers the narrow roster 1..4, skipping the both-directions row", () => {
    expect(actionOrdinal(narrow, "approve")).toBe(1);
    expect(actionOrdinal(narrow, "approveSession")).toBe(2);
    expect(actionOrdinal(narrow, "deny")).toBe(3);
    expect(actionOrdinal(narrow, "denyWithReason")).toBe(4);
  });

  it("numbers the wide roster 1..5", () => {
    expect(actionOrdinal(wide, "approveSessionBoth")).toBe(3);
    expect(actionOrdinal(wide, "deny")).toBe(4);
    expect(actionOrdinal(wide, "denyWithReason")).toBe(5);
  });
});

describe("a digit hotkey (the key herdr presses)", () => {
  const config = makeConfig();

  it("arms and names the digit that was pressed", () => {
    const outcome = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "approve",
      key: "1",
    });
    expect(outcome).toMatchObject({
      kind: "render",
      state: { armedAction: "approve", hint: "Press 1 again to approve." },
    });
  });

  it("commits on the Enter herdr sends next", () => {
    const armed = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "approve",
      key: "1",
    });
    assertRender(armed);
    expect(reducePrompt(config, armed.state, { type: "confirm" })).toEqual({
      kind: "decision",
      decision: { approved: true, state: "approved" },
    });
  });

  it("still names the configured letter when no key is carried (Enter-driven arm)", () => {
    const outcome = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "approve",
    });
    expect(outcome).toMatchObject({
      state: { hint: "Press y again to approve." },
    });
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

```bash
cd packages/pi-permission-system
pnpm vitest run test/authority/permission-prompt-decision.test.ts
```

Expected: `actionOrdinal` is not exported (`SyntaxError`/`does not provide an export named 'actionOrdinal'`), and the hint assertions fail with `Press y again…`.

- [ ] **Step 3: Implement**

In `src/authority/permission-prompt-decision.ts`, directly below `visibleActions` [E12]:

```ts
/**
 * The number rendered beside an option, following {@link visibleActions} order.
 *
 * The dialog's rows are numbered and herdr's Asks panel adopts those numbers as
 * its buttons (it presses the digit, then Enter), so the number a row shows and
 * the number that selects it have to come from this one function.
 */
export function actionOrdinal(
  config: PromptModelConfig,
  action: PromptAction,
): number {
  return visibleActions(config).indexOf(action) + 1;
}
```

`PromptEvent` [E11]:

```ts
  | { type: "hotkey"; action: PromptAction; key?: string };
```

The `hotkey` case in `reduceDecisionStep` [E9]:

```ts
    case "hotkey":
      return visibleActions(config).includes(event.action)
        ? pressHotkey(config, state, event.action, event.key)
        : render(state);
```

`pressHotkey` [E10]:

```ts
function pressHotkey(
  config: PromptModelConfig,
  state: PromptViewState,
  action: PromptAction,
  key?: string,
): PromptOutcome {
  if (!config.doublePressToConfirm || state.armedAction === action) {
    return commit(config, state, action);
  }
  return render({
    ...state,
    highlightedAction: action,
    armedAction: action,
    // Name the key the operator pressed: rows are numbered, so a digit press
    // must not be answered with "Press y again".
    hint: `Press ${key ?? config.keys[action]} again to ${OPTION_VERBS[action]}.`,
  });
}
```

Leave the `confirm` call site [E9] passing no key — that is the fallback path.

- [ ] **Step 4: Run the tests, expect pass**

```bash
pnpm vitest run test/authority/permission-prompt-decision.test.ts
```

Expected: PASS, including every pre-existing hint assertion (`Press y again`, `Press n again`, `Press b again`, `Press 1 again` from the remap test) [E21].

- [ ] **Step 5: Typecheck**

```bash
pnpm run check
```

Expected: no errors (`tsc --noEmit`) [E24].

- [ ] **Step 6: Commit**

```bash
git add packages/pi-permission-system/src/authority/permission-prompt-decision.ts packages/pi-permission-system/test/authority/permission-prompt-decision.test.ts
git commit -m "feat(permission-system): number the dialog's options and echo the pressed key in the arm hint"
```

---

### Task 3: Component — numbered rows and digit keystrokes

**Owner:** @worker · **Parallel group:** B · **Depends on:** Task 2

**Files:**

- Modify: `packages/pi-permission-system/src/authority/permission-prompt-component.ts:464-481` (`toEvent`), `:501-516` (`renderDecision`), import block near `:44-54`
- Test: `packages/pi-permission-system/test/authority/permission-prompt-render.test.ts:37-51, :70-79, :241`; `packages/pi-permission-system/test/authority/permission-prompt-component.test.ts:237, :307, :794, :803`; `packages/pi-permission-system/test/authority/permission-prompt-gate-semantics.test.ts:255-272` (one expectation, Step 4)

**Interfaces:**

- Consumes: `actionOrdinal(config, action)` from Task 2; `visibleActions` [E12]; `optionRows(theme, rows, width)` unchanged [E6]; `matchesKey(data, keyId)` with digit ids [E18].
- Produces: rendered rows `❯ 1. Yes` … `n. <label>` where `n = actionOrdinal`; `toEvent` returns `{ type: "hotkey", action, key: data }`.

**Steps:**

- [ ] **Step 1: Write the failing tests**

In `test/authority/permission-prompt-render.test.ts`, replace the letter-row assertions [E21] and add the scraper contract test.
The four-row expectations at `:39-42` become:

```ts
  it("marks the highlighted option with ❯ + its ordinal in accent+bold and indents the rest", () => {
    const lines = mountPrompt({ view: NOW }).render(120);
    expect(lines).toContain(fakeTheme.fg("accent", fakeTheme.bold("❯ 1. Yes")));
    expect(lines).toContain("  2. Yes, for this session");
    expect(lines).toContain("  3. No");
    expect(lines).toContain("  4. No, provide reason");
    expect(strip(lines.join("\n"))).not.toContain("▶");
    expect(strip(lines.join("\n"))).not.toContain("(y)");
  });

  it("↓ moves the ❯", () => {
    const m = mountPrompt({ view: NOW });
    m.type(KEY.down);
    expect(m.render(120)).toContain(
      fakeTheme.fg("accent", fakeTheme.bold("❯ 2. Yes, for this session")),
    );
  });
```

The both-directions test at `:70-79` becomes (the row is numbered by position, and the label is the ask's):

```ts
  it("numbers the both-directions row from the ask's own label", () => {
    const label = 'Yes, reads and writes to "/tmp/*"';
    expect(flat(mountPrompt({ view: NOW }).render(120))).not.toContain(label);
    const lines = mountPrompt({
      view: NOW,
      options: { sessionWidth: { label } },
    }).render(120);
    expect(lines).toContain(`  3. ${label}`);
    expect(lines).toContain("  4. No");
    expect(lines).toContain("  5. No, provide reason");
  });
```

Also in that file, the boxed-row test at `:241` asserts the flattened text contains `n. No` — change it to `3. No` (narrow roster: the ask body was capped, the numbering follows `visibleActions`).

Add the contract test (new `describe` at the end of the decision-step block).
It copies herdr's pattern literally, which is the point: if the dialog's layout drifts, this fails instead of a silent missing button.

```ts
// herdr's Asks panel scrapes the screen with exactly this pattern
// (~/.config/herdr-app/mods/tabs-asks/engine.js:58) and adopts the run as the
// APPROVAL card's clickable options. A row that stops matching is a missing button.
const HERDR_OPTION = /^\s*(❯\s*)?(\d{1,2})\.\s+(.*?)\s*$/;

describe("herdr Asks-panel scrape contract", () => {
  const wide = { sessionWidth: { label: "Yes, both directions for /tmp/*" } };

  it("renders one scraper-matching row per visible action, numbered 1..n", () => {
    const cases = [
      { m: mountPrompt({ view: NOW }), expected: [1, 2, 3, 4] },
      { m: mountPrompt({ view: NOW, options: wide }), expected: [1, 2, 3, 4, 5] },
    ];
    for (const { m, expected } of cases) {
      for (const width of [40, 80, 120]) {
        const numbers = m.screen(width).flatMap((line) => {
          const digit = HERDR_OPTION.exec(line)?.[2];
          return digit === undefined ? [] : [Number(digit)];
        });
        expect(numbers).toEqual(expected);
      }
    }
  });
});
```

In `test/authority/permission-prompt-component.test.ts`, update the derived-key assertions [E21]:

```ts
    expect(decisionOptionKeys(captured)).toEqual(["1", "2", "3", "4"]);      // :237 default roster
    expect(decisionOptionKeys(captured)).toEqual(["1", "2", "3", "4"]);      // :307 DIGITS remap — the row shows its position
    expect(decisionOptionKeys(captured)).toEqual(["1", "2", "3", "4", "5"]);  // :794 with a width label
    expect(decisionOptionKeys(captured)).toEqual(["1", "2", "3", "4"]);      // :803 without
```

and add the herdr-sequence tests inside the existing `describe("configured hotkey bindings")` neighbour, as a new block:

```ts
  describe("digit picking (the keys herdr's Ask panel presses)", () => {
    it("approves on 1 then Enter, the sequence herdr sends", async () => {
      const { view, captured } = makeFakeView(true);
      const promise = presentInlinePermissionPrompt(view, "Permission Required", ASK);
      captured.component?.handleInput("1");
      expect(captured.component?.render(80).join("\n") ?? "").toContain(
        "Press 1 again to approve.",
      );
      captured.component?.handleInput("\r");
      await expect(promise).resolves.toMatchObject({
        approved: true,
        state: "approved",
      });
    });

    it("maps digits by the rendered order, not by action identity", async () => {
      // Narrow roster: 3 is deny, because the both-directions row is absent.
      expect(await runPrompt(false, ["3"])).toMatchObject({
        approved: false,
        state: "denied",
      });
    });

    it("grants the session on 2, and both directions on 3 when offered", async () => {
      expect(await runPrompt(false, ["2"])).toMatchObject({
        approved: true,
        state: "approved_for_session",
      });
      expect(
        await runPrompt(false, ["3"], {
          sessionWidth: { label: "Yes, both directions for /tmp/*" },
        }),
      ).toMatchObject({ approved: true, state: "approved_for_session" });
    });

    it("keeps the letters as aliases under the default bindings", async () => {
      expect(await runPrompt(false, ["n"])).toMatchObject({
        approved: false,
        state: "denied",
      });
      expect(await runPrompt(true, ["y", "y"])).toMatchObject({
        approved: true,
        state: "approved",
      });
    });
  });
```

`runPrompt(doublePressToConfirm, keys, options?)` already exists in that file with the optional `RequestPermissionOptions` third parameter; `makeFakeView(doublePressToConfirm, overrides?)` and `ASK` are the other local helpers.

- [ ] **Step 2: Run the tests, expect failure**

```bash
cd packages/pi-permission-system
pnpm vitest run test/authority/permission-prompt-render.test.ts test/authority/permission-prompt-component.test.ts
```

Expected: rows still render `❯ y. Yes`, `1` presses do nothing, `Press 1 again` absent.

- [ ] **Step 3: Implement**

`renderDecision` [E5] — the only change is where the key text comes from:

```ts
  private renderDecision(width: number): string[] {
    const ask = this.renderAsk(width, visibleActions(this.config).length);
    const rows = visibleActions(this.config).map((action) => ({
      key: String(actionOrdinal(this.config, action)),
      label: this.labelFor(action),
      selected: this.state.highlightedAction === action,
    }));
```

`toEvent` [E8] — configured bindings first, then the ordinal:

```ts
    if (this.state.step === "decision") {
      const actions = visibleActions(this.config);
      // A configured binding is answered first: a remap is explicit intent and
      // may legitimately collide with an ordinal.
      const bound = actions.find((option) =>
        matchesKey(data, this.boundKey(option)),
      );
      if (bound) {
        return { type: "hotkey", action: bound, key: data };
      }
      // The number the rows show, so the digit herdr presses selects the row it saw.
      const position = actions.findIndex((_, index) =>
        matchesKey(data, String(index + 1) as KeyId),
      );
      const action = actions[position];
      if (action) {
        return { type: "hotkey", action, key: data };
      }
    }
```

Import `actionOrdinal` alongside the existing `visibleActions` import from `./permission-prompt-decision` [E5 import block]. `optionRows` [E6] and `boundKey` [E8] are unchanged; `optionRows`' own tests stay as they are [E7].

- [ ] **Step 4: Run the tests, expect pass**

```bash
pnpm vitest run test/authority/permission-prompt-render.test.ts test/authority/permission-prompt-component.test.ts test/authority/permission-prompt-chrome.test.ts test/authority/permission-prompt-gate-semantics.test.ts
```

Expected: PASS after one edit in `permission-prompt-gate-semantics.test.ts` (its `permissionDialogKeys remapping` block, `:255-272`).
Its "answers to the bound key and not the default letter" case needs no change — a configured binding replaces the alias, so `y` still does nothing under a digit map [E14].
Its rendering case asserts `/4\W+No\b/` for the DIGITS map, and deny is now row `3` on that narrow ask [E12]; change that expectation to:

```ts
      expect(text).toMatch(/1\W+Yes/);
      // Rows are numbered by position, not by the remapped character: on this
      // narrow ask deny sits third, because the both-directions row is absent.
      expect(text).toMatch(/3\W+No\b/);
```

- [ ] **Step 5: Full suite + typecheck**

```bash
pnpm test
pnpm run check
```

Expected: all suites pass; `tsc --noEmit` clean [E24].

- [ ] **Step 6: Commit**

```bash
git add packages/pi-permission-system/src/authority/permission-prompt-component.ts packages/pi-permission-system/test/authority/permission-prompt-render.test.ts packages/pi-permission-system/test/authority/permission-prompt-component.test.ts packages/pi-permission-system/test/authority/permission-prompt-gate-semantics.test.ts
git commit -m "feat(permission-system): render numbered option rows and answer to digits 1..n"
```

---

### Task 4: Docs and help text for numbered rows

**Owner:** @worker · **Parallel group:** C (parallel with Task 3 — disjoint files) · **Depends on:** Task 1 GO

**Files:**

- Modify: `packages/pi-permission-system/README.md:68-69`
- Modify: `packages/pi-permission-system/docs/configuration.md:113-114, :136-160`
- Modify: `packages/pi-permission-system/src/config/config-schema.ts:289-292` (the `permissionDialogKeys` description string)
- Regenerate: `packages/pi-permission-system/schemas/permissions.schema.json` [E17]

**Interfaces:**

- Consumes: the naming from Tasks 2–3 (`actionOrdinal`, rows numbered by `visibleActions` order).
- Produces: nothing code-facing; the schema JSON must match the description exactly.

**Steps:**

- [ ] **Step 1: Update the README paragraph**

`README.md:68-69` currently promises letters in the row.
Replace with (keep the surrounding links):

```markdown
In an interactive TUI session the prompt is an inline dialog whose options are numbered — `1` approve, `2` approve for this session, `3` deny, `4` deny with a reason, with `b`'s both-directions row numbered into that order when the ask offers it — and each choice arms on the first press and confirms on the second (configurable via `doublePressToConfirm`). The letters `y` / `s` / `b` / `n` / `r` keep working as aliases, so muscle memory and `permissionDialogKeys` remaps are unaffected.
The numbers exist because they are also what an external surface can scrape: a numbered row is a clickable button in herdr's Asks panel, and digits are unaffected by input-method composition mode, which swallows letter keys.
```

- [ ] **Step 2: Update `docs/configuration.md`**
- Table row `:114` (`permissionDialogKeys`): append "Digits `1`–`5` always work as positional shortcuts, whatever this map says."
- The hotkey table intro at `:136-146`: keep the letter table, and add one line above it — "Every option is numbered in the order shown; press the number, or the bound key."
- `:148` "each row shows the key bound to it (the digits, if you remapped them)" becomes "each row shows its number, which selects it — the bound key still works but is not printed".
- `:150` "a hotkey **arms** its action and shows a `Press y again to approve.` hint; press the same key again to commit" becomes "a key **arms** its action and shows a `Press 1 again to approve.` hint; press the same key again (or `enter`) to commit".
- `:153-160` (the "Remapping the hotkeys" IME rationale [E16]): keep the mechanism, replace the motivation — numbers now cover the IME case by default, so the section becomes "remaps exist for muscle memory and old habits; the IME problem that motivated them is solved by the numbering".
  The digit example config can stay as an illustration, with one added sentence that it now coincides with the ordinals.
- [ ] **Step 3: Update the schema description and regenerate**

`src/config/config-schema.ts:289-292` [E16]: replace the "Digits are the usual choice for input-method-editor (IME) users…" sentence with "Digits `1`–`5` are always available as positional shortcuts, so an entry only changes which key is *also* accepted."
Keep the rest (reserved `j`/`k`, uppercase rejection, collision refusal).

```bash
cd packages/pi-permission-system
pnpm run gen:schema
```

Expected: `schemas/permissions.schema.json` updated by the generator + biome format [E24].

- [ ] **Step 4: Verify docs lint and that only intended files changed**

```bash
pnpm run lint:md
git status --porcelain packages/pi-permission-system
```

Expected: rumdl clean; the diff touches only README, `docs/configuration.md`, `config-schema.ts`, and `schemas/permissions.schema.json`.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-permission-system/README.md packages/pi-permission-system/docs/configuration.md packages/pi-permission-system/src/config/config-schema.ts packages/pi-permission-system/schemas/permissions.schema.json
git commit -m "docs(permission-system): numbered option rows, letters as aliases"
```

---

### Task 5: End-to-end check against herdr's Asks panel

**Owner:** @worker · **Parallel group:** D (alone) · **Depends on:** Tasks 3 and 4

**Files:**

- Modify: `docs/superpowers/plans/artifacts/evidence-permission-ask-buttons.md` (append the post-change capture)
- Create: `/tmp/herdr-ask-spike/after.txt`

**Interfaces:**

- Consumes: the numbered build from Task 3; the capture procedure from Task 1.
- Produces: the GO/NO-GO record for the whole route, plus the accepted-limitation note for `denyWithReason`.

**Steps:**

- [ ] **Step 1: Re-run the capture with the numbered build**

Start a fresh throwaway pi session in a herdr pane (Task 1's procedure), trigger a blocked dialog, then:

```bash
ADDR=<pane address>
hc read "$ADDR" --json | jq -r .text | tee /tmp/herdr-ask-spike/after.txt
grep -nE '^\s*(❯\s*)?[0-9]{1,2}\.\s+\S' /tmp/herdr-ask-spike/after.txt
```

Expected: four (or five) lines, numbered `1..n` consecutively, first one carrying `❯ `.

- [ ] **Step 2: Check the panel adopted them as APPROVAL buttons**

Open herdr's Asks panel for that pane.
Expected: an APPROVAL card reading `Allow bash: rm -rf /tmp/x` with one button per row, labelled `Yes` / `Yes, for this session` / `No` / `No, provide reason`, and no "Other answer" button [E30].

- [ ] **Step 3: Confirm the digit → Enter sequence resolves rather than dead-ending**

Prefer the panel itself (press the `Yes` button).
If the button press is unavailable, reproduce herdr's exact sequence [E29] by hand:

```bash
hc keys "$ADDR" 1
hc read "$ADDR" --json | jq -r .text | grep -n 'Press 1 again'
hc keys "$ADDR" enter
hc read "$ADDR" --json | jq -r .text | grep -c 'Yes, for this session'   # expect 0: the dialog is gone
```

Expected: the arm hint appears after `1`; after `enter` the dialog closes and the pi session reports the tool approved.
**If `enter` does not settle it**, that is the dead-end this route depends on being impossible (A2) — record it and stop, do not paper over it (the likely cause would be the ask's message changing between presses, which would also mean the `blockedMessage` patch is not stable per render).

- [ ] **Step 4: Record the `denyWithReason` limitation**

Press the `No, provide reason` button (or `hc keys "$ADDR" 4` then `enter` on the narrow roster).
Expected: the dialog switches to the reason editor and stays there — herdr cannot type a reason (A5).
Record it in the ledger as an accepted limitation with the observed behaviour, then dismiss with `esc` (`esc` denies from the reason step).

- [ ] **Step 5: Append the results to the ledger**

```text
E37 | The numbered rows reach herdr's scraper: four consecutive rows 1..4, pointer on row 1 | /tmp/herdr-ask-spike/after.txt:<range> | read | `❯ 1. Yes` / `  3. No`
E38 | herdr's Asks panel renders the run as APPROVAL buttons with the dialog's labels | (observed Asks panel) | read | —
E39 | digit-then-Enter settles the ask: arm hint after `1`, dialog gone after `enter` | (hc keys/read transcript) | read | —
E40 | `denyWithReason` cannot be completed from herdr: it opens the reason editor and waits | (observed) | read | —
```

Update A2/A5 to "settled by E39/E40".

- [ ] **Step 6: Final verification and commit**

```bash
cd packages/pi-permission-system
pnpm test && pnpm run check && pnpm run lint:md
# back at the workspace root:
cd /Users/jesse/Developer/repos/pi/pi-packages
git add docs/superpowers/plans/artifacts/evidence-permission-ask-buttons.md
git commit -m "docs(permission-system): herdr A-prime end-to-end evidence"
rm -rf /tmp/herdr-ask-spike
```

---

## Self-review

- **Spec coverage:** numeric rows (T3), digit bindings 1..n + letter aliases (T3), digit→action follows `visibleActions` (T2 `actionOrdinal` + T3 test "maps digits by the rendered order"), `doublePressToConfirm` arm-then-Enter (T2 pure test, T3 component test, T5 live), `labelFor` supplies the button labels (T3 render test asserts `Yes` / `Yes, for this session` / `Yes, for this session in both directions`; T5 checks them on the card), report unchanged (Global Constraints + T3 leaves `:274` alone), fragility written down (Design decisions 5 + T5 Step 4), TDD per change (every task), exact commands from `package.json` [E24], unknown (d) as Task 1's gate.
- **Not covered, deliberately:** herdr-side patching; a numbered *scope* step (it has no keys today and herdr has no card for it); making `denyWithReason` scriptable (A5); a documented config hazard test for A4.
