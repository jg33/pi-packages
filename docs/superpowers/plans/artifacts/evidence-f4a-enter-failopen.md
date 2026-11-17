# Evidence ledger — F-4a: Enter on a freshly mounted permission dialog fails open

HEAD `cc2a3ac9` · branch `feat/ask-user-dialog-parity` · 2026-11-11
Paths are relative to `packages/pi-permission-system/` unless the entry says otherwise.

| id | claim | location | source | excerpt |
| --- | --- | --- | --- | --- |
| E1 | Decision-step `hotkey` events go through `pressHotkey`, which is the only place `doublePressToConfirm` is honoured | `src/authority/permission-prompt-decision.ts:185-188`, `:196-212` | read | `case "hotkey":` / `if (!config.doublePressToConfirm \|\| state.armedAction === action) {` |
| E2 | Decision-step `confirm` events bypass that guard and commit the highlight immediately | `src/authority/permission-prompt-decision.ts:189-190` | read | `case "confirm":` / `return commit(config, state, state.highlightedAction);` |
| E3 | The highlight starts on `approve`, so a first `confirm` at mount approves `Yes` | `src/authority/permission-prompt-decision.ts:131-143` | read | `highlightedAction: "approve",` |
| E4 | Arming state starts empty, so root cause (a) "initialises as if armed" is not it | `src/authority/permission-prompt-decision.ts:137`; assertion at `test/authority/permission-prompt-decision.test.ts:53-66` | read | `armedAction: undefined,` / `it("starts on the decision step highlighting approve with nothing armed"` |
| E5 | The component maps Enter to `confirm` on every step, and nothing buffers or replays a keystroke at mount — root cause (b) "type-ahead" is not it | `src/authority/permission-prompt-component.ts:458-477` (enter at `:465-467`), `:316` | read | `if (matchesKey(data, "enter")) {` / `return { type: "confirm" };` |
| E6 | The resting hint already promises a double press for every key, so single-press Enter contradicts the dialog's own copy | `src/authority/permission-prompt-component.ts:391-396` | read | `"Press a key, then again to confirm"` |
| E7 | The asymmetry was deliberate when built: Enter was specified as the always-single-press confirm, justified by "navigate-then-confirm is already two keystrokes" — false at mount, where nothing was navigated | `docs/plans/0573-inline-keybind-permission-dialog.md:129`, `:222` | read | `**enter** commits the currently highlighted option in one press (a deliberate navigate-then-confirm is already two keystrokes` |
| E8 | The user-facing config doc describes arming for hotkeys only and is silent on Enter | `docs/configuration.md:150-151` | read | `a hotkey **arms** its action and shows a` `` `Press y again to approve.` `` `hint` |
| E9 | The gate-semantics harness defaults `doublePressToConfirm: true`, so every bare `mountPrompt()` runs the armed path | `test/authority/helpers/prompt-harness.ts:81`, `:106` | read | `doublePressToConfirm: true,` |
| E10 | The `PINNED HAZARD` test to replace | `test/authority/permission-prompt-gate-semantics.test.ts:113-123` | read | `// KNOWN HAZARD, NOT ENDORSED (plan F-4a)` / `it("PINNED HAZARD: Enter on a freshly mounted dialog approves the initially highlighted option"` |
| E11 | `↑/↓ moves the highlight and enter commits` runs on the default (double-press **on**) view, so it breaks under the fix | `test/authority/permission-prompt-gate-semantics.test.ts:136-144` | read | `const m = mountPrompt();` / `m.type(KEY.down, KEY.down, KEY.enter);` |
| E12 | The component's nav+Enter test runs with double-press **on**, so it breaks under the fix | `test/authority/permission-prompt-component.test.ts:365-372` | read | `expect(await runPrompt(true, [ARROW_DOWN, ARROW_DOWN, ENTER]))` |
| E13 | A reducer test explicitly asserts single-Enter commit with double-press **enabled** and must be inverted | `test/authority/permission-prompt-decision.test.ts:207-219` | read | `it("confirms the highlighted option in a single enter press even when double-press is enabled"` |
| E14 | The component is the only production caller of `reducePrompt`, so a reducer-level fix is complete and a component-level one leaves no second surface fixed | `src/authority/permission-prompt-component.ts:483` (only hit for `reducePrompt(` under `src/`) | grep | `const outcome = reducePrompt(this.config, this.state, event);` |
| E15 | Enter in the **scope** step is also `confirm` and must keep committing on the first press — the guard may not be applied there | `src/authority/permission-prompt-decision.ts:312-321`; tests `test/authority/permission-prompt-gate-semantics.test.ts:155-178` | read | `case "confirm":` (inside `reduceScopeStep`) |
| E16 | Enter in the **reason** step never reaches `toEvent` (the framework editor owns it), so it is out of scope | `src/authority/permission-prompt-component.ts:411-421` | read | `if (this.state.step === "reason") {` / `this.handleReasonInput(data);` |
| E17 | Real gates: `test` = `vitest run`, `check` = `tsc --noEmit`, plus a `lint` script | `package.json:30,34,44` | read | `"check": "tsc --noEmit",` |
| E18 | The freeze on `src/authority/permission-prompt-decision.ts` is lifted for this file only; the other four gate files must diff empty against the tag | caller brief (sibling worker context, same session) | read | `That freeze is lifted for this file only` |
| E19 | The four remaining frozen files exist at the named paths | `src/authority/answer-window.ts`, `src/authority/permission-dialog.ts`, `src/config/dialog-keys.ts`, `src/presentation/dialog-renderer.ts` | ls | file listing |
| E20 | The dialog mounts through `ctx.ui.custom` and injects nothing into the input stream at mount (only a notification write) | `src/authority/permission-prompt-component.ts:233-260` | read | `return view.ui.custom<UnattributedDecision \| undefined>(` |

## Assumptions

- **A1** — The other four frozen files are exactly those named in E19; the constraint's authoritative list lives outside this repo (previous task's brief).
- **A2** — After the fix, arming by Enter shows `Press y again to approve.` (the bound key for `approve`). Enter is also a valid confirming key, so the hint under-describes it. Cosmetic only; not fixed here to keep the diff at one line.
- **A3** — No other test in the package drives Enter on the decision step with double-press on. Verified by sweeping `ENTER`/`KEY.enter` across `test/`; every other hit is the reason step, the scope step, or a `doublePressToConfirm: false` mount (tests listed in E11-E13 are the only three).
