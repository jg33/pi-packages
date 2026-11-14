import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXTENSION_CONFIG,
  type PermissionSystemExtensionConfig,
} from "#src/config/extension-config";
import { PermissionSessionLogger } from "#src/logging/session-logger";
import { AnnotationRunner } from "#src/presentation/annotation-runner";
import { AnnotatorRegistry } from "#src/presentation/annotator-registry";
import { throwingAnnotator } from "#test/helpers/annotator-fixtures";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

/**
 * The runner's audit seam is a `PermissionSessionLogger`, not the raw writer.
 *
 * The raw writer *returns* an IO failure string instead of throwing, and
 * `AnnotationAuditLog.review` is typed `void`, so binding it would drop the
 * failure (and the audit record) silently. `PermissionSessionLogger` forwards it
 * through `reportOnce`, which latches one operator warning per message.
 */

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ps-annotator-logging-"));
});

/** A `globalLogsDir` that cannot be created: a file at the parent path blocks it. */
function makeBlockedLogsDir(): string {
  const barrier = join(tempDir, "barrier");
  writeFileSync(barrier, "");
  return join(barrier, "logs");
}

describe("AnnotationRunner bound to PermissionSessionLogger", () => {
  it("surfaces a failed review write once instead of dropping it silently", async () => {
    const notify = vi.fn<(message: string) => void>();
    const logger = new PermissionSessionLogger({
      globalLogsDir: makeBlockedLogsDir(),
      getConfig: (): PermissionSystemExtensionConfig => ({
        ...DEFAULT_EXTENSION_CONFIG,
      }),
      notify,
    });
    const registry = new AnnotatorRegistry();
    registry.register("bad", throwingAnnotator);
    const runner = new AnnotationRunner({
      registry,
      getChain: () => ["bad"],
      getTimeoutMs: () => 1000,
      log: logger,
    });

    const payload = makePromptPayload();
    await runner.annotate(payload, "req-1");
    await runner.annotate(payload, "req-2");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toContain("permission-system");
  });
});
