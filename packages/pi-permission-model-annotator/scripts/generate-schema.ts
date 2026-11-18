/**
 * Write the committed JSON Schema from the zod source. Run via `pnpm run
 * gen:schema`; the parity test fails when the file drifts.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildModelAnnotatorJsonSchema } from "../src/config-schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "schemas", "model-annotator.schema.json");
writeFileSync(
  target,
  `${JSON.stringify(buildModelAnnotatorJsonSchema(), null, 2)}\n`,
  "utf-8",
);
console.log(`wrote ${target}`);
