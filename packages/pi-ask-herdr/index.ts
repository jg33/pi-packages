/**
 * pi-ask-herdr
 *
 * A Pi extension that adds an `ask_user` tool and integrates with Herdr.
 *
 * Vendored, locally patched copy of upstream npm:pi-ask-herdr (v0.3.0) — see
 * README.md for the divergence list; re-apply the patches after updating from
 * upstream. Patches: src/herdr-status.ts (new), src/ui.ts, src/tool.ts.
 *
 * Source modules live under `./src/`; this file is only the auto-discovered
 * entry point that Pi loads.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskuserTool } from "./src/tool.ts";

export default function askuserHerdr(pi: ExtensionAPI) {
	registerAskuserTool(pi);
}
