import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_INSTRUCTIONS,
  DEFAULT_MAX_CHARACTERS,
  modelAnnotatorConfigSchema,
} from "#src/config-schema";
import { readJevVerdict } from "#src/jev-weights";
import { type CompleteFn, renderAskPrompt, summarize } from "#src/summary";

import { makePayload, withJevVerdict } from "#test/helpers/payload";

const config = modelAnnotatorConfigSchema.parse({
  provider: "anthropic",
  model: "claude-haiku-4-5",
});

const model = { api: "anthropic-messages" } as Model<any>;

function reply(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
  } as unknown as AssistantMessage;
}

describe("renderAskPrompt", () => {
  it("states the ask's own facts and never asks for a verdict", () => {
    const prompt = renderAskPrompt(makePayload(), undefined);
    expect(prompt).toContain("kind: bash");
    expect(prompt).toContain("request: npm run build");
    expect(prompt).toContain("matched rule: npm *");
    expect(prompt).toContain("requester: the main session");
    expect(prompt).toContain("Do not recommend allowing or denying.");
  });

  it("includes the jev weights when the trail carries them", () => {
    const payload = withJevVerdict({
      status: "allowed",
      source: "engine",
      probabilities: { write: 0.93 },
      thresholds: { write: 0.8 },
    });
    expect(renderAskPrompt(payload, readJevVerdict(payload))).toContain(
      "jev-auto-mode: allowed via engine — p=0.93 (t=0.80)",
    );
  });

  it("omits the jev line entirely when the trail has no weights", () => {
    const prompt = renderAskPrompt(
      withJevVerdict({ status: "deferred", source: "uncertain" }),
      {
        status: "deferred",
        source: "uncertain",
        rationale: null,
        decidingRule: null,
        weights: [],
      },
    );
    expect(prompt).toContain("jev-auto-mode: deferred via uncertain");
    expect(prompt).not.toContain("p=");
  });
});

describe("summarize", () => {
  it("returns the model's text, normalised and bounded", async () => {
    const complete: CompleteFn = vi.fn(async () =>
      reply("  Runs the build.\n\nIt writes to dist/ and may take a minute.  "),
    );
    const outcome = await summarize({
      config,
      model,
      complete,
      prompt: "prompt",
    });
    expect(outcome.text).toBe(
      "Runs the build. It writes to dist/ and may take a minute.",
    );
    expect(outcome.api).toBe("anthropic-messages");
  });

  it("cuts an over-long reply to the configured budget", async () => {
    const complete: CompleteFn = async () => reply("word ".repeat(200));
    const outcome = await summarize({
      config: { ...config, maxCharacters: 40 },
      model,
      complete,
      prompt: "prompt",
    });
    expect(outcome.text?.length).toBeLessThanOrEqual(40);
    expect(outcome.text?.endsWith("…")).toBe(true);
  });

  it("reports an empty reply instead of showing blank text", async () => {
    const outcome = await summarize({
      config,
      model,
      complete: async () => reply("   "),
      prompt: "prompt",
    });
    expect(outcome.text).toBeUndefined();
    expect(outcome.failure).toBe("empty-reply");
  });

  it("reports a throw as call-failed", async () => {
    const outcome = await summarize({
      config,
      model,
      complete: async () => {
        throw new Error("401");
      },
      prompt: "prompt",
    });
    expect(outcome.failure).toBe("call-failed");
  });

  it("aborts at its own timeout and reports it", async () => {
    const outcome = await summarize({
      config: { ...config, timeoutMs: 10 },
      model,
      complete: (_model, _context, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
      prompt: "prompt",
    });
    expect(outcome.text).toBeUndefined();
    expect(outcome.failure).toBe("timeout");
  });

  it("forwards the annotator's deadline to the call", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const pending = summarize({
      config: { ...config, timeoutMs: 10_000 },
      model,
      complete: (_model, _context, options) => {
        seen = options?.signal;
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        });
      },
      prompt: "prompt",
      signal: controller.signal,
    });
    controller.abort();
    const outcome = await pending;
    expect(seen?.aborted).toBe(true);
    expect(outcome.failure).toBe("timeout");
  });

  it("sends the configured instructions as the system prompt", async () => {
    let context: { systemPrompt?: string } | undefined;
    await summarize({
      config,
      model,
      complete: async (_model, sent) => {
        context = sent;
        return reply("ok");
      },
      prompt: "prompt",
    });
    expect(context?.systemPrompt).toBe(DEFAULT_INSTRUCTIONS);
    expect(DEFAULT_MAX_CHARACTERS).toBe(220);
  });
});
