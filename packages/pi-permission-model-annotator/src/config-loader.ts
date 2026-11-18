/**
 * Layered config loader: global then project `config.json`, project overriding
 * global, validated once against the zod source of truth. The project layer is
 * read only when the project is trusted, so an untrusted repository cannot
 * choose the annotator's provider, model, or instructions.
 *
 * Fail-safe by construction: a malformed file is skipped with a recorded issue
 * (never fatal), and an invalid merged config yields `{ config: undefined }` so
 * the extension registers no annotator — a config error degrades to today's
 * unannotated prompt, never to a prompt that waits on a broken call.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MODEL_ANNOTATOR_EXTENSION_ID,
  type ModelAnnotatorConfig,
  modelAnnotatorConfigSchema,
} from "./config-schema";

const CONFIG_FILE_NAME = "config.json";

/** A validation or read problem, tied to the file that produced it. */
export interface ConfigIssue {
  path: string;
  message: string;
  sourcePath?: string;
}

/** Outcome of a config load: a validated config (or `undefined`) plus issues. */
export interface LoadConfigResult {
  config: ModelAnnotatorConfig | undefined;
  issues: ConfigIssue[];
  /** The project config file left unread because the project is untrusted; absent otherwise. */
  untrustedProjectConfigPath?: string;
}

/** Global scope: `<agentDir>/extensions/<id>/config.json`. */
export function getGlobalConfigPath(agentDir: string): string {
  return join(
    agentDir,
    "extensions",
    MODEL_ANNOTATOR_EXTENSION_ID,
    CONFIG_FILE_NAME,
  );
}

/** Project scope: `<cwd>/.pi/extensions/<id>/config.json`. */
export function getProjectConfigPath(cwd: string): string {
  return join(
    cwd,
    ".pi",
    "extensions",
    MODEL_ANNOTATOR_EXTENSION_ID,
    CONFIG_FILE_NAME,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read and JSON-parse a layer. Returns `undefined` when the file is absent;
 * records an issue and returns `undefined` when it is present but malformed.
 */
function readLayer(
  path: string,
  issues: ConfigIssue[],
): Record<string, unknown> | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!isRecord(parsed)) {
      issues.push({
        path: "$",
        message: "Expected a JSON object.",
        sourcePath: path,
      });
      return undefined;
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push({
      path: "$",
      message: `Failed to read config: ${message}`,
      sourcePath: path,
    });
    return undefined;
  }
}

/**
 * Load the merged, validated model-annotator config from the global and project
 * scopes.
 *
 * `projectTrusted` is required so a caller cannot fail open by omission: when it
 * is `false`, the project file is never read or parsed, and contributes neither
 * config nor issues.
 */
export function loadModelAnnotatorConfig(options: {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
}): LoadConfigResult {
  const { cwd, agentDir, projectTrusted } = options;
  const issues: ConfigIssue[] = [];

  const projectPath = getProjectConfigPath(cwd);
  const global = readLayer(getGlobalConfigPath(agentDir), issues);
  const project = projectTrusted ? readLayer(projectPath, issues) : undefined;
  // An existence check reads nothing from the untrusted project; it only lets
  // the caller say a config there was skipped rather than stay silent.
  const untrustedProjectConfigPath =
    !projectTrusted && existsSync(projectPath) ? projectPath : undefined;

  if (global === undefined && project === undefined) {
    return { config: undefined, issues, untrustedProjectConfigPath };
  }

  // Shallow merge: project scalars replace global wholesale.
  const merged = { ...(global ?? {}), ...(project ?? {}) };

  const parsed = modelAnnotatorConfigSchema.safeParse(merged);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        path: issue.path.join(".") || "$",
        message: issue.message,
        sourcePath: project !== undefined ? projectPath : undefined,
      });
    }
    return { config: undefined, issues, untrustedProjectConfigPath };
  }

  return { config: parsed.data, issues, untrustedProjectConfigPath };
}
