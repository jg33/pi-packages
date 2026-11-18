import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  getGlobalConfigPath,
  getProjectConfigPath,
  loadModelAnnotatorConfig,
} from "#src/config-loader";

function agentDirWith(config: unknown): string {
  const agentDir = mkdtempSync(join(tmpdir(), "model-annotator-"));
  const path = getGlobalConfigPath(agentDir);
  mkdirSync(join(agentDir, "extensions", "pi-permission-model-annotator"), {
    recursive: true,
  });
  writeFileSync(path, JSON.stringify(config), "utf-8");
  return agentDir;
}

const valid = { provider: "anthropic", model: "claude-haiku-4-5" };

describe("loadModelAnnotatorConfig", () => {
  it("loads and defaults the global config", () => {
    const result = loadModelAnnotatorConfig({
      cwd: tmpdir(),
      agentDir: agentDirWith(valid),
      projectTrusted: true,
    });
    expect(result.config?.provider).toBe("anthropic");
    expect(result.config?.timeoutMs).toBe(4000);
    expect(result.config?.maxCharacters).toBe(220);
    expect(result.config?.includeJevWeights).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("returns no config when neither layer exists", () => {
    const result = loadModelAnnotatorConfig({
      cwd: tmpdir(),
      agentDir: mkdtempSync(join(tmpdir(), "model-annotator-empty-")),
      projectTrusted: true,
    });
    expect(result.config).toBeUndefined();
    expect(result.issues).toEqual([]);
  });

  it("ignores an untrusted project's config and reports the path", () => {
    const cwd = mkdtempSync(join(tmpdir(), "model-annotator-project-"));
    const projectPath = getProjectConfigPath(cwd);
    mkdirSync(join(cwd, ".pi", "extensions", "pi-permission-model-annotator"), {
      recursive: true,
    });
    writeFileSync(
      projectPath,
      JSON.stringify({ provider: "evil", model: "evil" }),
      "utf-8",
    );

    const result = loadModelAnnotatorConfig({
      cwd,
      agentDir: mkdtempSync(join(tmpdir(), "model-annotator-empty-")),
      projectTrusted: false,
    });
    expect(result.config).toBeUndefined();
    expect(result.untrustedProjectConfigPath).toBe(projectPath);
  });

  it("lets a trusted project override the global layer", () => {
    const cwd = mkdtempSync(join(tmpdir(), "model-annotator-project-"));
    mkdirSync(join(cwd, ".pi", "extensions", "pi-permission-model-annotator"), {
      recursive: true,
    });
    writeFileSync(
      join(
        cwd,
        ".pi",
        "extensions",
        "pi-permission-model-annotator",
        "config.json",
      ),
      JSON.stringify({ provider: "local", model: "m" }),
      "utf-8",
    );
    const result = loadModelAnnotatorConfig({
      cwd,
      agentDir: agentDirWith(valid),
      projectTrusted: true,
    });
    expect(result.config?.provider).toBe("local");
  });

  it("skips a malformed file with an issue instead of throwing", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "model-annotator-bad-"));
    mkdirSync(join(agentDir, "extensions", "pi-permission-model-annotator"), {
      recursive: true,
    });
    writeFileSync(
      join(
        agentDir,
        "extensions",
        "pi-permission-model-annotator",
        "config.json",
      ),
      "{ not json",
      "utf-8",
    );
    const result = loadModelAnnotatorConfig({
      cwd: tmpdir(),
      agentDir,
      projectTrusted: true,
    });
    expect(result.config).toBeUndefined();
    expect(result.issues[0]?.message).toContain("Failed to read config");
  });

  it("returns no config for an invalid config, with the field named", () => {
    const result = loadModelAnnotatorConfig({
      cwd: tmpdir(),
      agentDir: agentDirWith({ provider: "", model: "m" }),
      projectTrusted: true,
    });
    expect(result.config).toBeUndefined();
    expect(result.issues[0]?.path).toBe("provider");
  });

  it("resolves both scope paths under the extension id", () => {
    expect(getGlobalConfigPath("/agent")).toBe(
      "/agent/extensions/pi-permission-model-annotator/config.json",
    );
    expect(getProjectConfigPath("/project")).toBe(
      "/project/.pi/extensions/pi-permission-model-annotator/config.json",
    );
  });
});
