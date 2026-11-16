/**
 * The per-ask authorizer review trail captured for the pending-command
 * annotator (asks-parity plan item 5, D4).
 *
 * A pass-through log the chain links are handed, keyed by this ask's details
 * object, and the payload-side attachment the terminal makes before it
 * annotates. Nothing here decides anything: it only moves review entries.
 */
import { describe, expect, it, vi } from "vitest";
import {
  authorizerContext,
  captureAuthorizerContext,
  withAuthorizerContext,
} from "#src/authority/authorizer-context";
import { isRenderablePayload } from "#src/presentation/prompt-payload";
import type { AuthorizerLog } from "#src/service";
import { makePromptDetails } from "#test/helpers/prompt-details-fixtures";

function makeLog(): AuthorizerLog {
  return { review: vi.fn(), debug: vi.fn() };
}

describe("captureAuthorizerContext", () => {
  it("forwards every review and debug call to the session log", () => {
    const base = makeLog();
    const details = makePromptDetails();
    const log = captureAuthorizerContext(details, base);

    log.review("jev_authorizer_verdict", { status: "deferred" });
    log.debug("jev_authorizer_out_of_domain", { tool: "bash" });

    expect(base.review).toHaveBeenCalledWith("jev_authorizer_verdict", {
      status: "deferred",
    });
    expect(base.debug).toHaveBeenCalledWith("jev_authorizer_out_of_domain", {
      tool: "bash",
    });
  });

  it("records this ask's review entries in order and leaves debug out", () => {
    const details = makePromptDetails();
    const log = captureAuthorizerContext(details, makeLog());

    log.debug("quiet", { tool: "bash" });
    log.review("first", { a: 1 });
    log.review("second");

    expect(authorizerContext(details)).toEqual([
      { event: "first", details: { a: 1 } },
      { event: "second" },
    ]);
  });

  it("keeps two asks' trails apart", () => {
    const askA = makePromptDetails({ requestId: "req-a" });
    const askB = makePromptDetails({ requestId: "req-b" });
    const logA = captureAuthorizerContext(askA, makeLog());
    captureAuthorizerContext(askB, makeLog());

    logA.review("only-for-a", { id: "a" });

    expect(authorizerContext(askA)).toEqual([
      { event: "only-for-a", details: { id: "a" } },
    ]);
    // askB was captured too, and its trail never saw askA's entry.
    expect(authorizerContext(askB)).toEqual([]);
  });
});

describe("withAuthorizerContext", () => {
  it("returns the gate's payload untouched when nothing was captured", () => {
    const details = makePromptDetails();

    expect(withAuthorizerContext(details.payload, details)).toBe(
      details.payload,
    );
  });

  it("returns the payload untouched when the trail captured no review entry", () => {
    const details = makePromptDetails();
    captureAuthorizerContext(details, makeLog());

    expect(withAuthorizerContext(details.payload, details)).toBe(
      details.payload,
    );
  });

  it("attaches the captured trail beside the gate's own facts", () => {
    const details = makePromptDetails();
    const log = captureAuthorizerContext(details, makeLog());
    log.review("jev_authorizer_verdict", { status: "deferred" });

    const carried = withAuthorizerContext(details.payload, details);

    // The facts keep their identity — isRenderablePayload's contract.
    expect(carried.request).toBe(details.payload.request);
    expect(carried.evidence).toBe(details.payload.evidence);
    expect(carried.annotations).toBe(details.payload.annotations);
    expect(carried.authorizerContext).toEqual([
      { event: "jev_authorizer_verdict", details: { status: "deferred" } },
    ]);
    expect(isRenderablePayload(carried, details.payload)).toBe(true);
  });
});
