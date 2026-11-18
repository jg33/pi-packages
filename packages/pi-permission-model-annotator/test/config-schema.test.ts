import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildModelAnnotatorJsonSchema,
  DEFAULT_INSTRUCTIONS,
  MAX_ANNOTATION_CHARACTERS,
  modelAnnotatorConfigSchema,
} from "#src/config-schema";

const here = dirname(fileURLToPath(import.meta.url));

describe("modelAnnotatorConfigSchema", () => {
  it("requires a provider and a model", () => {
    expect(modelAnnotatorConfigSchema.safeParse({}).success).toBe(false);
    expect(
      modelAnnotatorConfigSchema.safeParse({ provider: "", model: "m" })
        .success,
    ).toBe(false);
  });

  it("supplies the documented defaults", () => {
    const parsed = modelAnnotatorConfigSchema.parse({
      provider: "p",
      model: "m",
    });
    expect(parsed.instructions).toBe(DEFAULT_INSTRUCTIONS);
    expect(parsed.timeoutMs).toBe(4000);
    expect(parsed.maxCharacters).toBe(220);
    expect(parsed.includeJevWeights).toBe(true);
  });

  it("refuses an annotation budget over the prompt row ceiling", () => {
    expect(
      modelAnnotatorConfigSchema.safeParse({
        provider: "p",
        model: "m",
        maxCharacters: MAX_ANNOTATION_CHARACTERS + 1,
      }).success,
    ).toBe(false);
  });

  it("keeps the committed JSON Schema in step with the zod source", () => {
    const committed = JSON.parse(
      readFileSync(
        join(here, "..", "schemas", "model-annotator.schema.json"),
        "utf-8",
      ),
    );
    expect(committed).toEqual(buildModelAnnotatorJsonSchema());
  });
});
