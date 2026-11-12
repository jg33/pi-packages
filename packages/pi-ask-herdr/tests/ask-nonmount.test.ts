/**
 * Regression for the silent-cancel path in askBatchInTui (src/ui.ts):
 * `ctx.ui.custom` resolving falsy WITHOUT the wizard factory ever running is a
 * host/mode failure — print/RPC/MCP/ACP sessions bind `noOpUIContext`, whose
 * `custom` is `async () => undefined` — and must surface as a diagnosable
 * error. Only a falsy result AFTER the factory mounted (user pressed Escape)
 * may read as `{ answers: [], cancelled: true }`.
 *
 * Run (same runner as the other tests):
 *   node --import ./tests/typescript-transform-hooks.mjs --test tests/ask-nonmount.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { askBatchInTui } from "../src/ui.ts";
import type { AskParams } from "../src/types.ts";

const PARAMS: AskParams = {
  questions: [
    {
      question: "Pick a fruit",
      type: "select",
      options: ["Banana", "Orange"],
    },
  ],
};

test("a custom() that never mounts the factory is an error, not a cancel", async () => {
  // The noOpUIContext shape: no factory call, immediate undefined.
  const ctx: any = {
    mode: "rpc",
    hasUI: false,
    ui: { custom: async () => undefined },
  };

  await assert.rejects(
    () => askBatchInTui(PARAMS, ctx),
    (err: unknown) => {
      assert.ok(err instanceof Error, `expected an Error, got ${String(err)}`);
      assert.match(err.message, /could not be shown/);
      assert.match(err.message, /mode=rpc/, "message must carry ctx.mode");
      assert.match(err.message, /hasUI=false/, "message must carry ctx.hasUI");
      return true;
    },
    "never-mounted custom() must reject instead of returning cancelled: true",
  );
});

test("a falsy result after the factory mounted is still a user cancel", async () => {
  const ctx: any = {
    mode: "tui",
    hasUI: true,
    ui: {
      custom(factory: any) {
        return new Promise((resolve) => {
          // Mounting the wizard runs the factory (src/ui.ts), then Escape
          // resolves null — the real cancel path must stay silent.
          factory({ terminal: {} }, {}, {}, resolve);
          queueMicrotask(() => resolve(null));
        });
      },
    },
  };

  const details = await askBatchInTui(PARAMS, ctx);
  assert.equal(details.cancelled, true);
  assert.deepEqual(details.answers, []);
});
