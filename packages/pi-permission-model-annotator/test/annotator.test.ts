import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import {
  ANNOTATOR_NAME,
  type AnnotatorLogLike,
  createModelAnnotator,
  DECISION_EVENT,
} from "#src/annotator";
import { modelAnnotatorConfigSchema } from "#src/config-schema";
import type { CompleteFn, ModelRegistryLike } from "#src/summary";

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

function makeLog() {
  const review = vi.fn();
  const log: AnnotatorLogLike = { review };
  return { log, review };
}

function makeRegistry(
  overrides: Partial<ModelRegistryLike> = {},
): ModelRegistryLike {
  return {
    find: () => model,
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
    ...overrides,
  };
}

function makeAnnotator(
  options: {
    config?: ReturnType<typeof modelAnnotatorConfigSchema.parse> | undefined;
    registry?: ModelRegistryLike | undefined;
    complete?: CompleteFn;
  } = {},
) {
  return createModelAnnotator({
    getConfig: () => ("config" in options ? options.config : config),
    getRegistry: () =>
      "registry" in options ? options.registry : makeRegistry(),
    complete:
      options.complete ?? (async () => reply("Runs npm's build script.")),
  });
}

describe("the model-summary annotator", () => {
  it("registers under the documented name", () => {
    expect(ANNOTATOR_NAME).toBe("model-summary");
  });

  it("declines with no config, without calling the model", async () => {
    const complete = vi.fn();
    const annotator = makeAnnotator({ config: undefined, complete });
    expect(
      await annotator({
        payload: makePayload(),
        signal: new AbortController().signal,
        requestId: "r1",
        log: makeLog().log,
      }),
    ).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns the model's summary as the annotation", async () => {
    const { log, review } = makeLog();
    const text = await makeAnnotator()({
      payload: makePayload(),
      signal: new AbortController().signal,
      requestId: "r1",
      log,
    });
    expect(text).toBe("Runs npm's build script.");
    expect(review).toHaveBeenCalledWith(
      DECISION_EVENT,
      expect.objectContaining({
        requestId: "r1",
        status: "annotated",
        modelCalled: true,
      }),
    );
  });

  it("records the length of the annotation, never its text", async () => {
    const { log, review } = makeLog();
    const text = await makeAnnotator()({
      payload: makePayload(),
      signal: new AbortController().signal,
      requestId: "r1",
      log,
    });
    const entry = review.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(entry.textLength).toBe(text?.length);
    expect(entry.text).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain("Runs npm");
  });

  it("appends the jev weights when the trail carries them", async () => {
    const payload = withJevVerdict({
      status: "allowed",
      source: "engine",
      probabilities: { write: 0.93 },
      thresholds: { write: 0.8 },
    });
    const text = await makeAnnotator()({
      payload,
      signal: new AbortController().signal,
      requestId: "r1",
      log: makeLog().log,
    });
    expect(text).toBe(
      "Runs npm's build script. — jev allowed via engine: p=0.93 (t=0.80)",
    );
  });

  it("shows prose alone when the verdict carries no weights", async () => {
    const payload = withJevVerdict({
      status: "deferred",
      source: "uncertain",
      rationale: "not sure",
    });
    const text = await makeAnnotator()({
      payload,
      signal: new AbortController().signal,
      requestId: "r1",
      log: makeLog().log,
    });
    expect(text).toBe("Runs npm's build script. — jev deferred via uncertain");
    expect(text).not.toContain("p=");
    expect(text).not.toContain("t=");
  });

  it("omits weights entirely when includeJevWeights is false", async () => {
    const payload = withJevVerdict({
      status: "allowed",
      source: "engine",
      probabilities: { write: 0.93 },
      thresholds: { write: 0.8 },
    });
    const text = await makeAnnotator({
      config: { ...config, includeJevWeights: false },
    })({
      payload,
      signal: new AbortController().signal,
      requestId: "r1",
      log: makeLog().log,
    });
    expect(text).toBe("Runs npm's build script. — jev allowed via engine");
  });

  it("falls back to a weights-only line when the model fails and weights exist", async () => {
    const payload = withJevVerdict({
      status: "deferred",
      source: "engine",
      probabilities: { write: 0.62 },
      thresholds: { write: 0.8 },
    });
    const { log, review } = makeLog();
    const text = await makeAnnotator({
      complete: async () => {
        throw new Error("down");
      },
    })({ payload, signal: new AbortController().signal, requestId: "r1", log });
    expect(text).toBe("jev-auto-mode: deferred via engine — p=0.62 (t=0.80)");
    expect(review).toHaveBeenCalledWith(
      DECISION_EVENT,
      expect.objectContaining({
        status: "fallback",
        reason: "call-failed",
        modelCalled: true,
      }),
    );
  });

  it("declines rather than inventing weights when the model fails and there are none", async () => {
    const text = await makeAnnotator({
      complete: async () => {
        throw new Error("down");
      },
    })({
      payload: makePayload(),
      signal: new AbortController().signal,
      requestId: "r1",
      log: makeLog().log,
    });
    expect(text).toBeUndefined();
  });

  it("records model-unresolved without calling the model", async () => {
    const complete = vi.fn();
    const { log, review } = makeLog();
    const text = await makeAnnotator({
      registry: makeRegistry({ find: () => undefined }),
      complete,
    })({
      payload: makePayload(),
      signal: new AbortController().signal,
      requestId: "r1",
      log,
    });
    expect(text).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
    expect(review).toHaveBeenCalledWith(
      DECISION_EVENT,
      expect.objectContaining({
        status: "fallback",
        reason: "model-unresolved",
        modelCalled: false,
      }),
    );
  });

  it("records auth-failed without calling the model", async () => {
    const complete = vi.fn();
    const { log, review } = makeLog();
    await makeAnnotator({
      registry: makeRegistry({
        getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }),
      }),
      complete,
    })({
      payload: makePayload(),
      signal: new AbortController().signal,
      requestId: "r1",
      log,
    });
    expect(complete).not.toHaveBeenCalled();
    expect(review).toHaveBeenCalledWith(
      DECISION_EVENT,
      expect.objectContaining({ reason: "auth-failed" }),
    );
  });

  it("records a timeout when the shared deadline aborts the call", async () => {
    const controller = new AbortController();
    const { log, review } = makeLog();
    const pending = makeAnnotator({
      complete: (_model, _context, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    })({
      payload: makePayload(),
      signal: controller.signal,
      requestId: "r1",
      log,
    });
    controller.abort();
    await pending;
    expect(review).toHaveBeenCalledWith(
      DECISION_EVENT,
      expect.objectContaining({ reason: "timeout" }),
    );
  });

  it("never throws when the review log itself throws", async () => {
    const log: AnnotatorLogLike = {
      review: () => {
        throw new Error("sink down");
      },
    };
    await expect(
      makeAnnotator()({
        payload: makePayload(),
        signal: new AbortController().signal,
        requestId: "r1",
        log,
      }),
    ).resolves.toBe("Runs npm's build script.");
  });

  it("works on a host that passes no audit seam at all", async () => {
    await expect(
      makeAnnotator()({
        payload: makePayload(),
        signal: new AbortController().signal,
      }),
    ).resolves.toBe("Runs npm's build script.");
  });
});
