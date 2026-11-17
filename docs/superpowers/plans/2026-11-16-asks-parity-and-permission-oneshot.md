# hh-asks-parity — finish the ask/permission parity slice and make it one step
<!-- hermes-handoff: ref=hh-asks-parity repo=OWNER/pi-packages base=feat/ask-user-dialog-parity test=pnpm -C packages/pi-permission-system run test -->
One task, one branch. This finishes an in-flight, unpushed slice and extends it. It is NOT a rewrite: most of the annotation seam already exists and is committed. Do not re-plan it.

## Context
pi loads `pi-permission-system` and `pi-ask-herdr` **from a working tree**, not a release:
`~/.pi/agent/settings.json` registers `/Users/jesse/Developer/repos/pi/pi-packages/packages/pi-permission-system` and `.../packages/pi-ask-herdr` by path. So the dirty state is live code, which is why behaviour is inconsistent.

Already committed on this branch (do not redo): `f0844e96` named annotator registry, `37a2f863` annotatorChain config keys, `a8cf4207` annotation runner + shared sanitiser, `dd5ac64b` drop wire-supplied annotations at the read boundary, `9ad53d50` render annotations as model-generated, `00bbb231` shared deadline, `862c1a8b` run at serving node behind a total guard, `0add68bc` annotator cannot decide or rewrite the facts, `d4bb6f0f` export `registerAnnotator` + document the seam, `3f6475cc` annotations never reach the other renderers. Also `d3ce0730` numbers dialog options so the Asks panel gets buttons, and `0c206ec9` reports pi as blocked while the dialog waits.

The gap: nothing registers an annotator that explains the command. The two surfaces disagree. And the slice below is uncommitted.

## Goal
The CLI permission prompt and the herdr Asks window show the same options and the same explanation. One prompt resolves the permission, including its scope. All work committed on the handoff branch; suite green.

## Inputs (verified 2026-11-16 on feat/ask-user-dialog-parity@3f6475cc)
- `packages/pi-ask-herdr/src/tool.ts:101` — `select`/`multiselect` hard-require a non-empty `options` array.
- `packages/pi-ask-herdr/src/ui.ts:235` — the CLI wizard renders `options` + `items: normalizeOptions(...)`.
- `packages/pi-ask-herdr/README.md:216` — the wire record is `ESC ]7501;state=blocked:app=pi:kind=question:msg=<base64>`. It carries `state`, `app`, `kind`, `msg` only.
- herdr-core binary, 7501 grammar — `states=idle,working,done,blocked,error:kinds=permission,question,auth`. No options field exists anywhere in the protocol.
- `~/.config/herdr-app/mods/tabs-asks/engine.js:251` — `const seen = model.options.filter((o) => text.includes(o)); if (seen.length === model.options.length && model.confidence >= 0.6)`. All-or-nothing: one paraphrased label drops every option.
- `~/.config/herdr-app/mods/tabs-asks/engine.js:296` — the `"message"` path adopts `model.options` with no verbatim check. The two paths disagree.
- `~/.pi/agent/extensions/pi-permission-system/config.json:4` — `"authorizerChain": ["jev-auto-mode"]`. jev already produces the verdict; it is simply never shown.
- Uncommitted: `permission-prompt-chrome.ts` (+9), `pi-ask-herdr/src/tool.ts` (+15/-), new `render-call.ts`, two new test files, ledger (+44).

## Decisions & Assumptions
D1. Base is this feature branch, not `main` — because eleven seam commits exist only here and would otherwise be rebuilt.
D2. Parity comes from deterministic option numbering already begun in `d3ce0730`, plus reading structured options where available — because the 7501 record provably cannot carry them (Inputs above). Do not invent wire fields.
D3. The explanation is an annotator, not a new subsystem — because `registerAnnotator` / `annotation-runner.ts` / `annotatorChain` already exist. Register one; do not add a parallel path.
D4. The jev ranking is read from the existing authorizer result and passed into the annotator as context — because `authorizerChain` already runs it. No new model call for the ranking.
D5. Scope decision (this agent vs all agents) folds into the existing prompt chrome — because `permission-prompt-chrome.ts` is already the modified surface.
A1. If `render-call.ts` turns out to duplicate `ui.ts`'s option rendering, delete it and extend `ui.ts` instead of keeping both.
A2. If the herdr mod proves unable to consume a structured option list, stop that item, record it under SKIPPED, and keep the numbering fix as the answer.

## Items
1. Evidence first: print `git status --porcelain`, then paste the diff of `permission-prompt-chrome.ts` and `pi-ask-herdr/src/tool.ts`, and the full text of `render-call.ts`. State in one line what the in-flight slice was trying to do, before changing it.
2. Commit the in-flight slice as-is once its tests pass (one commit; `render-call.ts` + its test + the fullscreen-fit test included). Do not mix it with the items below.
3. Finish CLI/panel option parity: one source of truth for the option list, consumed by both surfaces. Keep `engine.js` scraping only as the fallback for programs that cannot report structurally.
4. Collapse the permission prompt to one step: `allow` / `allow for this agent` / `allow for all agents` / `deny` in the first and only prompt. Reuse the existing scope plumbing; no second round.
5. Register one annotator that explains the pending command and why it is being run, and surfaces the jev-auto-mode ranking it already computed. It must stay advisory — `0add68bc` proves an annotator cannot decide or rewrite facts, and `3f6475cc` proves it never reaches the other renderers.
6. Verify: `pnpm -C packages/pi-permission-system run check`; `pnpm -C packages/pi-permission-system run test`; `pnpm -C packages/pi-ask-herdr run typecheck`; `cd packages/pi-ask-herdr && node --import ./tests/typescript-transform-hooks.mjs --test tests/*.test.ts`. All green, output pasted.

## Test baseline policy (decided by the user, binding)
All four verify commands pass on the reference checkout: `pnpm -C packages/pi-permission-system run check`,
`… run test` (196 files / 6668 tests), `pnpm -C packages/pi-ask-herdr run typecheck`, and the ask-herdr node suite
(27 tests). If a command is red **in the worktree** because a sibling checkout or workspace link is missing, that is
ENVIRONMENTAL: record the exact command and its output under SKIPPED with that evidence and move on.

**Do NOT exclude, skip, or delete a failing test to make the gate green.** Green by deletion is worse than honestly
red. If a test is red for a reason you cannot classify, report it as a QUESTION rather than removing it.

## Definition of done
Every item done or in SKIPPED; the four verify commands green **or** a red one evidenced as environmental under
SKIPPED; `git status --porcelain` empty except the agent's own `docs/superpowers/plans/artifacts/` ledger;
commits on top of the base branch once that ref resolves (see below).

## Base ref
If `origin/feat/ask-user-dialog-parity` does not resolve in the worktree, run `git fetch origin feat/ask-user-dialog-parity`
and retry. If it still does not resolve, bind the DoD to `git merge-base HEAD <the base commit sha>` and say in the
report which commit you used, rather than inventing a range or leaving the line untested.

## Non-goals
No extension of the OSC 7501 wire format. No new dependency. No changes to program-status semantics. No touching `~/.config` or `~/.agents`. No push, no PR, no merge.

## Constraints
No new dependency unless an item says so; no push, no PR, no merge (the supervisor owns egress). Conventional Commits, `-s` sign-off as Jesse Garrison <jesse@nightlight.io>. Do not edit `docs/superpowers/plans/2026-11-14-permission-annotation-seam.md`.

## Environment note — permissions are OFF (read this before item 4)
`pi-permission-system` is DISABLED globally on this machine for the duration of this run, so that the session can
work unattended. Consequences you must account for:
- No permission dialogs will fire. `edit`, `write` and `bash` will not stop for approval.
- You therefore CANNOT observe the permission prompt you are changing. Any claim about the prompt's appearance,
  its option list, or its scope choices must come from the vitest suites, not from a live dialog you did not see.
- When an item genuinely needs the prompt on screen (item 4's one-step prompt with agent/all-agent scope), RE-ENABLE
  `pi-permission-system` first, take the observation, then disable it again to continue. Say in your report that you
did this and what you saw.
- Never report a prompt behaviour you did not observe. If you could not re-enable it, record the item under SKIPPED
  with that reason.

## Risks
- The dirty tree is live code: a broken intermediate commit changes the user's running pi. Mitigation: item 2 lands only with its tests green.
- Removing `render-call.ts` in A1 could orphan a test. Mitigation: delete the pair together.
- The annotator adds latency to every permission prompt. Mitigation: `00bbb231`'s shared deadline already bounds it; do not raise the default.

## Out of scope here (separate prong, recorded so it is not lost)
Herdr mods are unversioned under `~/.config/herdr-app/mods/` and are NOT in this repo. `asks-fifo` — the mod that owns the queue — is absent from the `~/.agents` backup copy entirely. Required there, later and separately: sort pending by state then age so an answered ask moves to the end immediately, and auto-dismiss it once `delivered` (today `asks-fifo/main.js:271` sorts by age only and `:253` dismisses manually).
