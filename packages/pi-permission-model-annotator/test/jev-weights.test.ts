import { describe, expect, it } from "vitest";

import {
  formatJevStatus,
  formatJevWeights,
  readJevVerdict,
} from "#src/jev-weights";

import { makePayload, withJevVerdict } from "#test/helpers/payload";

describe("readJevVerdict", () => {
  it("returns undefined when the trail carries no verdict", () => {
    expect(readJevVerdict(makePayload())).toBeUndefined();
  });

  it("reads a verdict that carries no weights, leaving weights empty", () => {
    const facts = readJevVerdict(
      withJevVerdict({
        requestId: "req-1",
        tool: "bash",
        status: "allowed",
        source: "engine",
        rationale: "The intent matches the command.",
      }),
    );
    expect(facts?.status).toBe("allowed");
    expect(facts?.source).toBe("engine");
    expect(facts?.weights).toEqual([]);
    expect(formatJevWeights(facts)).toBeUndefined();
  });

  it("reads probabilities and thresholds", () => {
    const facts = readJevVerdict(
      withJevVerdict({
        status: "allowed",
        source: "engine",
        probabilities: { write: 0.93, bash: 0.41 },
        thresholds: { write: 0.8, bash: 0.6 },
        decidingRule: "write",
      }),
    );
    expect(formatJevWeights(facts)).toBe(
      "write p=0.93 (t=0.80), bash p=0.41 (t=0.60)",
    );
  });

  it("puts the deciding rule first, then descending probability", () => {
    const facts = readJevVerdict(
      withJevVerdict({
        probabilities: { a: 0.91, b: 0.72, c: 0.99 },
        decidingRule: "b",
      }),
    );
    expect(facts?.weights.map((weight) => weight.ruleId)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("reads per-condition reports when no probabilities map is present", () => {
    const facts = readJevVerdict(
      withJevVerdict({
        conditions: [
          { ruleId: "one", probability: 0.66, threshold: 0.55 },
          { ruleId: "two", probability: 0.12, threshold: 0.9 },
        ],
      }),
    );
    expect(formatJevWeights(facts)).toBe(
      "one p=0.66 (t=0.55), two p=0.12 (t=0.90)",
    );
  });

  it("drops non-unit values instead of guessing at them", () => {
    const facts = readJevVerdict(
      withJevVerdict({
        probabilities: {
          good: 0.5,
          zero: 0,
          negative: -0.2,
          text: "0.9",
          nan: Number.NaN,
        },
        thresholds: { good: 2 },
      }),
    );
    expect(facts?.weights).toEqual([
      { ruleId: "good", probability: 0.5, threshold: undefined },
    ]);
  });

  it("sharpens a single weight to the documented form", () => {
    const facts = readJevVerdict(
      withJevVerdict({
        probabilities: { write: 0.93 },
        thresholds: { write: 0.8 },
      }),
    );
    expect(formatJevWeights(facts)).toBe("p=0.93 (t=0.80)");
  });

  it("bounds a wide policy to three rules", () => {
    const facts = readJevVerdict(
      withJevVerdict({
        probabilities: { a: 0.9, b: 0.8, c: 0.7, d: 0.6 },
      }),
    );
    expect(formatJevWeights(facts)?.match(/p=/g)).toHaveLength(3);
  });

  it("composes the status line from whichever halves the verdict carried", () => {
    expect(
      formatJevStatus({
        status: "allowed",
        source: "engine",
        rationale: null,
        decidingRule: null,
        weights: [],
      }),
    ).toBe("allowed via engine");
    expect(
      formatJevStatus({
        status: null,
        source: "engine",
        rationale: null,
        decidingRule: null,
        weights: [],
      }),
    ).toBe("engine");
    expect(formatJevStatus(undefined)).toBeNull();
  });
});
