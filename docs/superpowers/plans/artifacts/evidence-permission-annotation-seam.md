# Evidence ledger — permission annotation seam (ADR 0011 §8, #654, increment A)

HEAD 3a5081ab — 2026-11-14 — branch `feat/ask-user-dialog-parity`, working tree dirty (see E40).

Paths are relative to `packages/pi-permission-system/` unless prefixed `repo:`.
Repo is not CodeGraphContext-indexed (per brief); every structure claim below was gathered with `rg`/read, so the "callers" entries name the exact `rg` query.

## A. The spec

E1 | ADR 0011 §8 states the annotator seam verbatim | docs/decisions/0011-prompt-presentation-contract.md:209-211 | source: read | excerpt: `A named, opt-in, config-ordered annotator registry, mirroring \`registerAuthorizer\` and \`registerToolInputFormatter\`, fails safe when a configured name is unregistered.`

E2 | ADR 0011 §8 four admissibility properties: slot + attribution + marking owned here; structurally separate from `AuthorizerVerdict`; timeout-bounded with unchanged-prompt fallback; runs at the serving node | docs/decisions/0011-prompt-presentation-contract.md:211 | source: read | excerpt: `the slot is structurally separate from \`AuthorizerVerdict\`, so an annotator cannot allow, deny, defer, or suppress; it is timeout-bounded with an unchanged-prompt fallback`

E3 | ADR 0011 §7: annotations are forbidden in the agent-facing renderer | docs/decisions/0011-prompt-presentation-contract.md:198-199 | source: read | excerpt: `- **Forbidden**: annotations.`

E4 | ADR 0011 §6: the `permissions:ui_prompt` broadcast carries no annotations; review log renders under its own limits | docs/decisions/0011-prompt-presentation-contract.md:167 | source: read | excerpt: `| \`permissions:ui_prompt\` broadcast | \`request\` only | no \`evidence\`, no \`annotations\` |`

E5 | #654 has no local issue body. Only references: ADR §8/§Staging, one phase-13 history line, two triage rows. The ADR text is the spec. | docs/decisions/0011-prompt-presentation-contract.md:303 ; repo:docs/triage/2026-10-18-backlog.md:184 | source: grep (`rg -n 654`) | excerpt: `| [#654] | a downstream package plus the annotator seam described in §8 |`

## B. The payload slot (and a correction to the brief)

E6 | CORRECTION: the brief's prompt-payload.ts line numbers are stale. Actual: `PromptPayload` 12-19, `PromptPayloadKind` 31-41, `PromptRequestFacts` 50-93, `PromptEvidence` 125-137, `PromptAnnotation` 145-148 | src/presentation/prompt-payload.ts:12-148 | source: grep (`rg -n "^export"`) | excerpt: `export interface PromptAnnotation {` / `readonly source: string;` / `readonly text: string;`

E7 | `PromptPayload.annotations` is `readonly PromptAnnotation[]`, doc says "always marked as model-generated" but nothing marks it | src/presentation/prompt-payload.ts:17-18 | source: read | excerpt: `/** Supplied by registered annotators; always marked as model-generated. */`

E8 | The wire parser accepts `{source,text}` and rebuilds exactly those two fields; a payload with a malformed annotation is dropped whole | src/presentation/prompt-payload.ts:207-210, 312-322 | source: read | excerpt: `const annotations = asArrayOf(candidate.annotations, asPromptAnnotation);`

E9 | Five payload-builder sites write `annotations: []` (path-ask-payload has TWO: 127 and 158; the brief listed one range) | src/presentation/tool-ask-payload.ts:55 ; skill-ask-payload.ts:50 ; path-ask-payload.ts:127,158 ; forwarded-ask-payload.ts:67 | source: grep (`rg -n "annotations: \[\]" src/presentation`) | excerpt: `annotations: [],`

E10 | Nothing in `src` reads `annotations` except the type, the parser and the five builders | src/** | source: grep (`rg -n "annotations" src`) | excerpt: (result set: permission-events.ts:117 comment, prompt-payload.ts, 5 builders, review-log-renderer.ts:12 comment)

## C. Registry idioms to mirror

E11 | `AuthorizerLookup` / `AuthorizerRegistrar` are the ISP read/write halves | src/authority/authorizer-registry.ts:28-38 | source: read | excerpt: `export interface AuthorizerRegistrar {` / `register(name: string, authorize: Authorizer["authorize"]): () => void;`

E12 | `AuthorizerRegistry`: Map-backed, duplicate name throws, disposer is identity-guarded | src/authority/authorizer-registry.ts:48-76 (register 61-72) | source: read | excerpt: `throw new Error(\`An authorizer is already registered for '${name}'.\`);` / `if (this.links.get(name) === authorize) {`

E13 | `ToolInputFormatterRegistry` is the same idiom keyed by tool name | src/tool-input/tool-input-formatter-registry.ts:37-68 (register 50) | source: read | excerpt: `\`A tool input formatter is already registered for '${toolName}'.\``

E14 | Registration alone grants nothing; the operator's `authorizerChain` names activate a link; registry is storage only | src/authority/authorizer-registry.ts:6-12 | source: read | excerpt: `Registration alone grants no authority — a link decides nothing until the operator names it in the \`authorizerChain\` config`

E15 | Config-order resolution + fail-safe skip: `get(name)` undefined → `chainAudit.auditUnregisteredLink` and `continue` | src/authority/authorizer-selection.ts:192-216 | source: read | excerpt: `const authorize = this.deps.authorizerRegistry.get(name);` / `if (authorize === undefined) {` / `this.deps.chainAudit.auditUnregisteredLink({ requestId, name });`

E16 | The chain is read live per ask via a thunk; empty config → no links at all | src/authority/authorizer-selection.ts:161-176 ; src/index.ts:185 | source: read | excerpt: `getAuthorizerChain: () => configStore.current().authorizerChain ?? [],`

E17 | The skip is audited twice: a review-log entry per skipped ask, and ONE operator-visible warning per configured name (latch). Rationale: the silent skip was a defect (#861) | src/authority/authorizer-chain-audit.ts:29-32 (log seam), 61-71 (message), 83-97 (latch) | source: read | excerpt: `this.log.review("authorizer_chain_unregistered_link", {` / `if (this.warned.has(link.name)) {` / `this.log.warn(unregisteredLinkMessage(link.name));`

E18 | Public service surface: `registerToolInputFormatter` then `registerAuthorizer(name, authorize): () => void`; the authority registry deliberately has NO reader because a verdict must not cross nodes | src/service.ts:166 (formatter), 220-245 (authorizer + rationale) | source: read | excerpt: `registerAuthorizer(` / `name: string,` / `authorize: Authorizer["authorize"],`

E19 | `LocalPermissionsService` takes one registrar per registry as a constructor arg; `registerAuthorizer` delegates | src/service/permissions-service.ts:49-58, 128-134 | source: read | excerpt: `private readonly authorizerRegistry: AuthorizerRegistrar,`

E20 | Composition root creates each registry once and shares the instance between the service surface and the consumer | src/index.ts:93-99, 185, 262-275 | source: read | excerpt: `const authorizerRegistry = new AuthorizerRegistry();`

E21 | `ObservedAuthorizerRegistrar` records a link registered on a node whose chain never runs (ADR 0012 decision 4). Not mirrored in this increment: annotators run only inside `LocalUserAuthorizer`, which a relaying node never builds. | src/authority/authorizer-registry.ts:96-118 ; src/authority/authorizer.ts:164-166, 199-201 | source: read | excerpt: `this.logger.review("authorizer_link_vacant", { name });`

E22 | Only the sibling model-judge package implements a `PermissionsService` fake (`makeService`). It resolves the PUBLISHED `@gotgenes/pi-permission-system@40.3.0` (symlink into `node_modules/.pnpm`), not the workspace package at 42.0.0, so a new required method does not break it until it bumps that devDependency. | repo:packages/pi-permission-model-judge/test/extension.test.ts:88-103 ; repo:packages/pi-permission-model-judge/package.json:71 | source: read + `ls -l packages/pi-permission-model-judge/node_modules/@gotgenes/` | excerpt: `registerAuthorizer: vi.fn(() => disposer),`

## D. Config

E23 | `authorizerChain?: string[]` on the runtime config; normalize copies it only when defined | src/config/extension-config.ts:41-42, 114-116 | source: read | excerpt: `if (raw.authorizerChain !== undefined) {`

E24 | Zod schema is the single source (ADR 0004); `authorizerChain` is `z.array(z.string().min(1)).max(MAX_CONFIG_ARRAY_ITEMS).optional().meta({...default: []})`; `promptTimeoutMs` is `z.number().int().min(1).optional().meta({...})` | src/config/config-schema.ts:493-498 (promptTimeoutMs), 545-555 (authorizerChain) | source: read | excerpt: `authorizerChain: z` / `.array(z.string().min(1))` / `.max(MAX_CONFIG_ARRAY_ITEMS)`

E25 | Merge: number scalars list and array list in `mergeUnifiedConfigs`; override replaces base | src/config/config-loader.ts:234-256 | source: read | excerpt: `for (const key of ["piInfrastructureReadPaths", "authorizerChain"] as const) {`

E26 | Generated artifact: `pnpm gen:schema` rewrites `schemas/permissions.schema.json`; package scripts: `check` = `tsc --noEmit` (tsconfig includes `src` and `test`), `test` = `vitest run`, `lint` = biome + eslint + rumdl | package.json:30-44 ; tsconfig.json:12 | source: read | excerpt: `"gen:schema": "node --experimental-strip-types scripts/generate-permissions-schema.ts && biome format --write schemas/permissions.schema.json"`

E27 | Existing config test shapes to copy: normalize include/omit, merge override/base-survives, schema bound table | test/config/extension-config.test.ts:143-150, 209-219 ; test/config/config-loader.test.ts:705-719 ; test/config/config-schema.test.ts:465-486 | source: read | excerpt: `["authorizerChain", { schema: unifiedConfigSchema, build: (entries) => ({ authorizerChain: entries }),`

## E. The deadline

E28 | `promptTimeoutMs` is the human-answer window: `AnswerWindow.open(view.promptTimeoutMs)` is opened inside `requestPermissionDecision`, i.e. AFTER an annotation phase would have had to finish. It denies on expiry. It cannot bound an annotator and must not be reused for it. | src/authority/permission-prompt-component.ts:111-128 ; src/authority/answer-window.ts:17-47 | source: read | excerpt: `const window = AnswerWindow.open(view.promptTimeoutMs);`

E29 | No other timing primitive exists to reuse; `setTimeout` appears only in answer-window.ts:25 and forwarding-io.ts:636 | src/** | source: grep (`rg -n "setTimeout|AbortSignal.timeout" src`) | excerpt: `this.timer = setTimeout(() => {`

## F. Where annotators run and the renderer

E30 | `LocalUserAuthorizer.present` is the single place a local/serving-node prompt is built: emit `permissions:ui_prompt` from `details`, then pass `details.payload` to `requestPermissionDecision`. It runs inside `dialogs.run(...)`. | src/authority/local-user-authorizer.ts:66-103 | source: read | excerpt: `emitUiPromptEvent(this.deps.events, buildUiPrompt(details));` / `details.payload,`

E31 | `selectAuthorizer` builds `LocalUserAuthorizer` from `AuthorizerSelectionDeps`; that is the only construction site in `src` | src/authority/authorizer.ts:182-196 ; src/authority/authorizer.ts:114-137 (deps interface) | source: read + grep (`rg -n "new LocalUserAuthorizer\(" src`) | excerpt: `terminal: new LocalUserAuthorizer({`

E32 | `ParentAuthorizer` ships the payload over the wire for the serving node to render under ITS budget; a relaying node has no `LocalUserAuthorizer` | src/authority/authorizer.ts:74-76, 164-166, 199-201 | source: read | excerpt: `\`ParentAuthorizer\` ships \`payload\` over the wire so the serving node renders it under its own budget.`

E33 | `renderPromptDialog` builds core + evidence facts, one `layout(...)` call, then `fitToRows(core, evidenceBlocks, maxRows)`; it never reads `annotations` | src/presentation/dialog-renderer.ts:23-52 | source: read | excerpt: `const blocks = layout(` / `[...core, ...evidence],` / `flaggedElements(payload),`

E34 | `fitToRows` exempts the core and drops evidence blocks from the TAIL whole-or-not-at-all, then appends the elision marker; blocks appended after evidence therefore give way first | src/presentation/dialog-renderer.ts:166-199 | source: read | excerpt: `// An entry is shown whole or not at all: half a path is worse evidence`

E35 | `layout` aligns labels across the facts it is given and paints the flagged element (the rule's value) with the warning paint | src/presentation/dialog-renderer.ts:295-316 ; src/presentation/fact-vocabulary.ts:28-33 | source: read | excerpt: `const width = Math.max(0, ...facts.map((fact) => fact.label.length));`

E36 | `capField` is the uniform per-field width cap (`fieldMaxWidth`); `clipped` feeds `DialogView.elided` | src/presentation/dialog-renderer.ts:147-157 | source: read | excerpt: `text: \`${fact.text.slice(0, fieldMaxWidth)}\u2026\`,`

E37 | Both human surfaces render through `renderPromptDialog`: the `ctx.ui.custom` dialog (per frame) and the `ui.select` fallback (once, width 80). Fallback message is `${title}\n${message}`. | src/authority/permission-prompt-component.ts:169-190, 382-396 ; src/authority/permission-dialog.ts:186-190 | source: read | excerpt: `\`${title}\n${message}\`,`

E38 | `fitLinesToWidth` wraps with the ANSI-aware `wrapTextWithAnsi`, so an escape sequence in a rendered string reaches the terminal. No sanitizer for evidence or annotation text exists in `src`. | src/presentation/line-fitting.ts:1-30 | source: read + grep (`rg -n "sanitiz|stripAnsi" src`) | excerpt: `wrapTextWithAnsi(line, width).map((wrapped) =>`

## G. Trust boundary: the wire

E39 | `buildForwardedAskPayload` spreads the CHILD's payload (`...request.payload`), overriding only `request.requester`. A child's `annotations` therefore pass to the serving node's dialog untouched. With the slot rendered, a child could spoof an annotation attributed to any `source`. Sole caller: forwarded-request-server.ts:115. | src/presentation/forwarded-ask-payload.ts:29-33 ; src/authority/forwarded-request-server.ts:115 ; src/authority/forwarding-io.ts:546 | source: read + grep (`rg -n "buildForwardedAskPayload" src test`) | excerpt: `...request.payload,` / `request: { ...request.payload.request, requester },`

## H. Working-tree state

E40 | Another session has uncommitted edits in this package: `src/authority/permission-prompt-chrome.ts`, `test/authority/helpers/prompt-harness.ts`, `test/authority/permission-prompt-chrome.test.ts`, `test/authority/permission-prompt-render.test.ts`, new `test/authority/permission-prompt-fullscreen-fit.test.ts`; plus `docs/superpowers/plans/artifacts/ledger-permission-ask-buttons.md` and `packages/pi-ask-herdr/*`. This plan touches none of those. | git status | source: `git status --short` | excerpt: ` M packages/pi-permission-system/src/authority/permission-prompt-chrome.ts`

## I. Existing tests this plan must keep green or update

E41 | Two existing tests build annotation literals `{source, text}` that stop compiling once `marking` is required | test/presentation/review-log-renderer.test.ts:184 ; test/service/permission-ui-prompt.test.ts:96 | source: grep (`rg -n annotations test | grep -v "annotations: \[\]"`) | excerpt: `annotations: [{ source: "judge", text: "looks risky" }],`

E42 | Existing guards already cover two of the four non-dialog consumers: review log persists no annotations; the broadcast event has no `annotations` property. The agent-facing renderer has none. | test/presentation/review-log-renderer.test.ts:174-189 ; test/service/permission-ui-prompt.test.ts:76-127 | source: read | excerpt: `expect(event).not.toHaveProperty("annotations");`

E43 | Existing forwarded-payload test to extend: "escalates the child's own payload with the requester re-stamped as forwarded", via `escalateForwardedAsk({... payload})` | test/authority/forwarded-request-server.test.ts:103-122, 724-765 | source: read | excerpt: `const details = await escalateForwardedAsk({`

E44 | Fixtures: `makePromptPayload(overrides)` defaults `annotations: []`; `makeAuthorizerSelectionDeps` is the one `AuthorizerSelectionDeps` fixture; `LocalUserAuthorizer` tests build deps in a local `makeDeps()` (17 `new LocalUserAuthorizer(deps)` sites) | test/helpers/prompt-details-fixtures.ts:49-72 ; test/helpers/authorizer-fixtures.ts:119-160 ; test/authority/local-user-authorizer.test.ts:70-103 | source: read | excerpt: `getForwardingTimeoutMs: overrides.getForwardingTimeoutMs ?? (() => 1000),`

E45 | Composition-root pattern to mirror for the end-to-end test: `describe("service and chain share one authorizer registry")`: `writeGlobalConfig({permission:{"*":"ask"}, authorizerChain:[...]})`, `makeFakePi`, `makeUiCtx(cwd, capturedTitles)` (select pushes the title+message), `fireSessionStart`, `getPermissionsService("ui-session")!.registerAuthorizer(...)`, `pi.fire("tool_call", ...)` | test/composition-root.test.ts:1202-1273 | source: read | excerpt: `getPermissionsService("ui-session")!.registerAuthorizer("typo-judge", () =>`

E46 | `vitest` `expectTypeOf` and `@ts-expect-error` are checked by `tsc` (tsconfig includes `test`), not at vitest runtime; `expectTypeOf` is already used in test/config/config-schema.test.ts:568-580 | test/config/config-schema.test.ts:568-580 ; tsconfig.json:12 | source: read | excerpt: `expectTypeOf<SchemaPermissionState>().toEqualTypeOf<PermissionState>();`

E47 | Repo rules the executor must follow: use `pnpm -C packages/<pkg> ...` (never `cd packages/<pkg>`, which a deny rule blocks); never `git commit -F` from a heredoc; Conventional Commits enforced by `committed`; pre-commit runs Biome, ESLint, rumdl; docs/decisions, docs/plans, docs/retro, docs/architecture, CHANGELOG.md are outside release scope | repo:AGENTS.md:Environment (Shell, Tooling, Releases) | source: read | excerpt: `Three prose tripwires are now \`pi-permission-system\` deny rules ... (\`rg -r\`, \`git commit -F\` from a heredoc, \`cd packages/<pkg>\`)`

## J. Docs and config plumbing facts

E48 | Base tsconfig target is ES2024, so `\p{Cc}`/`\p{Cf}` property escapes with the `u` flag compile | repo:tsconfig.base.json:3 | source: grep | excerpt: `"target": "ES2024",`

E49 | `UnifiedPermissionConfig` is derived from the Zod schema and re-exported by the loader, so a new schema field types `raw.<key>` in `normalizePermissionSystemConfig` with no second declaration | src/config/config-loader.ts:22,31 ; src/config/config-schema.ts:569-578 | source: read + grep | excerpt: `export type { ShellToolsConfig, UnifiedPermissionConfig };`

E50 | Doc insertion points: runtime-config table row after `authorizerChain` (docs/configuration.md:124); a new section before `## Policy Reference` (docs/configuration.md:403, after the authorizer-chain record table that ends ~392); a `#### registerAnnotator` section before `#### Subagent session registration` (docs/cross-extension-api.md:331). cross-extension-api.md has no `#### registerAuthorizer` heading (it is cross-referenced at :328 and :571-594). | docs/configuration.md:124,403 ; docs/cross-extension-api.md:328,331 | source: grep | excerpt: `There is deliberately **no** equivalent reader for \`registerAuthorizer\`.`

E51 | `PromptAnnotation` is a PUBLIC type: `service.ts` re-exports it (with `PromptPayload` etc.) and the packaged `dist/public.d.ts` is built by `build:types` and checked by `verify:public-types` (packs the tarball, bans `#src` in the declaration, type-checks a throwaway consumer). Adding `marking` to it and exporting `Annotator`/`AnnotatorInput` are public-surface changes. `ToolInputFormatter` and `Authorizer` are exported the same way. | src/service.ts:21-24, 46-58, 71 ; package.json:31,36 ; scripts/verify-public-types.sh:1-25 | source: read | excerpt: `export type {` / `DecidingPath,` / `PromptAnnotation,`

E52 | `new LocalPermissionsService(` has exactly three call sites: `src/index.ts:262` and two tests, both passing the five existing registries positionally and ending with `new AuthorizerRegistry()` / `authorizerRegistry`. A sixth required constructor parameter must be added at all three. | src/index.ts:262 ; test/service.test.ts:223-229 ; test/service/permissions-service.test.ts:105-130 | source: grep (`rg -n "new LocalPermissionsService" src test`) + read | excerpt: `new AuthorizerRegistry(),`

E53 | `ExtensionMode` is `"tui" | "rpc" | "json" | "print"`, so `mode: "rpc"` type-checks and takes the `ui.select` fallback (E37). `makeUiCtx(cwd, capturedTitles)` wraps `makeBaseCtx` with a `select` that pushes the title and returns `"Yes"`; `makeBaseCtx` sets no `mode`, so composition-root prompts use the fallback and the captured title carries the rendered message. | packages/pi-permission-system/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:232 ; test/composition-root.test.ts:151-201 | source: grep + read | excerpt: `export type ExtensionMode = "tui" | "rpc" | "json" | "print";`

## Assumptions

A1 | Default annotator deadline of 1500 ms. ADR 0011 §8 requires a bound but names no value. Chosen as a value an operator who opted in will accept as added latency before the prompt; configurable via `annotatorTimeoutMs`. Unverified against any real annotator. Also an open question in the plan.



