/**
 * Test-only transform hook: Node 26's type stripping is strip-only mode, which
 * cannot erase TypeScript parameter properties (`constructor(private x)` in
 * src/ui.ts), and the upstream `--experimental-transform-types` flag this
 * package used to rely on no longer exists. The package already ships
 * `typescript` as a devDependency, so the test runner transpiles .ts with
 * `ts.transpileModule` (full transform) before Node executes it.
 *
 * Wired up by the `test` script: `node --import ./tests/typescript-transform-hooks.mjs --test tests/*.test.ts`
 */

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      const source = readFileSync(new URL(url), "utf8");
      const { outputText } = ts.transpileModule(source, {
        fileName: fileURLToPath(url),
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
