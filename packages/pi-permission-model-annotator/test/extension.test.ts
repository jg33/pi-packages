import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ANNOTATOR_NAME } from "#src/annotator";
import type { LoadConfigResult } from "#src/config-loader";
import type { ModelAnnotatorConfig } from "#src/config-schema";
import { createModelAnnotatorExtension } from "#src/index";

/** The service-shaped fake the mocked locator returns. */
interface ServiceLike {
  registerAnnotator: (name: string, annotator: unknown) => () => void;
}

const state = vi.hoisted(() => ({
  service: undefined as Partial<ServiceLike> | undefined,
  calls: [] as unknown[],
  lastSessionId: null as string | null,
}));

vi.mock("@gotgenes/pi-permission-system", () => ({
  PERMISSIONS_READY_CHANNEL: "permissions:ready",
  getPermissionsService: (sessionId: string) => {
    state.lastSessionId = sessionId;
    state.calls.push(sessionId);
    return state.service;
  },
}));

function makePi() {
  const handlers = new Map<
    string,
    Array<(event: unknown, ctx?: unknown) => void>
  >();
  const add = (
    event: string,
    handler: (event: unknown, ctx?: unknown) => void,
  ) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
  };
  const pi = {
    on: vi.fn(add),
    events: { on: vi.fn(add) },
  } as unknown as ExtensionAPI;
  return { pi, handlers };
}

function configResult(
  config: ModelAnnotatorConfig | undefined,
): LoadConfigResult {
  return { config, issues: [] };
}

const loadedConfig: ModelAnnotatorConfig = {
  provider: "anthropic",
  model: "m",
  instructions: "Explain the call.",
  timeoutMs: 4000,
  maxCharacters: 220,
  includeJevWeights: true,
};

function makeContext(trusted = true) {
  const notify = vi.fn();
  return {
    cwd: "/tmp/project",
    isProjectTrusted: () => trusted,
    modelRegistry: { find: () => ({ api: "anthropic-messages" }) },
    hasUI: true,
    ui: { notify },
  };
}

afterEach(() => {
  state.service = undefined;
  state.calls = [];
  state.lastSessionId = null;
  vi.restoreAllMocks();
});

describe("createModelAnnotatorExtension", () => {
  it("registers model-summary on the node that emitted the ready event", () => {
    const dispose = vi.fn();
    const registerAnnotator = vi.fn(() => dispose);
    state.service = { registerAnnotator };
    const { pi, handlers } = makePi();

    createModelAnnotatorExtension(pi, {
      loadConfig: () => configResult(loadedConfig),
    });
    handlers.get("session_start")?.[0]?.({}, makeContext());
    handlers.get("permissions:ready")?.[0]?.({ sessionId: "sess-1" });

    expect(state.lastSessionId).toBe("sess-1");
    expect(registerAnnotator).toHaveBeenCalledWith(
      ANNOTATOR_NAME,
      expect.any(Function),
    );
  });

  it("registers nothing when the session has no config", () => {
    const registerAnnotator = vi.fn();
    state.service = { registerAnnotator };
    const { pi, handlers } = makePi();

    createModelAnnotatorExtension(pi, {
      loadConfig: () => configResult(undefined),
    });
    handlers.get("session_start")?.[0]?.({}, makeContext());
    handlers.get("permissions:ready")?.[0]?.({ sessionId: "sess-1" });

    expect(registerAnnotator).not.toHaveBeenCalled();
  });

  it("is idempotent across repeated ready emissions", () => {
    const registerAnnotator = vi.fn(() => vi.fn());
    state.service = { registerAnnotator };
    const { pi, handlers } = makePi();

    createModelAnnotatorExtension(pi, {
      loadConfig: () => configResult(loadedConfig),
    });
    handlers.get("session_start")?.[0]?.({}, makeContext());
    const ready = handlers.get("permissions:ready")?.[0];
    ready?.({ sessionId: "sess-1" });
    ready?.({ sessionId: "sess-1" });

    expect(registerAnnotator).toHaveBeenCalledTimes(1);
  });

  it("warns once when the host exposes no permission service", () => {
    state.service = undefined;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { pi, handlers } = makePi();

    createModelAnnotatorExtension(pi, {
      loadConfig: () => configResult(loadedConfig),
    });
    handlers.get("session_start")?.[0]?.({}, makeContext());
    const ready = handlers.get("permissions:ready")?.[0];
    ready?.({ sessionId: "sess-1" });
    ready?.({ sessionId: "sess-1" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("no permission service");
  });

  it("warns once when the host predates the annotator seam", () => {
    state.service = {};
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { pi, handlers } = makePi();

    createModelAnnotatorExtension(pi, {
      loadConfig: () => configResult(loadedConfig),
    });
    handlers.get("session_start")?.[0]?.({}, makeContext());
    const ready = handlers.get("permissions:ready")?.[0];
    ready?.({ sessionId: "sess-1" });
    ready?.({ sessionId: "sess-1" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("no registerAnnotator seam");
  });

  it("disposes the registration on shutdown", () => {
    const dispose = vi.fn();
    state.service = { registerAnnotator: () => dispose };
    const { pi, handlers } = makePi();

    createModelAnnotatorExtension(pi, {
      loadConfig: () => configResult(loadedConfig),
    });
    handlers.get("session_start")?.[0]?.({}, makeContext());
    handlers.get("permissions:ready")?.[0]?.({ sessionId: "sess-1" });
    handlers.get("session_shutdown")?.[0]?.({});

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("notifies the operator about an untrusted project config and config issues", () => {
    const ctx = makeContext(false);
    const { pi, handlers } = makePi();

    createModelAnnotatorExtension(pi, {
      loadConfig: () => ({
        config: loadedConfig,
        issues: [{ path: "timeoutMs", message: "too small", sourcePath: "/x" }],
        untrustedProjectConfigPath: "/tmp/project/.pi/extensions/config.json",
      }),
    });
    handlers.get("session_start")?.[0]?.({}, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledTimes(2);
    expect(ctx.ui.notify.mock.calls[0]?.[0]).toContain("not trusted");
    expect(ctx.ui.notify.mock.calls[1]?.[0]).toContain("timeoutMs");
  });
});
