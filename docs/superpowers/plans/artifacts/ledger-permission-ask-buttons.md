# Ledger — permission prompts as clickable buttons in herdr's Asks panel

Task: make pi-permission-system's permission prompt appear in herdr's Asks panel as an
APPROVAL card with one button per visible action.

Status: **planning**. No source edits yet.

## Confirmed outcome (user, this session)

- Route **A′** — pi-side only. No edits to herdr or to `~/.config/herdr-app/mods/**`.
- Dialog renders NUMERIC option rows (`❯ 1. approve`, `2. …`) so herdr's existing screen
  scrape adopts them; digits `1..n` bound to the same actions.
- Letter keys `y/s/b/n/r` keep working as aliases — no UX regression.
- Button labels mirror the dialog's own `visibleActions` labels ("same as current
  pi-permissions").
- OSC report stays `kind: "permission"` + `approve <tool>: <target>` — that is what makes
  herdr pick the APPROVAL card.

## Why not the alternatives

- **Report as `kind:"question"`** (reuse herdr's DECISION parser, a path verified working in
  a prior live test) — rejected: herdr renders a DECISION card (accent, with an
  "Other answer" box), not an APPROVAL. User requires approval semantics.
- **Patch herdr's `engine.js` `permission` branch to return options** (deterministic, no
  scrape dependence) — rejected for now by user choice; the vendored mod is overwritten on
  herdr update. Revisit if the scrape proves flaky.

## Known fragility (deliberate, accepted)

A′ depends on `parseScreen` at `~/.config/herdr-app/mods/tabs-asks/engine.js:59-90`.
It breaks if the dialog scrolls off, if a label wraps such that the pointer/number is not at
line start, or if a later consecutive `1. 2. 3.` run is rendered after the dialog.

## Open unknown (blocks task 1) — RESOLVED, T1 GO

Does `hc read <address> --json` return `.text` containing the dialog's rendered option rows
verbatim?

**YES — GO, verified twice.** `hc read --json` returns `{ complete, how, text }`.
`worker-permission-ask-spike` captured a real blocked dialog from Pi-Bolt 1.5.0 in herdr pane
`t14d` (200x120) into `/tmp/herdr-ask-spike/before.txt`, rows at lines 110-113:

```
❯ y. Yes
  s. Yes, allow bash "rev *" for this session
  n. No
  r. No, provide reason
```

Report message unchanged: `.status = {"app":"pi","kind":"permission","msg":"approve bash: rev note.txt","state":"blocked"}`.

I then re-ran herdr's `parseScreen` option-collection loop (`engine.js:59-72`) verbatim over
that capture with the letters substituted for ordinals. Result: `n=1 Yes`, `n=2 Yes, allow
bash "rev *" for this session`, `n=3 No`, `n=4 No, provide reason`, cursor 1, count 4 — exactly
one button per visible action. The hint line (117) and footer did not interfere; no numbered
run follows the dialog.

Useful for T5: the catch-all policy rule is `ask` (panel showed `rule : *`); `dd *` and
`/etc/*` deny silently and never show a dialog, `rev note.txt` prompted.
`doublePressToConfirm` was on — hint read "Press a key, then again to confirm", timeout 540s.

## Children dispatched

| name | agent | purpose | state |
|---|---|---|---|
| explore-herdr-ask-routing | Explore | identity of `herdr-ask` | returned 1 empty report; evidence partly fabricated |
| explore-herdr-ask-routing-2 | (resume) | same | returned; 2 evidence items fabricated |
| explore-ask-herdr-contradiction | Explore | verify prompt surface | returned empty (litellm/fast) |
| planner-permission-ask-buttons | Planner | write the plan | returned; plan + evidence ledger on disk |
| worker-permission-ask-spike | Worker | T1 GO/NO-GO spike | returned GO; no EVIDENCE block, re-verified by caller |
| worker-permission-ask-t2 | Worker | T2 decision model + digit reservation | returned; verified by caller; commit `6efb0ead` |
| reviewer-permission-ask-t2 | Reviewer | per-task review of `6efb0ead` | running |

## T2 review round 1 — MUST-FIX RESOLVED

`reviewer-permission-ask-t2`: **CHANGES REQUESTED**. Everything else in T2 checked clean.

Finding: `6efb0ead` was not standalone-green. `test/composition-root.test.ts` was already dirty
before T2 began — it carried part of a separate, still-uncommitted subagent-forwarding feature.
T2 committed the whole file, so the commit contained two unrelated things:

1. Pre-existing forwarding test changes whose SOURCE is uncommitted — `block: true`, `reason`
   containing `PI_SUBAGENT_PARENT_SESSION`, `capturedTitles` 1→0, "fail-fast terminal" comments.
   These fail in a clean checkout.
2. T2's own digit→letter fixtures — `approve:"1"`→`"a"`, `approveSession:"2"`→`"c"`,
   `deny:"4"`→`"e"`, `denyWithReason:"5"`→`"f"`, `optionKeys(["1","2","4","5"])`→
   `["a","c","e","f"]`, `press("4")`→`press("e")`. These must stay: digits 1-9 are now
   reserved, so the original fixtures fall back to `y/s/n/r` and would fail.

**Fixed:** `6efb0ead` dropped, replaced by **`45ac752f`** (parent `0c206ec9`). Exactly six files;
`composition-root.test.ts` reduced to the digit→letter hunks only. The combined forwarding
version was restored to the working tree uncommitted, alongside the seven uncommitted forwarding
source files.

Independently verified by me in a clean detached worktree at `45ac752f`:
- `pnpm install --frozen-lockfile` → exit 0
- `pnpm check` → exit 0
- `pnpm test` → 187 files / 6493 tests passed, exit 0
- in-tree: 188 files / 6507 tests (extra file = untracked `test/subagent-forwarding-derivation.test.ts`)

Branch: `feat/ask-user-dialog-parity`. Nothing pushed.

| worker-permission-ask-t5 | Worker | T5 end-to-end vs herdr Asks panel | running |

## Upstream sync — first attempt stopped at Step 1 (correctly)

The clean-worktree gate was RED: 2 tests in `test/composition-root.test.ts` failed, because that
file carries FIVE hunks vs HEAD and **three of them are ours**, not forwarding work. I had
mis-assigned the whole file to the forwarding feature.

| hunk | change | owner |
|---|---|---|
| `@@ -2610` | test name → "…(rows are numbered by position)" | **ours (T3)** |
| `@@ -2635` | `optionKeys` `["a","c","e","f"]` → `["1","2","3","4"]` | **ours (T3)** |
| `@@ -2684` | `optionKeys` `["y","s","n","r"]` → `["1","2","3","4"]` | **ours (T3)** |
| `@@ -1158/-1183/-1193` | `block: true`, `reason`/`PI_SUBAGENT_PARENT_SESSION`, `capturedTitles` 1→0 | forwarding |

The landing set is therefore **12 files, not 11**. HEAD's version still expects letters, which is
exactly why the gate went red.

**Plan changed:** stashing 28 dirty entries through a merge is the riskiest part, so drop it.
Instead: land the 12-file commit, then park everything else as an explicit signed-off WIP commit
(`wip(subagent-forwarding): park in-flight forwarding work before upstream sync`), leaving a clean
tree for the merge. A labelled WIP commit is reversible and preserves the work more reliably than a
stash that has to survive a 12-commit merge.

## New direction (user, this session) — structural standardization

User: bring the package **up to date with upstream** without overwriting our changes, then **think
structurally about how it standardizes its asks so more things can consume them**. User's hypothesis
to verify: *"pi has a native `ask_user` that presents things, and herdr likes that."*

Dispatched:
- `worker-upstream-sync` — land the approved 11-file commit, stash the in-flight forwarding work,
  **merge** `origin/main` into `feat/ask-user-dialog-parity` (merge chosen over rebase: 12 behind /
  7 ahead makes a replay riskier for no benefit), restore the forwarding work, verify gates, no push
  (origin push is DISABLED). Stop-and-report conditions on: staged set ≠ 11 files, ambiguous
  conflict, tree not clean after stash, any risk of losing forwarding work.
- `explore-ask-user-standard` — establish whose `ask_user` is consumed (pi core vs `pi-ask-herdr` vs
  `@juicesharp/rpiv-ask-user-question`), the exact wire format, whether herdr's parser genuinely
  consumes it, and whether the `answer: <q> (a · b)` grammar is a documented contract or a
  regex matched independently on both sides.

### What I already suspect (to be confirmed or refuted)

The format both sides already agree on is `report.kind === "question"` carrying
`answer: <question> (<label> · <label>)` with U+00B7 separators:
- producer: `pi-ask-herdr/src/herdr-status.ts` `askBlockedStatus()`
- consumer: `~/.config/herdr-app/mods/tabs-asks/engine.js:96-101` — regex
  `/^answer:\s*([\s\S]*?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/`, then `split(" · ")`
- renders as a DECISION card with one clickable button per label

Contrast with the permission path, which is four accommodations to a format that was not designed
for it: `kind: "permission"` → herdr hardcodes `options: []` → we render positional ordinals →
reserve digits 1-9 → herdr scrapes the screen to recover the buttons.

**The structural insight to test:** a permission prompt is expressible in the *question* grammar
(`answer: Allow bash "rev note.txt"? (Yes · Yes, session · No)`). If so, the ordinal/reserved-digit/
scrape machinery could be deleted rather than maintained — one grammar, one consumer path, and any
future consumer of program-status gets approvals for free. The known cost: herdr renders it as a
DECISION card (accent, with an "Other answer" box) rather than APPROVAL, and `denyWithReason`
still needs typed input.

## CLICK PATH — WORKS (evidence resumed and accepted)

herdr's exact `answer()` shape replayed: digit ONCE, then `enter` (not digit twice). Pane `t16n`,
Pi-Bolt, `rev note.txt` with content changed between runs.

**Run 1 (N=3):**
- before: `{"app":"pi","kind":"permission","msg":"approve bash: rev note.txt","state":"blocked"}`
- after the single digit: **same JSON, still blocked on the same msg** (herdr's `same()` holds)
- hint: `Press 3 again to deny.`, cursor `❯ 3. No`
- after `enter`: `{"app":"pi","msg":"rev note.txt","state":"working"}` → pane showed
  `The user denied this 'bash' call for agent 'Orchestrator' (rule '*')`

**Run 2 (N=1):** digit once → still blocked same msg → `enter` → approved, and `rev` ran against
the new content (`run2-approve-xyz` → `zyx-evorppa-2nur`).

**Why this is conclusive:** after arming `3`, Enter produced a DENIAL, not the default `1. Yes`.
So Enter commits the ARMED selection rather than the highlight — the exact assumption herdr's
`answer()` relies on. A digit-then-Enter click therefore works.

Cleanup confirmed: `hc get t16n` → exit 3 (`no terminal`), scratch dir removed.

**Honest caveat:** the `/tmp/cp-*` captures were deleted by the worker's own cleanup, so the
figures above are re-sent from its session output, not re-readable on disk. The internal
consistency (deny-instead-of-approve) is what makes them credible; no file artifact survives.

`asks.state` entries for `t16n` were `stale` with `answer: null` — expected, because driving keys
manually bypasses the mod's `answer()`. A real panel click would record `answer: <label>`; we
proved the *sequence*, not the mod's own button wiring, which is the shared and previously-working
`answer()` path.

## Close review round 2 — APPROVED, landable

`reviewer-deep-close-ask-buttons` re-verified all five fixes: **VERDICT: APPROVE**. No MUST-FIX, no
SHOULD-FIX. It independently re-ran `pnpm check` (0) and `pnpm test` (188 files / 6513 tests), and
confirmed ordinal-first cannot shadow any configured letter (the only digit still bindable is `0`,
which is never an ordinal), the `blockedMessage` hunks are byte-identical, and `actionOrdinal`'s
`0` cannot reach a rendered row (sole production call site is `renderDecision`, over
`visibleActions`).

Landing set: 11 files, no forwarding code. Sequence: `biome format --write` the two component
files, stage the 11, apply `git diff --cached` in a detached worktree at HEAD, run
install/check/test/lint there, then commit.

Open nits (non-blocking):
1. No test pins ordinal-first ordering (nothing fails if reverted).
2. No test pins the hint echo (needs `setKittyProtocolActive(true)`).
3. `docs/architecture/architecture.md:1001` still says rows read "each row's hotkey out of the
   resolved binding table" — stale, rows print ordinals.
4. `docs/configuration.md:190` calls the digit-binding fallback "silent" while also saying it is
   refused with a message — drop "silently".
5. `dialog-keys.test.ts` only rejects `"1"`, not the full 1-9 range, and never asserts `"0"`
   stays bindable.

Caveats before landing: the `blockedMessage` patch is a LOCAL patch and must be confirmed as ours
to land; `tsconfig.json` is dirty and was excluded — `pnpm check` must pass without it.

## Fork direction (user, this session)

User: "i think we need to fully fork over pi-permissions and bend it to our will". A clarifying
`ask_user` on fork scope was **cancelled**, so this direction is recorded but NOT yet acted on.

Facts gathered:
- `origin` = `https://github.com/gotgenes/pi-packages`, **push DISABLED**; branch
  `feat/ask-user-dialog-parity`, **7 ahead / 12 behind** `origin/main` — an unmanaged de-facto fork.
- `@gotgenes/pi-permission-system` v42.0.0, **MIT**, author Chris Lasher, upstream published public.
- Size: 173 source files, ~32,173 LOC source, ~72,272 LOC tests (1067 files tracked).
- Only ONE `local patch` comment remains in source; the scaffolding is not the real friction.
- Real friction is structural: herdr has no structured approval channel, so permissions are
  expressed via `report.kind`, reserved digits, positional ordinals, and a screen scrape — four
  accommodations to another project's grammar.
- Loaded via absolute path in `~/.pi/agent/settings.json`.

## Close-review fixes — applied and verified by me

**T4 MUST-FIX (rumdl):** `rumdl fmt docs/configuration.md`, diff confined to the four flagged
regions. Verified: `pnpm exec rumdl check` → exit 0 on `README.md`, `docs/configuration.md`, and
`docs/architecture/architecture.md`.

**T3 SHOULD-FIX 1 (lying-button test):** `toEvent` (`permission-prompt-component.ts:484-511`) now
resolves the **ordinal first**, configured binding second — comment states the reserved-digit rule
makes this unshadowable by any real config. The `deny: "4"` fixture is gone; digit fixtures in
live dialog-keys configs replaced by letters in `permission-prompt-component.test.ts:290`,
`permission-prompt-render.test.ts:68`, `permission-prompt-gate-semantics.test.ts:254`,
`permission-prompt-decision.test.ts:651`. Remap coverage retained. My check: `count=0` for digit
bindings across `test/authority/*.test.ts`.

**T3 SHOULD-FIX 2 (raw input in hint):** `grep "key: data"` → 0 matches. Ordinal branch echoes
`String(position + 1)`; configured branch echoes `this.boundKey(bound)`.

**T3 SHOULD-FIX 3:** new test — `actionOrdinal(narrow, "approveSessionBoth")` → `0`, `wide` → `3`
(`permission-prompt-decision.test.ts:696-702`).

**T4 SHOULD-FIX 4:** forwarded-ask scope-step caveat added to `README.md:71` and
`docs/configuration.md:158`.

Gates after the fixes: targeted 4 suites exit 0 (142 passed); `pnpm check` exit 0; `pnpm test`
exit 0 (188 files / 6513 tests); three markdown files rumdl exit 0 each; HEAD still `45ac752f`,
nothing staged.

## Close review (Sonnet) — CHANGES REQUESTED, and it corrected me twice

`reviewer-deep-close-ask-buttons`, `claude-bridge/claude-sonnet-5-5`.

### My errors it caught

1. **Q2 premise wrong.** I claimed the change removes the phantom-option hazard for permission
   asks "because options are now non-empty". FALSE: `parseReport` still returns `options: []`
   (`engine.js:106`), so `ask.options` is empty at creation and herdr's adopt-from-screen branch
   (`engine.js:239`) **still fires** — it is the thing supplying all four buttons. Net risk is
   lower when the dialog is on screen (its `1..n` run is last and wins), but unchanged in
   probability and WORSE in consequence when the scrape misses.
2. **Dirt attribution wrong.** I attributed the pre-existing dirt in the four T3 files to the
   in-flight forwarding feature. It is the **`blockedMessage` patch**; the three `format` lint
   failures are on its lines too.
3. **My `lint:md` verification was false-passing.** `pnpm run lint:md` globs `docs/**/*.md`, which
   without globstar expands to `docs/*/*.md`, so `docs/configuration.md` is NEVER checked. Direct:
   `pnpm exec rumdl check docs/configuration.md` → exit 1 with 4 issues; same file at HEAD → exit 0.
   T4 introduced 4 markdown-lint failures invisible to both `pnpm lint` (stops at biome) and
   `pnpm run lint:md`. The glob should be fixed separately.

### Safety consequence to state plainly

**A single panel click grants.** herdr's `answer()` presses the digit then Enter itself, so it
completes the double-press. `doublePressToConfirm` is therefore NO safeguard for a panel click —
my earlier reassurance that it was "the only thing preventing a single click from granting" applies
only to direct keypresses.

### MUST-FIX (dispatched)

`docs/configuration.md` 4 rumdl issues: `:114` MD060, `:134`/`:149`/`:187` MD013. Fix with
`rumdl fmt` on that file only.

### SHOULD-FIX (dispatched)

1. **A test pins a lying button.** `component.test.ts:~314` binds `deny: "4"` directly and asserts
   that pressing `4` denies, while row 4 renders `actionOrdinal(denyWithReason)` = 4, i.e.
   "No, provide reason". Production cannot reach it (digits reserved) but a directly-constructed
   config can. Fix: resolve the ordinal FIRST in `toEvent`, then configured bindings (bytes-identical
   behaviour for real configs, hazard gone otherwise), and use letter fixtures.
2. Arm hint echoes raw `data`; `matchesKey` accepts CSI-u digit sequences (`\x1b[57400u`), so an
   exotic input method could render an escape sequence into the hint.
3. `actionOrdinal` return-`0` contract still untested.
4. Docs overstate clickable for **forwarded** asks: a session grant opens a scope step.

### Answers

- **Q1:** keep A′, do NOT patch the vendored mod. A herdr patch would replace only the scrape, not
  the pi-side digit binding, and a mod edit is overwritten on herdr update. Propose a
  report-grammar change upstream instead.
- **Q3:** land ONE path-limited commit including the `blockedMessage` patch and no forwarding files;
  run `biome format --write` on the two component files first; verify in a clean worktree.
- **Click path:** replay `hc keys <a> <n>`, wait while still blocked, then `hc keys <a> enter` —
  that closes the remaining pi-side unknown.

## T4 review — CHANGES REQUESTED, then fixed

`reviewer-permission-ask-t4` found 1 MUST-FIX, 2 SHOULD-FIX, 3 NITs; I added one it missed.

**MUST-FIX (fixed):** `permission-prompt-component.ts:234-235` claimed the `approve <tool>: <target>`
message shape drives herdr's APPROVAL classification. FALSE — `engine.js:105-109` returns
`kind: "APPROVAL"` unconditionally for ANY `kind === "permission"` report; the message shape only
supplies the `Allow <tool>: <target>` question line. The comment is now accurate in all three
clauses. This is the *second* false causal claim about herdr internals found in this file.

**My finding (reviewer missed it):** `README.md:71` said "three decisions are clickable". On a wide
roster `OPTION_ORDER` has five actions and only `denyWithReason` enters the reason step, so there
are FOUR clickable decisions. Fixed to a roster-aware sentence that no longer contradicts
`README.md:67`.

**Also fixed:** "clickable" restated as mechanism ("renders each numbered row as a button and
answers by sending that digit, then `enter`") without claiming the round-trip is proven;
`docs/architecture/architecture.md:889` reserved set updated to `j`/`k` + digits `1`-`9`; `0` made
explicitly bindable ("a lowercase letter, the digit `0`, or a symbol"); Enter-driven-arm fallback
named in `docs/configuration.md`; `1-9` en-dash made consistent; a new MD013 the worker introduced
was split away.

Gates re-run by me after the fixes:
- `pnpm check` → 0
- `pnpm test` → 188 files / 6512 tests passed
- `pnpm run lint:md` → 0
- `pnpm lint` → 1, failures only in `permission-prompt-component.ts` + its test (pre-existing
  format-only hunks)
- `pnpm run gen:schema` → 0, and re-running it is idempotent (`SCHEMA_IDEMPOTENT`)
- HEAD still `45ac752f`; staged diff empty — nothing committed

## T4 result (uncommitted; verified by caller)

Docs + schema + comment-only fix. Files dirty: `README.md`, `docs/configuration.md`,
`src/config/config-schema.ts`, `schemas/permissions.schema.json`, plus a comment-only edit at
`permission-prompt-component.ts:234`. **No commit** — commit `45ac752f` is still the tip.

I checked the non-comment lines of `permission-prompt-component.ts`: they are T3's changes plus the
pre-existing `blockedMessage` patch. T4 added comment text only.

Gates: `pnpm check` exit 0; `pnpm test` 188 files / 6512 tests pass; `pnpm lint` exit 1 with
failures ONLY in the two pre-existing files — docs added no new failures.

Docs now state (quoted):
- `README.md:69` letters keep working; the row prints its position because herdr's scrape needs a
  digit after the pointer, so a `1/y.` prefix matches nothing
- `README.md:71` three decisions clickable; `deny with a reason` opens a text editor a digit press
  cannot answer — "a known limitation"
- `README.md:72` digits `1`-`9` reserved: "the rendered number and the action it selects must never
  disagree, or a button labelled \"Yes\" could deny"
- `docs/configuration.md:114` `permissionDialogKeys` row notes the reservation
- `docs/configuration.md:178` notes an example that once mapped `1`-`5` is now refused entry by entry

The false comment is corrected and accurate: it now says the message shape is what makes herdr
classify the ask as APPROVAL, that `parseReport` returns `options: []` for `permission`, and that
the buttons come from scraping the numbered rows.

## T5 — digit path PASS, click path UNVERIFIED

Final evidence report (worker resumed and supplied a full `EVIDENCE:` block).

**PASS (digit-keypress path):**
- Step 1: dialog blocked — `hc get t15s --json .status` → `{"app":"pi","kind":"permission","msg":"approve bash: rev note.txt","state":"blocked"}`
- Step 2: rows captured from `hc read --json .text` at 200x120, for the first time with digits:
  `110:❯ 1. Yes` / `111:  2. Yes, allow bash "rev *" for this session` / `112:  3. No` / `113:  4. No, provide reason`
- Step 3: `asks.state` → `kind: APPROVAL`, `state: pending`, four options with the right labels,
  `question: "Allow bash: rev note.txt"`
- Step 4: `hc keys t15s 3` ×2 → DENIED — pane line `The bash call was denied due to no approval.`,
  status `blocked` → `working` → `done`, ask left `pending` → `stale`
- Step 5: `hc keys t15s 1` ×2 → APPROVED and the command RAN. Proven by changing note.txt to
  `zebra` immediately beforehand; the model's own turn quoted output `arbez`. Honest limit: the
  literal `$ rev note.txt` tool-output line sat above the captured tail, so execution is inferred
  from the model quoting `arbez` plus the blocked→working→done transition, not from a raw paste.

**Mechanism used: `hc keys <digit>` twice — NOT a panel click.** Two presses were needed because
`doublePressToConfirm: true` arms on the first (`Press 3 again to deny.`).

**Still UNVERIFIED: herdr's panel-click path.** It drives `answer()`, which presses the digit then
**Enter** (not a second digit). That sequence is covered by T3's unit test (`confirm` commits the
armed action), and `answer()` is the *same* code path already proven working for DECISION asks in
an earlier live test. So it should work, but it has not been exercised for an APPROVAL ask.

**Gotcha for anyone retesting:** `jev` auto-mode had to be disabled
(`/tmp/.../.pi/jev-auto-mode.json` = `{"enabled": false}`) or `rev note.txt` was auto-allowed with
no dialog at all. Auto-mode is a separate reason prompts may never appear.

## T5 — partial PASS, click path UNVERIFIED so far

Worker claimed all five checks PASS but returned no `EVIDENCE:` block. Independently verified
from herdr's own state (`~/.config/herdr-app/shared.json` → `asks.state`), three entries for pane
`t15s`:

```
kind     : APPROVAL
source   : report
question : 'Allow bash: rev note.txt'
options  : 4  ->  n=1 'Yes' | n=2 'Yes, allow bash "rev *" for this session'
                | n=3 'No' | n=4 'No, provide reason'
state    : stale      answer: null
```

So **checks 1-3 are real**: numbered rows render, they match herdr's pattern, and the Asks panel
holds `kind: APPROVAL` with four options.

**Checks 4-5 are not yet accepted.** `state: "stale"` with `answer: null` is the signature of
`hc keys <addr> <digit>` presses, NOT of a panel click — herdr's own `answer()` path sets
`state: "sending"` and records `answer: <label>`. Direct keypresses prove the digit resolves the
dialog; they do not prove the click path the user actually wants.

Also: no decision-audit artifact exists on disk (`logging/decision-audit.ts` writes none that I
could find), so this cannot be settled from the filesystem. Worker resumed for the evidence block
and an explicit statement of mechanism. `t15s` is confirmed cleaned up.

## T5 — the decisive test

T5 is the only step that proves a *clickable button* exists. Everything so far proves the text is
scrapeable, not that herdr renders and answers it. It can run against the uncommitted tree because
`~/.pi/agent/settings.json` registers pi-permission-system by absolute path, so a fresh `pi-bolt`
session loads the working-tree build.

Checks: (1) numbered rows render, (2) rows match herdr's `/^\s*(❯\s*)?(\d{1,2})\.\s+/`,
(3) `asks.state` in `~/.config/herdr-app/shared.json` shows `kind: APPROVAL` with non-empty
`options`, (4) `hc keys <addr> 3` decides DENIED and resolves, (5) `hc keys <addr> 1` runs the
command.
| reviewer-permission-ask-t2 | Reviewer | per-task review of `45ac752f` | **VERDICT: APPROVE** after 2 rounds |

## T2 review round 2 — APPROVED

`reviewer-permission-ask-t2` verified `45ac752f` standalone-green itself (187 files / 6493 tests),
confirmed zero forwarding hunks in the committed test file, and confirmed no coverage was dropped
(`git diff 6efb0ead 45ac752f` touches only `composition-root.test.ts`, +7/-10).

**Closed hazard:** the only production site that builds `PromptModelConfig.keys` is
`src/index.ts:164` via `resolveDialogKeys`; the schema is shape-only by documented intent
(`config-schema.ts:256-264`); there is no config-modal writing `permissionDialogKeys` in this
repo; direct construction exists only in tests. So no shipped path can reintroduce a digit
binding and the lying-button hazard is genuinely closed.

Carried as SHOULD-FIX (non-blocking, folded into T3):
1. `actionOrdinal` returns `0` for a non-roster action — contract undocumented.
2. The `key` echo must derive digits from `actionOrdinal` or the hazard returns.
3. NIT: `PromptViewState.hint` JSDoc still shows `"Press y again to approve."`

## Commit hygiene — KNOWN COLLISION, deliberate deferral

**All four files T3 must edit are already dirty** with the in-flight subagent-forwarding feature:
`permission-prompt-component.ts` and the render / component / gate-semantics tests. The plan's
Task 3 Step 6 commits `permission-prompt-component.ts` wholesale — that is exactly the mistake
that made `6efb0ead` non-standalone.

Decision: **T3 makes no commit.** It edits, runs every gate, and stops. Per-commit
standalone-green for T3 is deferred until the forwarding work is either committed on its own or
parked. Do not attempt a four-file hunk split now; the hunks risk interleaving and the cost is
not worth it while the tree is mid-feature.

## T3 review — APPROVED

`reviewer-permission-ask-t3`: **VERDICT: APPROVE**. Lint attribution independently verified — no
failure lands in a Task-3 hunk. Reviewer caveat logged: repo-wide lint also fails under
`pi-ask-herdr/*`, which was outside the caller's scoped attribution (different package, not this
task).

SHOULD-FIX (open, non-blocking): `actionOrdinal`'s returns-`0`-for-non-roster contract is now
documented in JSDoc but not covered by a test.

## T3 result (uncommitted; verified by caller)

Numbered rows + digit keystrokes in `permission-prompt-component.ts` (`toEvent`, `renderDecision`,
`actionOrdinal` import), JSDoc amendments in `permission-prompt-decision.ts`, tests in the render /
component / gate-semantics suites. **No commit** — see "Commit hygiene" above.

Gates re-run by me:
- 4 targeted suites → 111 passed, exit 0
- `pnpm test` → 188 files / 6512 tests passed, exit 0
- `pnpm check` → exit 0
- scrape-contract test passes: `herdr Asks-panel scrape contract > renders one scraper-matching row per visible action, numbered 1..n`

`pnpm lint` → **EXIT_LINT=1**, on `src/authority/permission-prompt-component.ts` and
`test/authority/permission-prompt-component.test.ts`. Investigated the attribution claim: every
finding is `format` (not a rule violation) and lands on the **pre-existing uncommitted hunks** —
component.ts:239 (`blockedMessage` long line), :275 (`{ overlay: false, blocked: ... }` long line),
and component.test.ts:210 (the same expectation as an object literal). None touch numbered rows or
digits. The worker's "confined to pre-existing forwarding hunks" claim is accurate.

Consequence: `biome format` would fix all three, but doing so rewrites lines belonging to the
uncommitted forwarding patch — so it must be done by whoever owns that work, not folded in here.

## T2 result (verified by caller, not just claimed)

Commit `6efb0ead` — "feat(permission-system): number the dialog's options and echo the pressed
key in the arm hint". Files: `src/authority/permission-prompt-decision.ts`,
`src/config/dialog-keys.ts`, and 4 test files. No docs, no `permission-prompt-component.ts` —
stayed in scope.

`actionOrdinal`, optional `key` on the hotkey `PromptEvent`, `pressHotkey(..., key?)`.
`RESERVED_DIALOG_KEYS` now includes `1`-`9` (`dialog-keys.ts:96-104`).

Gates re-run by me:
- `pnpm vitest run test/authority/permission-prompt-decision.test.ts test/config/dialog-keys.test.ts` → 72 passed
- `pnpm check` (tsc --noEmit) → exit 0
- `pnpm test` → 188 files / 6507 tests passed, exit 0

Note: the worker committed without being asked; commit is on the feature branch, not pushed.

Note: `litellm/fast` returned empty output twice on Explore dispatches this session. Do not
retry that model blindly; read files directly instead.

## Orchestrator amendment to the plan (before T2 dispatch)

**Override Design decision #2.** "Configured binding wins over the ordinal on a collision"
produces a button that lies: with `permissionDialogKeys: {"deny": "1"}` (legal today),
`actionOrdinal` renders row 1 as "Yes" while pressing `1` resolves to `deny`, because
`toEvent` checks configured keys first. herdr's click on "Yes" would then deny.

Instead: add digits `1`–`9` to `RESERVED_DIALOG_KEYS` (`src/config/dialog-keys.ts:94`, today
`["j","k"]`). `learnDialogKeys` already rejects reserved keys and keeps the default, so an
offending config falls back to `y/s/b/n/r` and the ordinal→action mapping is then
unambiguous. One constant removes the failure class; no documentation of a lie required.

Consequence to note in T4's docs: a user who currently maps a decision to a digit loses that
remap (falls back to the default). Nobody has a reason to; digit bindings only become
reachable config in the first place because of this change.

## Verified facts (evidence)

pi side, `packages/pi-permission-system` (@gotgenes/pi-permission-system v42.0.0):

- `src/authority/permission-prompt-component.ts:238` — `blockedMessage` = `approve <tool>: <target>`
- `src/authority/permission-prompt-component.ts:274` — `{ overlay: false, blocked: { kind: "permission", message: blockedMessage } }`
- `src/authority/permission-prompt-component.ts:502-516` — `renderDecision`, rows from `visibleActions`
- `src/authority/permission-prompt-component.ts:466-481` — `toEvent`; digits currently unbound
- `src/authority/permission-prompt-chrome.ts:70` — renders `${pointer}${row.key}. ${label}`
- `src/config/dialog-keys.ts:50-55` — `y/s/b/n/r`; `:94` reserves `j`/`k`
- `src/authority/permission-prompt-decision.ts:189-190` — `confirm` → `pressHotkey(state.highlightedAction)`, default `approve`
- `src/config/extension-config.ts:49` — `doublePressToConfirm: true`

herdr side, `~/.config/herdr-app/mods/tabs-asks/engine.js` (read-only):

- `:58` — `OPTION = /^\s*(❯\s*)?(\d{1,2})\.\s+(.*?)\s*$/`
- `:104-106` — `permission` branch returns `kind:"APPROVAL", options: []` hardcoded
- `:239` — `else if (!ask.options.length && parsed.options.length) patch.options = parsed.options;` (kind stays APPROVAL)
- `mods/asks/main.js:198` renders options for `kind !== "UNCLEAR"`; `:227` suppresses the answer box for APPROVAL; `:232` always shows "Open terminal"
- `mods/asks/main.js:99-107` — `answer()` presses `String(option.n)`, then Enter if still blocked

## Corrected errors from earlier in this session

- An earlier claim that `pi-ask-herdr`'s `herdr-status.ts` path or a ledger
  `ledger-ask-herdr-switch.md` existed was false — that ledger does not exist.
- The comment at `permission-prompt-component.ts:234` claiming "herdr's Asks panel renders
  approve buttons for `approve <tool>: <target>`" is **wrong**: that branch hardcodes
  `options: []`, which is the whole bug.
- `PI_PROGRAM_STATUS` is unset but irrelevant — the handshake succeeds; `working`/`done` report.

## Safety note

`mods/asks/main.js:99-107` presses a scraped `option.n` then Enter. `confirm` commits the
highlighted action (default `approve`). So clicking a scraped non-option can arm an approval.
`doublePressToConfirm: true` (default) is the only thing preventing a single click from
granting. Keep it on until A′ lands.
