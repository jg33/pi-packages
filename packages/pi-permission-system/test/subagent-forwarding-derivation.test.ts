/**
 * Parent-session derivation and liveness-window alignment for the
 * subagent-forwarding extension — the child side pi-herdr-agents spawns
 * (no `PI_SUBAGENT_PARENT_SESSION` marker, but a `PI_SUBAGENT_ACTIVITY_FILE`
 * naming the dispatching session).
 *
 * Imports the extension's repo file directly (the `~/.pi/agent/extensions`
 * copy is a symlink to these same bytes), so the suite loads on a clone.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVING_HEARTBEAT_STALE_MS } from "#src/authority/forwarding-liveness";
import {
  createSessionLiveness,
  createSessionStartHandler,
  deriveParentSessionFromActivityFile,
} from "../../../../pi-subagent-forwarding/index";

afterEach(() => {
  vi.unstubAllEnvs();
});

const ORCHESTRATOR = "01a1cd2b-2b8d-746c-812e-3b73fb4065fd";
const ACTIVITY_FILE = `/Users/jesse/.pi/agent/sessions/--Users-jesse-Developer-repos--/artifacts/${ORCHESTRATOR}/subagent-activity/444d8844-7760-44d5-a0da-dca45f3e2e13.json`;

function makeChildEnv(): Record<string, string | undefined> {
  return {
    PI_SUBAGENT_NAME: "worker",
    PI_SUBAGENT_ACTIVITY_FILE: ACTIVITY_FILE,
  };
}

const CHILD_CTX = {
  hasUI: false,
  sessionManager: { getSessionId: () => "child-session" },
};

describe("deriveParentSessionFromActivityFile", () => {
  it("reads the dispatching session id out of a herdr activity path", () => {
    expect(deriveParentSessionFromActivityFile(makeChildEnv())).toBe(
      ORCHESTRATOR,
    );
  });

  it("returns null without an activity file", () => {
    expect(deriveParentSessionFromActivityFile({})).toBeNull();
  });

  it("returns null for paths without the artifacts/<uuid>/subagent-activity shape", () => {
    expect(
      deriveParentSessionFromActivityFile({
        PI_SUBAGENT_ACTIVITY_FILE: "/tmp/whatever.json",
      }),
    ).toBeNull();
    expect(
      deriveParentSessionFromActivityFile({
        PI_SUBAGENT_ACTIVITY_FILE:
          "/x/artifacts/not-a-session-id/subagent-activity/c.json",
      }),
    ).toBeNull();
  });
});

describe("createSessionStartHandler parent derivation", () => {
  it("names the serving orchestrator when no marker was inherited", () => {
    const env = makeChildEnv();
    createSessionStartHandler(env, (id) => id === ORCHESTRATOR)(
      {} as SessionStartEvent,
      CHILD_CTX,
    );
    expect(env.PI_SUBAGENT_PARENT_SESSION).toBe(ORCHESTRATOR);
  });

  it("writes nothing for a parent that is not serving (a dead target would strand the ask)", () => {
    const env = makeChildEnv();
    createSessionStartHandler(env, () => false)(
      {} as SessionStartEvent,
      CHILD_CTX,
    );
    expect(env.PI_SUBAGENT_PARENT_SESSION).toBeUndefined();
  });

  it("keeps a live inherited marker instead of the derived one", () => {
    const env = {
      ...makeChildEnv(),
      PI_SUBAGENT_PARENT_SESSION: "lead-live",
    };
    createSessionStartHandler(env, (id) => id === "lead-live")(
      {} as SessionStartEvent,
      CHILD_CTX,
    );
    expect(env.PI_SUBAGENT_PARENT_SESSION).toBe("lead-live");
  });
});

describe("createSessionLiveness follows the stamped permission-system window", () => {
  it("uses the record's staleAfterMs instead of its own hard-coded window", () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), "pps-liveness-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    const serving = path.join(
      agentDir,
      "sessions",
      "permission-forwarding",
      "serving",
    );
    mkdirSync(serving, { recursive: true });
    const age = SERVING_HEARTBEAT_STALE_MS + 1_000; // outside 5s, inside the old 10s
    const write = (sessionId: string, record: Record<string, unknown>) =>
      writeFileSync(
        path.join(serving, `${sessionId}.json`),
        JSON.stringify(record),
      );

    write("stamped-stale", {
      sessionId: "stamped-stale",
      updatedAt: Date.now() - age,
      staleAfterMs: SERVING_HEARTBEAT_STALE_MS,
    });
    write("unstamped-stale", {
      sessionId: "unstamped-stale",
      updatedAt: Date.now() - age,
    });
    write("stamped-fresh", {
      sessionId: "stamped-fresh",
      updatedAt: Date.now(),
      staleAfterMs: SERVING_HEARTBEAT_STALE_MS,
    });

    const isServing = createSessionLiveness();
    expect(isServing("stamped-stale")).toBe(false);
    // shortcut: migration fallback for records written before the stamp —
    // delete when every writer stamps.
    expect(isServing("unstamped-stale")).toBe(true);
    expect(isServing("stamped-fresh")).toBe(true);
  });
});
