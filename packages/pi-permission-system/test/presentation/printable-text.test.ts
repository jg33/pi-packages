import { describe, expect, it } from "vitest";
import {
  annotationSourceLabel,
  sanitizeAnnotationText,
} from "#src/presentation/printable-text";

describe("sanitizeAnnotationText", () => {
  it("collapses a CRLF to one space and keeps one line", () => {
    expect(sanitizeAnnotationText("a\r\nb")).toBe("a b");
  });
});

describe("annotationSourceLabel", () => {
  it("collapses a CRLF to one space rather than two", () => {
    expect(annotationSourceLabel("ev\r\nname", 40)).toBe("ev name");
  });

  it("caps by code point, never splitting a surrogate pair", () => {
    // Two astral characters: slicing by UTF-16 unit at 1 would leave a lone
    // high surrogate, which renders as a replacement glyph.
    const label = annotationSourceLabel("\u{1F600}\u{1F600}", 1);
    expect(label).toBe("\u{1F600}\u2026");
    expect(Array.from(label)).toHaveLength(2);
  });

  it("leaves a label at the cap untouched", () => {
    expect(annotationSourceLabel("abcd", 4)).toBe("abcd");
  });
});
