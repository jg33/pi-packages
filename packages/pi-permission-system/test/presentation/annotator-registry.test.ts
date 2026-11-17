import { describe, expect, it } from "vitest";
import { AnnotatorRegistry } from "#src/presentation/annotator-registry";
import {
  echoAnnotator,
  staticAnnotator,
} from "#test/helpers/annotator-fixtures";

describe("AnnotatorRegistry", () => {
  it("stores an annotator so get() returns it", () => {
    const registry = new AnnotatorRegistry();
    registry.register("echo", echoAnnotator);
    expect(registry.get("echo")).toBe(echoAnnotator);
  });

  it("returns undefined for a name nobody registered", () => {
    expect(new AnnotatorRegistry().get("ghost")).toBeUndefined();
  });

  it("returns a disposer that removes the annotator", () => {
    const registry = new AnnotatorRegistry();
    const dispose = registry.register("echo", echoAnnotator);
    dispose();
    expect(registry.get("echo")).toBeUndefined();
  });

  it("throws when a name is already registered", () => {
    const registry = new AnnotatorRegistry();
    registry.register("echo", echoAnnotator);
    expect(() => registry.register("echo", staticAnnotator("x"))).toThrow(
      "echo",
    );
  });

  it("keeps different names independent", () => {
    const registry = new AnnotatorRegistry();
    const a = staticAnnotator("a");
    const b = staticAnnotator("b");
    registry.register("a", a);
    registry.register("b", b);
    expect(registry.get("a")).toBe(a);
    expect(registry.get("b")).toBe(b);
  });

  it("does not let a stale disposer evict a later registration", () => {
    const registry = new AnnotatorRegistry();
    const first = staticAnnotator("first");
    const disposeFirst = registry.register("echo", first);
    disposeFirst();
    const second = staticAnnotator("second");
    registry.register("echo", second);
    disposeFirst();
    expect(registry.get("echo")).toBe(second);
  });
});
