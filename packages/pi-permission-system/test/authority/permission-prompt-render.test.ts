import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  bashPayload,
  fakeTheme,
  KEY,
  mountPrompt,
  strip,
} from "./helpers/prompt-harness";

const NOW = { doublePressToConfirm: false } as const;
const border = (w: number) => fakeTheme.fg("accent", "─".repeat(w));
const flat = (lines: readonly string[]) =>
  strip(lines.join(" ")).replace(/\s+/g, " ");

describe("decision step — ask_user visual language", () => {
  it("is framed by accent borders and a header chip", () => {
    const lines = mountPrompt({ view: NOW }).render(120);
    expect(lines[0]).toBe(border(120));
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe(
      ` ${fakeTheme.bg("selectedBg", " Permission Required ")}`,
    );
    expect(lines[3]).toBe("");
    expect(lines.at(-3)).toBe(border(120));
    expect(lines.at(-2)).toBe("");
  });

  it("uses the subagent title for a forwarded ask", () => {
    const lines = mountPrompt({
      view: NOW,
      title: "Permission Required (Subagent)",
    }).render(120);
    expect(lines[2]).toContain("Permission Required (Subagent)");
  });

  it("marks the highlighted option with ❯ + bound key in accent+bold and indents the rest", () => {
    const lines = mountPrompt({ view: NOW }).render(120);
    expect(lines).toContain(fakeTheme.fg("accent", fakeTheme.bold("❯ y. Yes")));
    expect(lines).toContain("  s. Yes, for this session");
    expect(lines).toContain("  n. No");
    expect(lines).toContain("  r. No, provide reason");
    expect(strip(lines.join("\n"))).not.toContain("▶");
    expect(strip(lines.join("\n"))).not.toContain("(y)");
  });

  it("↓ moves the ❯", () => {
    const m = mountPrompt({ view: NOW });
    m.type(KEY.down);
    expect(m.render(120)).toContain(
      fakeTheme.fg("accent", fakeTheme.bold("❯ s. Yes, for this session")),
    );
  });

  it("offers the both-directions row only when the ask supplies its label", () => {
    const label = 'Yes, reads and writes to "/tmp/*"';
    expect(flat(mountPrompt({ view: NOW }).render(120))).not.toContain(label);
    expect(
      flat(
        mountPrompt({
          view: NOW,
          options: { sessionWidth: { label } },
        }).render(120),
      ),
    ).toContain(`b. ${label}`);
  });

  it("shows remapped keys in the key column", () => {
    const dialogKeys = {
      approve: "1",
      approveSession: "2",
      approveSessionBoth: "3",
      deny: "4",
      denyWithReason: "5",
    };
    const lines = mountPrompt({ view: { ...NOW, dialogKeys } }).render(120);
    expect(lines).toContain(fakeTheme.fg("accent", fakeTheme.bold("❯ 1. Yes")));
    expect(lines).toContain("  4. No");
  });

  it("hint: ask_user wording, dim, truthful about double-press", () => {
    const dim = (s: string) => ` ${fakeTheme.fg("dim", s)}`;
    expect(mountPrompt({ view: NOW }).render(120).at(-1)).toBe(
      dim(
        "Enter to select · ↑/↓ to navigate · Esc to deny · Press a key to choose",
      ),
    );
    expect(
      mountPrompt({ view: { doublePressToConfirm: true } })
        .render(120)
        .at(-1),
    ).toBe(
      dim(
        "Enter to select · ↑/↓ to navigate · Esc to deny · Press a key, then again to confirm",
      ),
    );
  });

  it("armed: the footer carries the confirm prompt in warning color", () => {
    const m = mountPrompt({ view: { doublePressToConfirm: true } });
    m.type("y");
    expect(m.render(120).at(-1)).toBe(
      ` ${fakeTheme.fg("warning", "Press y again to approve.")}`,
    );
  });

  it("the unanswered deadline is always visible, even on a narrow terminal", () => {
    const m = mountPrompt({ view: { promptTimeoutMs: 30_000 } });
    for (const width of [24, 40, 80]) {
      expect(flat(m.render(width))).toContain("denies in 30s");
    }
  });

  it("ctrl+o is advertised only when the render elided something", () => {
    expect(flat(mountPrompt({ view: NOW }).render(120))).not.toContain(
      "Ctrl+O",
    );
    const evidence = Array.from({ length: 60 }, (_, i) => ({
      label: `path ${i}`,
      text: `/p/${i}`,
      detail: null,
    }));
    const long = mountPrompt({
      view: NOW,
      payload: { ...bashPayload(), evidence },
    });
    expect(flat(long.render(120))).toContain("Ctrl+O for full request");
  });

  it("the expand key shows the complete request and never reaches the decision model", () => {
    const evidence = Array.from({ length: 60 }, (_, i) => ({
      label: `path ${i}`,
      text: `/p/${i}`,
      detail: null,
    }));
    const m = mountPrompt({
      view: NOW,
      expandKey: "\x0f",
      payload: { ...bashPayload(), evidence },
    });
    expect(flat(m.render(120))).not.toContain("/p/59");
    m.type("\x0f");
    expect(m.done).not.toHaveBeenCalled();
    expect(m.setToolsExpanded).toHaveBeenCalledTimes(1);
    const expanded = flat(m.render(120));
    expect(expanded).toContain("/p/59");
    expect(expanded).toContain("Ctrl+O to collapse");
    m.type("\x0f");
    expect(flat(m.render(120))).not.toContain("/p/59");
  });

  it("every row fits the terminal at any width", () => {
    const m = mountPrompt({
      view: { promptTimeoutMs: 30_000 },
      options: {
        sessionWidth: { label: "Yes, both directions for /tmp/*" },
      },
    });
    for (const width of [12, 20, 40, 80, 200]) {
      for (const line of m.render(width))
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it("still mounts inline", () => {
    expect(mountPrompt().custom).toHaveBeenCalledWith(expect.any(Function), {
      overlay: false,
    });
  });
});
