import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  askRowCap,
  borderRow,
  frame,
  hintRow,
  indentRows,
  optionRows,
} from "#src/authority/permission-prompt-chrome";
import { fakeTheme, strip } from "./helpers/prompt-harness";

describe("permission prompt chrome", () => {
  it("borderRow is an accent rule exactly as wide as the terminal", () => {
    expect(borderRow(fakeTheme, 12)).toBe(
      fakeTheme.fg("accent", "─".repeat(12)),
    );
  });

  it("frame stacks border, spacer, chip, spacer, body, spacer, border, spacer, hint", () => {
    const rows = frame(fakeTheme, 20, "Permission Required", ["BODY"], "HINT");
    expect(rows).toEqual([
      borderRow(fakeTheme, 20),
      "",
      ` ${fakeTheme.bg("selectedBg", " Permission Required ")}`,
      "",
      "BODY",
      "",
      borderRow(fakeTheme, 20),
      "",
      "HINT",
    ]);
  });

  it("indentRows shifts non-empty rows one column and leaves blank rows blank", () => {
    expect(indentRows(["a", "", "b"])).toEqual([" a", "", " b"]);
  });

  describe("optionRows", () => {
    it("marks the selected row with ❯, the bound key and accent+bold; others get a two-space gutter", () => {
      const rows = optionRows(
        fakeTheme,
        [
          { key: "y", label: "Yes", selected: false },
          { key: "n", label: "No", selected: true },
        ],
        40,
      );
      expect(rows).toEqual([
        "  y. Yes",
        fakeTheme.fg("accent", fakeTheme.bold("❯ n. No")),
      ]);
    });

    it("omits the key column when no row has a key (scope step)", () => {
      const rows = optionRows(
        fakeTheme,
        [{ label: "This subagent only", selected: true }],
        40,
      );
      expect(strip(rows[0] ?? "")).toBe("❯ This subagent only");
    });

    it("wraps a long label under its own text and styles every wrapped row when selected", () => {
      const rows = optionRows(
        fakeTheme,
        [
          {
            key: "s",
            label: "Yes, allow writes to /tmp/* for this session",
            selected: true,
          },
        ],
        20,
      );
      expect(rows.length).toBeGreaterThan(1);
      const stripped = rows.map(strip);
      expect(stripped[0]?.startsWith("❯ s. ")).toBe(true);
      for (const row of stripped.slice(1))
        expect(row.startsWith("     ")).toBe(true);
      for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(20);
      const styled =
        fakeTheme.fg("accent", fakeTheme.bold("X")).split("X")[0] ?? "";
      for (const row of rows) expect(row.startsWith(styled)).toBe(true);
    });
  });

  it("hintRow joins parts with · in dim, indented one column; warning variant for the armed hint", () => {
    expect(hintRow(fakeTheme, ["a", "b"])).toBe(
      ` ${fakeTheme.fg("dim", "a · b")}`,
    );
    expect(hintRow(fakeTheme, ["Press y again to approve."], "warning")).toBe(
      ` ${fakeTheme.fg("warning", "Press y again to approve.")}`,
    );
  });

  it("askRowCap leaves room for the frame and the option rows, never below the floor, never above the configured cap", () => {
    expect(askRowCap(24, 30, 4)).toBe(16); // 30 - 9 frame - 1 spacer - 4 options
    expect(askRowCap(24, 200, 4)).toBe(24);
    expect(askRowCap(24, 10, 4)).toBe(6);
  });
});
