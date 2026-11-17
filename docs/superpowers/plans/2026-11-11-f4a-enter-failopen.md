# F-4a — Enter must not approve a freshly mounted permission dialog

**Evidence:** `docs/superpowers/plans/artifacts/evidence-f4a-enter-failopen.md` (HEAD `cc2a3ac9`)
Bracketed ids (`E<n>`, `A<n>`) are rows in that ledger, not links.
**Repo:** `/Users/jesse/Developer/repos/pi/pi-packages` · **Package:** `packages/pi-permission-system`
**Branch:** `feat/ask-user-dialog-parity` (4 commits off `pi-permission-system-v42.0.0`)

## Goal

With `doublePressToConfirm` on (the default), the **first** Enter press on a just-mounted
permission dialog must **arm** the highlighted option, not commit it. A second Enter (or the
bound hotkey) commits. With `doublePressToConfirm` off, one Enter still commits. Esc still
denies on the first press. Nothing else in the dialog changes.

## 1. Root cause (decisive: option (c))

`reduceDecisionStep` sends hotkeys through the guarded `pressHotkey` and `confirm` straight to
`commit`:

- `src/authority/permission-prompt-decision.ts:185-188` — `case "hotkey": … pressHotkey(...)`
- `src/authority/permission-prompt-decision.ts:189-190` — `case "confirm": return commit(config, state, state.highlightedAction);` **[E2]**
- `src/authority/permission-prompt-decision.ts:203` — the only `doublePressToConfirm` read: `if (!config.doublePressToConfirm || state.armedAction === action) return commit(...)` **[E1]**

So `doublePressToConfirm` is honoured **only for letter hotkeys**; `confirm` (Enter) is
unguarded. At mount the highlight is already `approve` (`:136`) **[E3]**, so one Enter at mount =
one approval. The component turns Enter into `{type:"confirm"}` on the decision step
(`src/authority/permission-prompt-component.ts:465-467`) **[E5]** and the mount path injects no
keystrokes (`:233-260`) **[E20]**.

Ruled out, with evidence:

- **(a) "arming initialises as already armed"** — false: `armedAction: undefined` at init
  (`decision.ts:137`) **[E4]**, asserted by its own test.
- **(b) "buffered/type-ahead keystroke consumed as confirm"** — false: nothing buffers or
  replays input; `handleInput` is fed only live keys, and the harness delivers synchronously
  **[E5][E20]**. A timing swallow would add nondeterminism to a security gate for no reason.
- **(d) something else** — nothing: the asymmetry is by construction and was *specified*
  (`docs/plans/0573-inline-keybind-permission-dialog.md:129`: "a deliberate
  navigate-then-confirm is already two keystrokes") **[E7]** — a rationale that is simply
  untrue at mount, where nothing has been navigated. The dialog's own resting hint promises a
  double press for every key (`component.ts:391-396`) **[E6]**, so the current behaviour also
  contradicts its own copy.

## 2. Minimal correct fix

**Route the decision step's `confirm` through the existing guard:**

```ts
case "confirm":
  return pressHotkey(config, state, state.highlightedAction);
```

one line, `src/authority/permission-prompt-decision.ts:190`. `pressHotkey` already commits when
`doublePressToConfirm` is off or the same action is armed, and otherwise arms + renders the
`Press X again to …` hint **[E1]**. Consequences, all intended:

- fresh mount, Enter → render, `armedAction: "approve"`, hint shown; second Enter → approved;
- `y` then Enter → approved (arm by hotkey, confirm by Enter) — the deliberately allowed case;
- `doublePressToConfirm: false` → one Enter commits (guard short-circuits);
- Esc unaffected (`cancel` is a separate event, `decision.ts:191-192`);
- **scope** step unaffected: its `confirm` lives in `reduceScopeStep` (`:317-321`) **[E15]** and
  must keep committing on the first press (it is a step transition, not a decision);
- **reason** step unaffected: the framework editor owns Enter before `toEvent` (`:411-421`)
  **[E16]**.

Alternatives weighed and rejected:

| Option | Verdict |
| --- | --- |
| Component-only remap (`toEvent`: on the decision step, emit `{type:"hotkey", action: highlightedAction}` when double-press is on) | Behaviourally identical today **[E14]**, but it leaves `reducePrompt`'s `confirm` a fail-open API plus a test asserting that fail-open (E13). Decision policy would move into the input adapter, against the module's stated split (pure model ↔ thin adapter). Use only if the freeze on the reducer were refused. |
| Swallow/replay the first key within N ms of mount | Worst: timing heuristics in a security gate, nondeterministic tests, punishes a human who reads fast, and does not fix the real invariant (no commit without an arm). |
| Initialise "nothing armed" | Already the case **[E4]**. A no-op that would change nothing. |
| Start the highlight on nothing | Breaks the "highlighted option" render contract and makes single-Enter ambiguous; larger blast radius than the one-line guard. |

## 3. Frozen-gate decision — the freeze on the reducer is legitimately lifted

The fix **does** require editing `src/authority/permission-prompt-decision.ts`, which the
previous task froze against `pi-permission-system-v42.0.0`. This plan lifts that freeze **for
this file only**, because the invariant that failed is the reducer's own (no commit without a
prior arm when `doublePressToConfirm` is on) and `pressHotkey` is the single place that owns it
**[E1]**. The freeze is not silently edited:

- The lift is recorded here and in the evidence ledger (E18).
- The reducer diff must be exactly the one line above — no refactor, no rename, no extra guard.
- A **fresh reviewer sign-off on the reducer** is required (Step 9 review treats
  `permission-prompt-decision.ts` as the review's centre of gravity, not the tests).
- The other four gate files stay byte-identical to the tag and are verified mechanically:
  `src/authority/answer-window.ts`, `src/authority/permission-dialog.ts`,
  `src/config/dialog-keys.ts`, `src/presentation/dialog-renderer.ts` **[E19]**.

## 4. Test changes

Three existing tests encode the hazard or depend on it; all must change, plus new assertions.

### 4a. `test/authority/permission-prompt-gate-semantics.test.ts`

Replace the block at `:113-123` (comment `KNOWN HAZARD, NOT ENDORSED (plan F-4a)` + `it("PINNED
HAZARD: …")`) **[E10]** with a `describe("enter under doublePressToConfirm")`:

1. `it("the first enter arms instead of approving")` — `const m = mountPrompt();` (harness
   default is double-press **on** **[E9]**), `m.type(KEY.enter);`
   `expect(m.done).not.toHaveBeenCalled();`
   `expect(m.screen().join("\n")).toContain("Press y again to approve.");`
2. `it("the second enter approves")` — same mount, `m.type(KEY.enter, KEY.enter)` →
   `await expect(m.decision).resolves.toStrictEqual({ approved: true, state: "approved", decidedBy: USER });`
3. `it("enter still approves on one press when double-press is off")` — `mountPrompt({ view: NOW })`,
   `m.type(KEY.enter)` → same decision as (2).
4. `it("a hotkey arm can be confirmed by enter")` — `mountPrompt()`, `m.type("y")`
   (`expect(m.done).not.toHaveBeenCalled()`), then `m.type(KEY.enter)` → approved. This is the
   deliberately-allowed case and it must stay green.

Then fix the nav+Enter test at `:136-144` **[E11]**, which currently rides the default
double-press-on view: pass `{ view: NOW }` so it keeps asserting what its name says
("double-press off: ↑/↓ moves the highlight and enter commits the highlighted option"). Esc-denies-
on-first-press stays where it is (`:72-80`, already default view) — no change.

### 4b. `test/authority/permission-prompt-decision.test.ts`

Invert `:207-219` **[E13]** — `it("confirms the highlighted option in a single enter press even
when double-press is enabled")` becomes `it("arms the highlighted option on the first enter and
confirms on the second")` with `makeConfig()` (double-press on): two `nav` down (highlight
`deny`), then `{type:"confirm"}` → `assertRender`, `expect(outcome.state.armedAction).toBe("deny")`,
`expect(outcome.state.hint).toBe("Press n again to deny.")`; a second `{type:"confirm"}` →
`{kind:"decision", decision:{approved:false, state:"denied"}}`. Add the short-circuit case:
`makeConfig({ doublePressToConfirm: false })`, one `confirm` on a fresh state → immediate
`{approved:false, state:"denied"}` after the same two navs.

### 4c. `test/authority/permission-prompt-component.test.ts`

`:365-372` **[E12]** runs `runPrompt(true, [ARROW_DOWN, ARROW_DOWN, ENTER])` (double-press on).
Keep it and add the second `ENTER`: `runPrompt(true, [ARROW_DOWN, ARROW_DOWN, ENTER, ENTER])`,
renamed `"resolves the highlighted option on enter, after entering twice"`. Add one sibling:
`runPrompt(false, [ARROW_DOWN, ARROW_DOWN, ENTER])` still resolves `denied` in one press.

Red-first requirement: 4a(1), 4a(2), 4b must **fail** before the reducer line changes; state that
red state was observed. (4a(3), 4a(4), 4c pass both before and after — they are regression pins.)

## 5. Verification

From `/Users/jesse/Developer/repos/pi/pi-packages`:

```text
pnpm -C packages/pi-permission-system test
pnpm -C packages/pi-permission-system run check
git diff --exit-code pi-permission-system-v42.0.0 -- \
  packages/pi-permission-system/src/authority/answer-window.ts \
  packages/pi-permission-system/src/authority/permission-dialog.ts \
  packages/pi-permission-system/src/config/dialog-keys.ts \
  packages/pi-permission-system/src/presentation/dialog-renderer.ts
```

Narrow loop while red/green: `pnpm -C packages/pi-permission-system test test/authority/permission-prompt`.
All three must exit 0 at the end; the full suite is the gate (not the narrow one) — a "tests pass"
claim backed only by the narrow run is not accepted.

## Tasks

All three tasks are sequential (same files / same invariant). Parallel group: none — **A** only.

| id | owner | depends on | group | files | verification |
| --- | --- | --- | --- | --- | --- |
| T1 | @worker | — | A | `test/authority/permission-prompt-gate-semantics.test.ts`, `test/authority/permission-prompt-decision.test.ts`, `test/authority/permission-prompt-component.test.ts` | `pnpm -C packages/pi-permission-system test test/authority/permission-prompt` — expect the 4a(1), 4a(2) and 4b assertions **red**, everything else green; report the red run. |
| T2 | @worker | T1 | A | `src/authority/permission-prompt-decision.ts` (one line, `:190`) | full: `pnpm -C packages/pi-permission-system test` + `run check` + the four-file frozen diff — all exit 0. |
| T3 | @worker | T2 | A | `docs/configuration.md:150-151` **[E8]** | `pnpm -C packages/pi-permission-system run lint` (markdown lint covers `docs/`) exits 0. |

T3's content: one clause on the arming rule — with `doublePressToConfirm` on, **Enter arms the
highlighted option too**, so a second Enter or the bound hotkey commits; off, the first press
commits. Do not edit `CHANGELOG.md`; do not rewrite the historical plan `0573` (its rationale at
`:129` is superseded by this plan, and historical plans are not edited).

## Out of scope (do not touch)

Authorizer chain, forwarding, timeout semantics (`src/authority/answer-window.ts` is frozen
anyway), session grants, the non-TUI `ui.select` fallback, the authorizer's decision shape. No
new runtime dependency.

## Risks and open questions

- **Freeze discipline is the main risk.** The lift applies to one file and one line. A reviewer
  must confirm the reducer diff is exactly `:190` and that the other four gate files diff empty.
  If T2's worker reports other reducer changes, send it back rather than accepting them.
- **A2 (cosmetic, accepted):** after an Enter-arm the hint reads `Press y again to approve.`
  while Enter is equally valid. Fixing the copy would touch the hint string for one edge case;
  not worth it. Flag it if a reviewer disagrees.
- **A1:** the four remaining frozen file paths come from the caller's brief (E18/E19), not from a
  document in this repo. If the authoritative list differs, re-scope T2's verification command.
- **A3:** no fourth test drives Enter on the decision step with double-press on — swept across
  `test/`; if the full suite surfaces one, update it in T1 rather than weakening the fix.
- Behaviour change is user-visible: anyone who relied on Enter-then-approve at mount now needs a
  second press. That is the point of the fix; it deserves a line in the release notes owned by
  whoever cuts the release (not this plan, and not `CHANGELOG.md`).
