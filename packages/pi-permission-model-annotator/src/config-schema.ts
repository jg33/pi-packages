/**
 * The zod source of truth for the model-annotator extension config.
 *
 * The config carries the *model mechanism* half of ADR 0007's config split
 * (provider / model / instructions / timeout); the *chain policy* half
 * (`annotatorChain`, the prompt surfaces) lives in
 * `@gotgenes/pi-permission-system`. This package reads only what it uses.
 */

import { z } from "zod";

/** Extension id — the `extensions/<id>/config.json` path segment. */
export const MODEL_ANNOTATOR_EXTENSION_ID = "pi-permission-model-annotator";

/** Canonical URL of the published config JSON Schema (the root `$id`). */
export const MODEL_ANNOTATOR_SCHEMA_URL =
  "https://raw.githubusercontent.com/gotgenes/pi-packages/main/packages/pi-permission-model-annotator/schemas/model-annotator.schema.json";

/** Default per-annotation model-call budget, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 4000;

/** The annotation row's hard ceiling: the prompt row budget elides long text. */
export const MAX_ANNOTATION_CHARACTERS = 500;

/** Default rendered length, in characters — two short sentences. */
export const DEFAULT_MAX_CHARACTERS = 220;

/**
 * The default instructions. They ask for a description, never a verdict: an
 * annotation is advisory and structurally cannot decide the ask (ADR 0011 §8).
 */
export const DEFAULT_INSTRUCTIONS = [
  "You explain a pending tool call to a human who is deciding whether to allow it.",
  "In one or two short sentences, say what the call does and what it touches,",
  "using only the facts given. Say why it might need a human's attention when a",
  "matched rule or the scope makes that clear. Never recommend allowing or",
  "denying, never restate the whole command, and never invent a fact that is not",
  "in the request.",
].join(" ");

/**
 * Operator-owned config for the summarising prompt annotator.
 *
 * `provider` and `model` are required: installing the package and naming
 * `model-summary` in `annotatorChain` without a config registers nothing, so an
 * unconfigured install is inert rather than a source of prompt latency.
 */
export const modelAnnotatorConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  instructions: z.string().min(1).default(DEFAULT_INSTRUCTIONS),
  timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  maxCharacters: z
    .number()
    .int()
    .positive()
    .max(MAX_ANNOTATION_CHARACTERS)
    .default(DEFAULT_MAX_CHARACTERS),
  /**
   * Whether the jev auto-mode weights are appended to the annotation when the
   * ask's authorizer trail carries them. Absence always degrades to prose only.
   */
  includeJevWeights: z.boolean().default(true),
});

export type ModelAnnotatorConfig = z.infer<typeof modelAnnotatorConfigSchema>;

/**
 * Derive the published JSON Schema (Draft 2020-12) from the zod source, so an
 * editor can validate `config.json` against `$schema`. Regenerate the committed
 * file via `pnpm run gen:schema`; a parity test fails on drift.
 */
export function buildModelAnnotatorJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(modelAnnotatorConfigSchema, {
    target: "draft-2020-12",
    io: "input",
  });
  return { $schema, $id: MODEL_ANNOTATOR_SCHEMA_URL, ...rest };
}
