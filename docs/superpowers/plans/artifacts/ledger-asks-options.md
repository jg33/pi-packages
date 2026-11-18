# Ledger — herdr Asks options fix

Task: `asks-options` · Plan: `../2026-11-18-herdr-asks-options.md` · Repo: `/Users/jesse/Developer/repos/pi/pi-packages` @ 400762e1

## Approved scope
User confirmed **both sides, minimal**, then full plan T1-T4 plus a follow-up for the
`✎ Other [custom]` no-op-digit bug.

- T1 producer `src/herdr-status.ts` — report on-screen question with its own options
- T2 producer `src/ui.ts` + `src/tool.ts` — `onQuestionChange` hook (T1 unsafe without it)
- T3 consumer `engine.js:239-241` — `❯`-cursor guard (replaces brief's wrong branch deletion)
- T4 consumer `engine.js:55-74` — 40-line bottom window
- T6 consumer `asks/main.js` — custom-row must not press a no-op digit then Enter

## Corrections to the orchestrator brief (verified by Planner on /tmp scratch copies)
1. Deleting `engine.js:239-241` breaks pi-permission-system Allow/Deny buttons — that
   branch is their source. Replaced with the cursor guard.
2. "Answering advances the wizard and a fresh report follows" is false — `blocked` is
   computed once at `ctx.ui.custom`, nothing re-reports on `advance()`/`back()`. Hence T2.

## Children
| name | role | scope |
|---|---|---|
| explore-asks-parser | Explore | consumer engine + panel |
| explore-ask-herdr-producer | Explore | producer extension |
| planner-asks-fix | Planner | plan + evidence + self-check |
| worker-asks-producer | Worker | T1, T2 |
| worker-asks-consumer | Worker | T3, T4, (T6) |
| reviewer-asks-producer | Reviewer | T1+T2 |
| reviewer-asks-consumer | Reviewer | T3+T4(+T6) |

## Verification commands
- `pnpm -C packages/pi-ask-herdr exec node --import ./tests/typescript-transform-hooks.mjs --test tests/herdr-status.test.ts` (T1: 11)
- `pnpm -C packages/pi-ask-herdr run typecheck && pnpm -C packages/pi-ask-herdr run test` (T2: 36)
- `node docs/superpowers/plans/artifacts/herdr-asks-engine-selfcheck.mjs` (T3: 9/1, T4: 10/0)

## Status
- [x] T1 + T2 producer (worker-asks-producer): `askBlockedStatus(params, index=0)` + `onQuestionChange` hook. Claimed 11/11 herdr-status, 36/36 suite, tsc clean, negative test bit. **Not independently verified by the orchestrator** — see below.
- [x] T3 + T4 consumer (worker-asks-consumer): `&& parsed.cursor != null` guard at `engine.js:241`, `DIALOG_LINES = 40` window.
- [x] T6 consumer: `/^✎/` guard first in `answer()` (`asks/main.js:99`) routes the custom row to free text — no digit, no Enter.
- [x] T7 config: **created** `~/.config/herdr-app/asks.json` = `{"trailing_questions": false}`. User route, not DEFAULTS: `loadConfig()` merges the file over DEFAULTS so all three `state.js` copies pick it up. Disables the finished-turn scanner (`engine.js:197`); real-prompt path untouched.
- [ ] T5 manual e2e in herdr — still outstanding

## Review rounds (consumer)
- R1 (review round 1): MUST-FIX — the `/^✎/` guard routed the custom click into `hc send`, which the pi-ask-herdr select wizard mangles (non-digits dropped, digits select+advance, trailing Enter confirms the cursor row) → silent wrong answer recorded and logged to `docs/decisions.md`. Tasks 3/4 confirmed correct and hardened.
- R2 (worker): ✎ options filtered out of buttons in `card()`; `answer()` ✎ guard made inert (note only, zero `hc`); pending-note render line added. 15/15, mutation-proven.
- R3 (worker, user-approved extras): 3a bounded single re-enrich retry for the dry-read race (`this.retried`); 3b `sendText` guard on keystroke cards. 21/21, three mutation runs (M1/M2/M3).
- R4 (review round 2): original must-fix **CLOSED**. New MUST-FIX — R3b's guard over-broad: `delivery` is undefined on every report ask, so it killed the working free-text path for no-option text questions (`ui.ts:330-343` Input accepts paste+Enter). Fix: gate on `(ask.options?.length ?? 0) > 0` instead. Plus NICE-2 (`retried` unbounded growth + id recycling) and NICE-3 (retry patch not state-rechecked at fire time).
- Reviewer rounds used: 2 of 3 before escalation to Reviewer-Deep.

## Producer review (reviewer-asks-producer-2) — PASSED, no must-fix
Ran the gates independently (the orchestrator's shell cannot):
- `pnpm -C packages/pi-ask-herdr run typecheck` → exit 0
- `pnpm -C packages/pi-ask-herdr run test` → exit 0, **36 pass / 0 fail**
- `herdr-status.test.ts` → 11/11; `program-status.test.ts` → 6/6
- `git diff --stat` → 5 files, +229 lines, HEAD 400762e1; `git status --porcelain` only those 5
- Negative test re-derived independently in a /tmp full-repo copy (no repo edits): both `this.onQuestionChange?.(this.index)` calls removed → exit 1, 1 fail / 35 pass, assertion `First pick?` vs `Second pick?` at `program-status.test.ts:180`. Earlier /tmp attempts that failed on import errors were discarded as spurious.

Verified transitions: `advance()` ui.ts:458, `back()` ui.ts:469, no wrap (last index → `finish()` ui.ts:455-457). Hook cannot fire after settle (`handleInput` early-returns once `finished`, ui.ts:534); `onSettled` guaranteed last in `askBatchInTui`'s `finally` (ui.ts:661-663). No leak.
Identical-consecutive-question case (open question 5) is **benign**: same wire msg keeps the old card, but its content equals what the new question renders, so digit→row stays correct.
Call sites repo-wide: only `ui.ts:634` and `tool.ts:131` (plus `option-source.test.ts` ×3).

NICE-TO-HAVE (not fixed): timeout exit path untested (covered by construction via `finish(null)` → `finally onSettled`); three untracked `.bak-*` scratch files in `artifacts/` to delete before committing.

## Orchestrator verification (step 10)

## Round 6 — wizard key-handling facts (explore-ask-herdr-input)
Read from `pi-ask-herdr/src/ui.ts`. Drove three more fixes.
- **No `❯` (U+276F) exists in the package** (0 grep hits). The wizard's cursor is `›` (U+203A) and option rows carry **no numbers** (`› label` / `  label`). Consequence: a pi-ask-herdr prose numbered list can NEVER satisfy the consumer's cursor regex `/^\s*(❯\s*)?(\d{1,2})\.\s+/` — the phantom-options bug is structurally impossible for that program, not merely guarded. `❯ 1. …` belongs to permission dialogs, which is the path we want adopted.
- **Single-select: digit calls `onSelect` and advances synchronously** (`ui.ts:123-131`, `:450-458`). The panel pressing Enter "if the dialog looks unchanged" is redundant, and because `hc read` can precede the repaint the check can see the old screen and press Enter onto the NEXT question's child, answering it with its untouched default. → Round 6 fix A (consumer): Enter only when `source !== "report"`.
- **`pickByDigit` accepts one char `1`–`9` only** (`ui.ts:124`). A 10+ option select sends `1` then `0` → selects option 1, ignores `0`. → Round 6 fix B (producer): emit the `answer:` wrapper only when `2 <= labels.length <= 9`.
- Digit on the `✎` custom row is ignored outright (`ui.ts:126`), confirming the original ✎ + Enter mechanism.
- Multiselect: a digit toggles and Enter submits `[that row]` (defaults never seeded into `selected`). **Not treated as a bug** — a single click meaning "select this one row" is a defensible reading. Documented, not fixed.
- Consumer self-check run by me: **13/13**, then **21/21**, both exit 0. `asks.json` contents confirmed by `cat`.
- Producer gates **blocked by policy** for the orchestrator's bash: three denials, always the same path token `packages/pi-ask-herdr`. Not a code problem. `reviewer-asks-producer` (dispatched ~1h, never reported) superseded by `reviewer-asks-producer-2`; its EVIDENCE is the only independent verification on that half, and this gap is stated to the user.

## Known residuals (not fixed, by design)
- Two consecutive questions with identical text and options produce an identical `msg`, defeating the panel's "did the dialog change" Enter check.
- Screen-sourced branch `engine.js:243-247` has no cursor check (T4's window partially covers it).
- Config change lands within 30 s (`tabs-asks/main.js:62-64` loads at mount and every 30 s); cards already in shared state persist up to 24 h (`KEEP_MS`).

## Final state (after deep-review rounds 1-3)

Two halves, one wire contract, unversioned between them. Deploy order matters: reload the
consumer mods BEFORE restarting pi sessions. An old consumer renders `choose in terminal: Q`
as a plain question with a free-text box — the exact bug removed here.

**Wire contract — producer `askBlockedStatus` emits exactly one of three shapes:**
- `answer: <q> (a · b · …)` — only for `select`/`confirm`, 2-9 real labels, every label
  sanitizing non-empty, and the whole message `<= MAX_STATUS_BYTES` (2048, pi's
  `formatProgramStatus` cap). These digits are answerable.
- `choose in terminal: <q>` — for `select`/`confirm`/`multiselect` that get no wrapper.
  Prefix is front-loaded so it survives truncation. Consumer maps it to `UNCLEAR` (no
  Answer control, "open the terminal").
- bare `<q>` — `text` questions only; free text genuinely works there.

**Consumer delivery, by card shape:**
| shape | buttons | typed answer | click delivery |
|---|---|---|---|
| report DECISION (pi-ask-herdr wizard) | real labels | blocked, note | digit only; **no Enter** |
| report APPROVAL (pi-permission-system) | Allow/Deny from `❯` rows | blocked | digit **then Enter** (`doublePressToConfirm`) |
| report UNCLEAR (`choose in terminal:`) | none | blocked | n/a — open terminal |
| text question (bare) | none | **works** (paste+Enter) | n/a |
| turn-sourced prose card | model options | works | prose send |
| stale-state `✎ Other [custom]` | filtered out | inert note | inert note |

**Final conditions in the consumer:**
- `asks/main.js:122` + `asks-fifo/main.js:135`: `if (ask.source === "report" && ask.kind === "DECISION") return await this.settle(...)` — the `kind` half is load-bearing; without it permission approvals are recorded delivered while only armed.
- `LEGACY_CUSTOM = "✎ Other [custom]"` exact-match (NOT `/^✎/`) in both consumers, because the producer now permits a real label beginning `✎`.
- `spaces-asks/main.js:40`: `(a.kind !== "UNCLEAR" || a.source === "report")` so the per-space pill counts no-button asks.
- `engine.js:101`: `choose in terminal: ` → `UNCLEAR`.
- `asks-fifo` has NO parser of its own; all cards consume `asks.state` from `tabs-asks/engine.js`. Only guards needed porting.

**Corrected residuals (superseding the list above):**
- Identical consecutive questions fail DIFFERENTLY than first recorded: click Q1 `b` → identical Q2 → card `failed`, never promoted; a Retry then presses `2` onto Q2 and records `["b","b"]` without Q2 ever having a card. Needs a repeated question AND a Retry click.
- Free-text "Other answer" is blocked on optioned non-`send` cards, including Claude Code dialogs that do accept typed text. Real capability loss.
- `classify: "always"` in `asks.json` would bypass the gate and re-derive options on `choose in terminal` cards. Default is `"auto"`; do not set `always`.
- Time-to-throw on honest failure is ~9.5 s while the message says "8 s" (`deliver` counts only `SETTLE_MS`). Cosmetic.
- A text question whose own text begins `answer:` or `choose in terminal: ` is reinterpreted by the consumer. `answer:` already behaved this way.

**Suites:** producer 45/45, typecheck + biome clean. Consumer self-check 36/36 (~22 s; the
honest-failure tests genuinely wait 1.5 s + 8 s).

**Commit hygiene:** 8+ untracked `herdr-asks-engine-selfcheck.mjs.bak-*` must NOT land; the
self-check now imports `asks/main.js` and `asks-fifo/main.js` by absolute path (not portable);
`tool.ts` was already non-conformant at HEAD, so pre-commit biome may reindent it.
