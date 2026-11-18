# LLM prompt summaries, with jev auto-mode weights

Status: implemented on `feat/llm-prompt-summary-annotator`; PR open against `jg33/pi-packages:main`.
Contract: `perm-annotator-contract.md` (Hermes/studio, 2026-11-18).

## What this changes

1. `packages/pi-permission-system`: an annotator is now handed the ask's `requestId` and a `log` seam (`AnnotatorInput`), so a model-backed annotator can leave a durable audit trail in the same review log the authorizer chain writes to.
   The annotation text itself is still never written by the permission system, and an annotator still cannot decide an ask.
2. `packages/pi-permission-model-annotator`: a new sibling package registering one annotator, `model-summary`.
   It asks a light model for one or two sentences explaining the pending call, appends the jev auto-mode weights when the ask's authorizer trail carries them, and falls back to a deterministic weights-only line or no annotation on every failure path.

## Facts re-verified before building

- `origin/main` is `400762e1` (merge of `feat/ask-user-dialog-parity`, PR #2). `git merge-base --is-ancestor 873c85da origin/main` is **YES**: the #654 seam and the built-in `pending-command` annotator are already on main, so this branch does not carry the old parity work.
- The published `@gotgenes/pi-permission-system@42.0.2` tarball predates the seam (`dist/public.d.ts` has no `Annotator` symbol).
  This package therefore declares the seam structurally and registers nothing (with one warning) on a host without it; the type-level contract in `pi-permission-system` is where the seam's real types live.
- jev weights are not reachable from `jev_authorizer_verdict` today: `pi-jev-auto-mode/src/authorizer.ts:301-323` writes `requestId`, `tool`, `status`, `source`, `rationale` to `log.review`, while `probabilities`/`thresholds`/`conditions` go only to `writeRecord` (`:302-308`).
  The annotator reads those fields if a future jev forwards them; absence degrades to prose.
- The emitter change is **ready as a patch, not as a PR**: the public `jg33/pi-jev-auto-mode` history has no `src/authorizer.ts` and no `jev_authorizer_verdict` (`git log --all -S jev_authorizer_verdict` is empty), so the authorizer integration exists only in the studio's unversioned working tree.
  Proposed patch, typechecked and tested against a copy of that tree (`npm run check`: 258/258 tests, including two new ones): `/Users/hermes/dev/jev-emitter-weights-forwarding.patch`.
  It spreads the engine `evidence` into the `jev_authorizer_verdict` review entry and adds nothing when the engine exposed nothing.

## Decisions and assumptions (product calls made without a blocking question)

- **Registration name** `model-summary`; activation only by naming it in `annotatorChain`.
- **Weights format** `p=0.93 (t=0.80)`, up to 3 rules (`write p=0.93 (t=0.80), bash p=0.41 (t=0.60)`), deciding rule first, then descending probability — the jev UI's own precision, bounded so the annotation stays a line.
- **Composition**: model prose first, then `— jev <status>: <weights>`; with no prose but weights present, a deterministic `jev-auto-mode: <status> — <weights>` line; with neither, `undefined` (the unannotated prompt).
- **Absence is absence**: a missing probability, threshold, verdict, or trail omits that part.
  Nothing is estimated, defaulted, or shown as a placeholder.
- **No new model call for the ranking** (reusing the existing jev verdict), matching `D4` of the asks-parity plan.
- **Annotation budget** default 220 characters, hard ceiling 500 (`maxCharacters`), because the prompt's row budget elides annotations first; the model answer is clipped, never rejected.
- **Two ceilings**: `timeoutMs` (default 4000, this package's own call bound) and pi-permission-system's `annotatorTimeoutMs` (default 1500, the real bound because it aborts the chain).
  Both are honoured; the outer one wins.
- **Audit entry** `model_annotator.decision` records status, reason, `modelCalled`, latency, api, the weights read, the weights shown, and `textLength` — deliberately not the text, so the review log stays annotation-free.
- **Fail-open to today's prompt**, never to a wrong decision: every failure returns no text (or weights-only) and logs why.
- **Version** `0.1.0`; the package is new, and the repo's release tooling owns the actual bump.

## Track A verification

Run from the repo root after `pnpm install`:

```text
pnpm -C packages/pi-permission-system run check              # only the pre-existing subagent-forwarding env error
pnpm -C packages/pi-permission-system run test               # 196/197 files; the 1 failure is the same missing sibling checkout
pnpm --filter @gotgenes/pi-permission-model-annotator run check   # exit 0
pnpm --filter @gotgenes/pi-permission-model-annotator run test    # 6 files, 51 tests, exit 0
npx biome check packages/pi-permission-model-annotator            # exit 0
npx eslint packages/pi-permission-model-annotator                 # exit 0
```

The one pre-existing failure is `test/subagent-forwarding-derivation.test.ts`, which imports `../../../../pi-subagent-forwarding/index` — a sibling checkout that does not exist on the studio, unrelated to this branch (red before any change here).

## Track B: blocked, not skipped

`jg33/herdr-asks-mods` does not exist as a repository: `gh api repos/jg33/herdr-asks-mods` returns 404, and `gh repo list jg33 --limit 200` does not list it, while listing the account's other private repos.
A PR cannot be opened against a repository that is not there, and creating one under another account is not this task's call.

What was done instead, so the work is one push away:

- a local repository at `/Users/hermes/dev/herdr-asks-mods` (branch `feat/model-summary-annotation`, commit `102f540`) built from the studio's mods copy — `mods/{tabs-asks,asks,spaces-asks}` — with the annotation surface implemented;
- the data path it relies on: herdr's OSC 7501 record carries `state`/`kind`/`msg` only, so the row is parsed from the screen text `tabs-asks` already captures, as `model-generated (<name>) : <text>` (the shape ADR 0011 §8 renders); the panel shows it under the question, prefixed `MODEL`;
- absence handling: no row, an unknown shape, or a wrapped first row yields `annotation: null`, and the card renders exactly what it renders today;
- verification: `node --test test/` in that repo, 7/7 passing (parser tests only; the mod itself has no harness).

The live copy under `~/.config/herdr-app/mods/` was restored to its pre-edit state after copying, so nothing on this host runs the unreviewed change: syncing live from the repo stays manual and Jesse's.
