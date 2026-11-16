import type { Component } from "@earendil-works/pi-tui";
import { vi } from "vitest";
import type { RequestPermissionOptions } from "#src/authority/permission-dialog";
import {
  type PermissionPromptView,
  requestPermissionDecision,
} from "#src/authority/permission-prompt-component";
import { DEFAULT_DIALOG_KEYS } from "#src/config/dialog-keys";
import { DEFAULT_RENDER_BUDGET } from "#src/presentation/dialog-renderer";
import type { PromptPayload } from "#src/presentation/prompt-payload";

export const KEY = {
  esc: "\x1b",
  enter: "\r",
  up: "\x1b[A",
  down: "\x1b[B",
} as const;

// Real SGR escapes, so visibleWidth() ignores styling and tests can assert on exact strings.
const COLORS: Record<string, number | undefined> = {
  accent: 36,
  dim: 90,
  muted: 37,
  warning: 33,
  error: 31,
  selectedBg: 44,
};
function color(name: string): number {
  const code = COLORS[name];
  if (code === undefined) {
    throw new Error(`fake theme: unexpected color "${name}"`); // catches typos / off-list colors (Global Constraint 4)
  }
  return code;
}
export const fakeTheme = {
  fg: (name: string, text: string) =>
    `\x1b[38;5;${color(name)}m${text}\x1b[39m`,
  bg: (name: string, text: string) =>
    `\x1b[48;5;${color(name)}m${text}\x1b[49m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};

export const strip = (text: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips SGR escapes
  text.replace(/\x1b\[[0-9;]*m/g, "");

export function bashPayload(command = "rm -rf /tmp/x"): PromptPayload {
  return {
    kind: "bash",
    request: {
      requester: { agentName: null, forwarded: false, sessionId: null },
      surface: "bash",
      toolName: "bash",
      invokedToolName: null,
      value: command,
      matchedPattern: "rm *",
      matchedSpelling: null,
      commandContext: null,
      executedUnit: null,
      decidingPath: null,
    },
    evidence: [],
    annotations: [],
  };
}

export function makeView(
  overrides: Partial<PermissionPromptView>,
  custom: ReturnType<typeof vi.fn>,
): PermissionPromptView {
  return {
    mode: "tui",
    ui: {
      custom,
      select: vi.fn(),
      input: vi.fn(),
      getToolsExpanded: () => false,
      setToolsExpanded: vi.fn(),
    } as unknown as PermissionPromptView["ui"],
    notice: { title: "pi", body: "Permission Required: bash" },
    doublePressToConfirm: true,
    budget: DEFAULT_RENDER_BUDGET,
    dialogKeys: DEFAULT_DIALOG_KEYS,
    promptNotifications: [],
    ...overrides,
  };
}

export interface MountOptions {
  view?: Partial<PermissionPromptView>;
  options?: RequestPermissionOptions;
  payload?: PromptPayload;
  title?: string;
  rows?: number;
  /** Keystroke the fake keybindings report as `app.tools.expand` (Pi's Ctrl+O); none by default. */
  expandKey?: string;
}

type Factory = (
  tui: unknown,
  theme: unknown,
  keybindings: unknown,
  done: (value: unknown) => void,
) => Component;

export function mountPrompt(opts: MountOptions = {}) {
  const write = vi.fn();
  const requestRender = vi.fn();
  const done = vi.fn();
  const mounted: { component?: Component } = {};
  let settle: (value: unknown) => void = () => {};
  const settled = new Promise<unknown>((resolve) => {
    settle = resolve;
  });
  let finished = false;
  const custom = vi.fn((factory: Factory, _options: unknown) => {
    mounted.component = factory(
      { terminal: { write, rows: opts.rows ?? 60 }, requestRender },
      fakeTheme,
      {
        matches: (data: string, action: string) =>
          opts.expandKey !== undefined &&
          action === "app.tools.expand" &&
          data === opts.expandKey,
      },
      (value: unknown) => {
        done(value);
        if (!finished) {
          finished = true; // the host's done() is idempotent
          settle(value);
        }
      },
    );
    return settled;
  });
  const view = makeView(opts.view ?? {}, custom);
  const decision = requestPermissionDecision(
    view,
    opts.title ?? "Permission Required",
    opts.payload ?? bashPayload(),
    opts.options,
  );
  const component = mounted.component;
  if (!component) {
    throw new Error("ui.custom was not called synchronously");
  }
  return {
    custom,
    component,
    done,
    write,
    requestRender,
    setToolsExpanded: view.ui.setToolsExpanded as ReturnType<typeof vi.fn>,
    decision,
    render: (width = 100) => component.render(width),
    screen: (width = 100) => component.render(width).map(strip),
    type(...keys: string[]) {
      for (const key of keys) component.handleInput?.(key);
    },
    typeText(text: string) {
      for (const char of text) component.handleInput?.(char);
    },
  };
}
