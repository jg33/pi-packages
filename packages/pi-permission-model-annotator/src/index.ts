/**
 * Extension wiring: load the config at `session_start`, register the
 * `"model-summary"` annotator from the `permissions:ready` handler, and dispose
 * on shutdown.
 *
 * The ready event fires at least once per session and may repeat, and its latch
 * emission at the node's first `before_agent_start` runs after every extension's
 * `session_start` (ADR 0012 decision 3) — so the handler alone is a sufficient
 * registration site, needing only an idempotence guard. The event's `sessionId`
 * keys the service of the node that emitted it, which is the node whose prompt
 * surface runs the annotator.
 */

// `complete` lives on pi-ai's `compat` entrypoint from 0.84 on. Pi's extension
// loader maps the pi-ai *root* to that same compat module for extensions, so
// both spellings resolve to one object at runtime; naming it explicitly is what
// typechecks against the pinned SDK.
import { complete as realComplete } from "@earendil-works/pi-ai/compat";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  getPermissionsService,
  PERMISSIONS_READY_CHANNEL,
  type PermissionsReadyEvent,
} from "@gotgenes/pi-permission-system";

import {
  ANNOTATOR_NAME,
  createModelAnnotator,
  type PromptAnnotator,
} from "./annotator";
import {
  type LoadConfigResult,
  loadModelAnnotatorConfig,
} from "./config-loader";
import {
  MODEL_ANNOTATOR_EXTENSION_ID,
  type ModelAnnotatorConfig,
} from "./config-schema";
import type { CompleteFn, ModelRegistryLike } from "./summary";

/**
 * The registration seam this package publishes through. Declared structurally
 * because the permission-system types this package builds against predate the
 * annotator release; a host without it is reported once and registers nothing.
 */
interface AnnotatorRegistrationSeam {
  registerAnnotator(name: string, annotator: PromptAnnotator): () => void;
}

/** Injectable seams; production defaults read the filesystem and call the model. */
export interface ModelAnnotatorDependencies {
  loadConfig?: (cwd: string, projectTrusted: boolean) => LoadConfigResult;
  complete?: CompleteFn;
}

function warn(message: string): void {
  console.warn(attributed(message));
}

/** The session surface a `session_start` warning is delivered through. */
type WarningContext = Pick<ExtensionContext, "hasUI" | "ui">;

/**
 * Deliver a `session_start` warning where the operator will see it: a Pi
 * notification when the session has a UI, the console otherwise. Pi starts its
 * TUI before `session_start` and does not capture console output, so a raw
 * `console.warn` there lands under a live TUI.
 */
function reportWarning(ctx: WarningContext, message: string): void {
  const text = attributed(message);
  if (ctx.hasUI) {
    ctx.ui.notify(text, "warning");
    return;
  }
  console.warn(text);
}

/**
 * Shown when an untrusted project carries a model-annotator config, so the
 * global-only scope is never silent; worded after pi-permission-system's own
 * untrusted-project warning.
 */
function untrustedProjectMessage(path: string): string {
  return `project is not trusted — skipping its model-annotator config at ${path}. Only the global config applies; grant project trust to load it.`;
}

function attributed(message: string): string {
  return `[${MODEL_ANNOTATOR_EXTENSION_ID}] ${message}`;
}

export function createModelAnnotatorExtension(
  pi: ExtensionAPI,
  dependencies: ModelAnnotatorDependencies = {},
): void {
  // `getAgentDir()` is read here rather than hoisted out of the lambda so the
  // env read happens only on the production path, and only when a config is
  // actually loaded — it honors `PI_CODING_AGENT_DIR`, matching where
  // pi-permission-system looks for the same global scope.
  const loadConfig =
    dependencies.loadConfig ??
    ((cwd: string, projectTrusted: boolean) =>
      loadModelAnnotatorConfig({
        cwd,
        agentDir: getAgentDir(),
        projectTrusted,
      }));
  const complete: CompleteFn =
    dependencies.complete ??
    ((model, context, options) => realComplete(model, context, options));

  let config: ModelAnnotatorConfig | undefined;
  let registry: ModelRegistryLike | undefined;
  let dispose: (() => void) | undefined;
  let warnedUnresolvedService = false;
  let warnedMissingSeam = false;

  pi.on("session_start", (_event, ctx) => {
    // Pi resolves project trust before any extension's `session_start`, so
    // this is the final decision for the session.
    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted());
    config = result.config;
    registry = ctx.modelRegistry;
    if (result.untrustedProjectConfigPath !== undefined) {
      reportWarning(
        ctx,
        untrustedProjectMessage(result.untrustedProjectConfigPath),
      );
    }
    for (const issue of result.issues) {
      reportWarning(
        ctx,
        `config issue at ${issue.sourcePath ?? "(merged)"} — ${issue.path}: ${issue.message}`,
      );
    }
  });

  pi.events.on(PERMISSIONS_READY_CHANNEL, (data) => {
    // A repeat emission must be a no-op, and a session with no config of its
    // own registers nothing: that is the operator declining the annotator.
    if (dispose || !config) {
      return;
    }
    const sessionId = readySessionId(data);
    const service =
      sessionId === null ? undefined : getPermissionsService(sessionId);
    if (!service) {
      warnUnresolvedService();
      return;
    }
    const seam = service as unknown as Partial<AnnotatorRegistrationSeam>;
    if (typeof seam.registerAnnotator !== "function") {
      warnMissingSeam();
      return;
    }
    const annotator = createModelAnnotator({
      getConfig: () => config,
      getRegistry: () => registry,
      complete,
    });
    dispose = seam.registerAnnotator(ANNOTATOR_NAME, annotator);
  });

  pi.on("session_shutdown", () => {
    dispose?.();
    dispose = undefined;
    config = undefined;
    registry = undefined;
    warnedUnresolvedService = false;
    warnedMissingSeam = false;
  });

  /**
   * Report, once per session, that the link this session was configured for is
   * not registered — the vacancy would otherwise be visible only as the
   * absence of `model_annotator` entries in the review log.
   */
  function warnUnresolvedService(): void {
    if (warnedUnresolvedService) {
      return;
    }
    warnedUnresolvedService = true;
    warn(
      "this session's node published no permission service, so the model-summary annotator is not registered — @gotgenes/pi-permission-system must be loaded in the same session.",
    );
  }

  /**
   * Report, once per session, that the loaded permission system predates the
   * prompt-annotator seam — the alternative is silence.
   */
  function warnMissingSeam(): void {
    if (warnedMissingSeam) {
      return;
    }
    warnedMissingSeam = true;
    warn(
      "this @gotgenes/pi-permission-system build has no registerAnnotator seam, so the model-summary annotator is not registered. Upgrade to the release that ships prompt annotators.",
    );
  }
}

/** The payload's session id, or `null` for any shape that cannot key the locator. */
function readySessionId(data: unknown): string | null {
  const sessionId = (data as Partial<PermissionsReadyEvent> | undefined)
    ?.sessionId;
  return typeof sessionId === "string" ? sessionId : null;
}

/**
 * Entry point: register the model-summary annotator as a
 * pi-permission-system prompt annotator.
 */
export default function modelAnnotatorExtension(pi: ExtensionAPI): void {
  createModelAnnotatorExtension(pi);
}
