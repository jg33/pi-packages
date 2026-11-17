/**
 * Direct unit tests for `isRenderablePayload`, the guard the local terminal uses
 * to decide whether an annotator's result can be rendered.
 *
 * Nothing here imports `LocalUserAuthorizer`: the contract is the payload's, so
 * a future refactor of the terminal must not be able to change what this file
 * asserts.
 */
import { describe, expect, it } from "vitest";
import {
  isRenderablePayload,
  MODEL_GENERATED,
  modelGeneratedAnnotation,
  type PromptPayload,
} from "#src/presentation/prompt-payload";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

/** A payload with one annotation: the shape a well-behaved annotator returns. */
function makeGate(): PromptPayload {
  return makePromptPayload({
    annotations: [modelGeneratedAnnotation("echo", "routine push")],
  });
}

/** A deep-equal but non-identical copy of any payload value (JSON-safe here). */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("isRenderablePayload", () => {
  it("accepts the gate's own payload, annotations included", () => {
    const gate = makeGate();
    expect(isRenderablePayload(gate, gate)).toBe(true);
  });

  it("accepts the gate's payload with the slot authored as a new array", () => {
    const gate = makeGate();
    const annotated = {
      ...gate,
      annotations: [modelGeneratedAnnotation("echo", "on time")],
    };
    expect(isRenderablePayload(annotated, gate)).toBe(true);
  });

  it("rejects a payload whose request is a deep-equal copy", () => {
    const gate = makeGate();
    const annotated = {
      ...gate,
      request: copy(gate.request),
      annotations: [],
    };
    expect(annotated.request).toEqual(gate.request);
    expect(annotated.request).not.toBe(gate.request);
    expect(isRenderablePayload(annotated, gate)).toBe(false);
  });

  it("rejects a payload whose evidence is a deep-equal copy", () => {
    const gate = makeGate();
    const annotated = {
      ...gate,
      evidence: copy(gate.evidence),
      annotations: [],
    };
    expect(annotated.evidence).toEqual(gate.evidence);
    expect(annotated.evidence).not.toBe(gate.evidence);
    expect(isRenderablePayload(annotated, gate)).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "not a payload"],
    ["a number", 42],
    ["an array", []],
  ])("rejects %s", (_label, value) => {
    expect(isRenderablePayload(value, makeGate())).toBe(false);
  });

  it("rejects an annotations slot that is not an array", () => {
    const gate = makeGate();
    expect(isRenderablePayload({ ...gate, annotations: "nope" }, gate)).toBe(
      false,
    );
    expect(isRenderablePayload({ ...gate, annotations: null }, gate)).toBe(
      false,
    );
    expect(isRenderablePayload({ ...gate, annotations: {} }, gate)).toBe(false);
  });

  it.each([
    ["no text", { source: "echo", marking: MODEL_GENERATED }],
    ["non-string text", { source: "echo", text: 42, marking: MODEL_GENERATED }],
    ["no source", { text: "hi", marking: MODEL_GENERATED }],
    ["non-string source", { source: 7, text: "hi", marking: MODEL_GENERATED }],
    ["no marking", { source: "echo", text: "hi" }],
    ["a foreign marking", { source: "echo", text: "hi", marking: "human" }],
    ["a null member", null],
    ["an undefined member", undefined],
  ])("rejects a member with %s", (_label, member) => {
    const gate = makeGate();
    expect(isRenderablePayload({ ...gate, annotations: [member] }, gate)).toBe(
      false,
    );
  });

  it.each([
    ["junk first", [null, modelGeneratedAnnotation("echo", "fine")]],
    ["junk last", [modelGeneratedAnnotation("echo", "fine"), null]],
  ])("rejects a mixed annotations array, %s", (_label, annotations) => {
    const gate = makeGate();
    expect(isRenderablePayload({ ...gate, annotations }, gate)).toBe(false);
  });

  it("accepts an empty annotations slot", () => {
    const gate = makeGate();
    expect(isRenderablePayload({ ...gate, annotations: [] }, gate)).toBe(true);
  });
});
