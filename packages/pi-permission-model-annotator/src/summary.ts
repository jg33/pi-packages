/**
 * The model call: render the ask's facts (plus the jev weights when the trail
 * carries them) as one user turn, ask for a two-sentence explanation, and return
 * it as plain text.
 *
 * There is no tool forcing here, unlike `pi-permission-model-judge`: an
 * annotation is free text by contract, so nothing has to be parsed into a
 * verdict. The reply is normalised and length-bounded, and every failure mode —
 * timeout, abort, throw, empty reply — returns no text with a reason, never a
 * placeholder and never an exception.
 */

import type {
  AssistantMessage,
  Context,
  Model,
  ProviderHeaders,
  TextContent,
} from "@earendil-works/pi-ai";
import type { PromptPayload } from "@gotgenes/pi-permission-system";

import type { ModelAnnotatorConfig } from "./config-schema";
import {
  formatJevStatus,
  formatJevWeights,
  type JevVerdictFacts,
} from "./jev-weights";

/** Longest request value or evidence line the prompt carries. */
const MAX_FACT_CHARACTERS = 400;

/** Evidence entries shown to the model, best-first as the payload orders them. */
const MAX_EVIDENCE_ENTRIES = 3;

/**
 * The injected model-completion seam — structurally the `complete` export of
 * `@earendil-works/pi-ai`. Injected so tests substitute a fake.
 */
export type CompleteFn = (
  model: Model<any>,
  context: Context,
  options?: {
    signal?: AbortSignal;
    apiKey?: string;
    headers?: ProviderHeaders;
  },
) => Promise<AssistantMessage>;

/**
 * The auth resolved for a model call — structurally the `ResolvedRequestAuth`
 * of the core `ModelRegistry`, redeclared because that type is not re-exported
 * from `@earendil-works/pi-coding-agent`.
 */
export type ResolvedRequestAuth =
  | { ok: true; apiKey?: string; headers?: ProviderHeaders }
  | { ok: false; error: string };

/** The narrow model-registry projection the annotator needs (ISP). */
export interface ModelRegistryLike {
  find(provider: string, modelId: string): Model<any> | undefined;
  getApiKeyAndHeaders(model: Model<any>): Promise<ResolvedRequestAuth>;
}

/** Inputs for one summary. */
export interface SummaryInputs {
  config: ModelAnnotatorConfig;
  model: Model<any>;
  complete: CompleteFn;
  prompt: string;
  apiKey?: string;
  headers?: ProviderHeaders;
  /** The annotator's deadline: aborts the call and reports `timeout`. */
  signal?: AbortSignal;
}

/** Why a summary produced no text. */
export type SummaryFailure = "timeout" | "call-failed" | "empty-reply";

/** What one summary produced, with the bookkeeping the review log records. */
export interface SummaryOutcome {
  /** The rendered summary, present iff the call produced usable text. */
  text?: string;
  failure?: SummaryFailure;
  latencyMs: number;
  /** The `Model.api` the call was addressed to. */
  api: string;
}

/** Cut `text` to `max` characters, marking the cut with an ellipsis. */
function clip(text: string, max: number): string {
  const normalised = text.replace(/\s+/g, " ").trim();
  return normalised.length <= max
    ? normalised
    : `${normalised.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Concatenate the text parts of an assistant reply. */
function extractText(reply: AssistantMessage): string {
  return reply.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

/**
 * The user turn: the ask's own facts, never the assistant's reasoning (which is
 * not on the payload), plus the jev line when the trail carries one.
 */
export function renderAskPrompt(
  payload: PromptPayload,
  jev: JevVerdictFacts | undefined,
): string {
  const { request, evidence, kind } = payload;
  const lines = [
    "A human is about to answer this permission prompt:",
    "",
    `kind: ${kind}`,
    `tool: ${request.toolName ?? "(not tool-shaped)"}`,
  ];
  if (
    request.invokedToolName !== null &&
    request.invokedToolName !== request.toolName
  ) {
    lines.push(`invoked as: ${request.invokedToolName}`);
  }
  lines.push(`surface: ${request.surface}`);
  lines.push(`request: ${clip(request.value, MAX_FACT_CHARACTERS)}`);
  if (request.matchedPattern !== null) {
    lines.push(`matched rule: ${request.matchedPattern}`);
  }
  if (request.matchedSpelling !== null) {
    lines.push(
      `matched spelling: ${clip(request.matchedSpelling, MAX_FACT_CHARACTERS)}`,
    );
  }
  const requester =
    request.requester.agentName === null
      ? request.requester.forwarded
        ? "a forwarded subagent session"
        : "the main session"
      : `agent ${request.requester.agentName}`;
  lines.push(`requester: ${requester}`);

  for (const entry of evidence.slice(0, MAX_EVIDENCE_ENTRIES)) {
    lines.push(
      `evidence — ${entry.label}: ${clip(entry.text, MAX_FACT_CHARACTERS)}`,
    );
  }

  const status = formatJevStatus(jev);
  const weights = formatJevWeights(jev);
  if (status !== null) {
    lines.push(
      weights === undefined
        ? `jev-auto-mode: ${status}`
        : `jev-auto-mode: ${status} — ${weights}`,
    );
  }

  lines.push(
    "",
    "Explain in one or two sentences what this call does and what it touches. Do not recommend allowing or denying.",
  );
  return lines.join("\n");
}

/**
 * Ask the model for the summary. Never throws: an abort, a rejection, or an
 * empty reply yields no text plus the reason, so the caller can fall back and
 * audit why.
 */
export async function summarize(
  inputs: SummaryInputs,
): Promise<SummaryOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), inputs.config.timeoutMs);
  const forwardAbort = () => controller.abort();
  inputs.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (inputs.signal?.aborted === true) {
    controller.abort();
  }
  const startedAt = Date.now();
  const api = typeof inputs.model.api === "string" ? inputs.model.api : "";
  try {
    // A deadline that has already passed costs no call at all.
    if (controller.signal.aborted) {
      return {
        failure: "timeout",
        latencyMs: Date.now() - startedAt,
        api,
      };
    }
    const context: Context = {
      systemPrompt: inputs.config.instructions,
      messages: [
        {
          role: "user",
          content: inputs.prompt,
          timestamp: Date.now(),
        },
      ],
    };
    const reply = await inputs.complete(inputs.model, context, {
      signal: controller.signal,
      apiKey: inputs.apiKey,
      headers: inputs.headers,
    });
    const text = clip(extractText(reply), inputs.config.maxCharacters);
    return {
      ...(text === "" ? { failure: "empty-reply" as const } : { text }),
      latencyMs: Date.now() - startedAt,
      api,
    };
  } catch {
    return {
      failure: controller.signal.aborted ? "timeout" : "call-failed",
      latencyMs: Date.now() - startedAt,
      api,
    };
  } finally {
    clearTimeout(timer);
    inputs.signal?.removeEventListener("abort", forwardAbort);
  }
}
