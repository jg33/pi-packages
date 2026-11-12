/**
 * Program Status Protocol (OSC 7501) reporting for ask_user.
 *
 * While a question waits, the tool takes over Pi's root status record with a
 * `blocked` report so terminals that render program status (Rex, and any other
 * OSC 7501 host) show the prompt. Once the wizard closes, Pi's `working` state
 * is restored for the rest of the run.
 *
 * Reports go through Pi's terminal, which already negotiates OSC 7501 support
 * with the host (`PI_PROGRAM_STATUS=1` forces reporting), so nothing here parses
 * terminal replies. The status shape is declared locally and the terminal is
 * duck-typed, so the extension still loads against Pi builds whose `Terminal`
 * type predates `setProgramStatus`.
 *
 * Spec: https://www.superlogical.com/rex/docs/build/program-status
 */

export type ProgramStatusState = "idle" | "working" | "blocked" | "done" | "error" | "clear";
export type ProgramStatusKind = "permission" | "question" | "auth";

/** One OSC 7501 report for the root record. */
export interface ProgramStatus {
	state: ProgramStatusState;
	app?: string;
	kind?: ProgramStatusKind;
	message?: string;
}

type ProgramStatusTerminal = { setProgramStatus?: (status: ProgramStatus) => void };

const APP_NAME = "pi";

function singleLine(text: string | undefined): string {
	return (text ?? "").replace(/[\r\n]+/g, " ").trim();
}

function writeProgramStatus(terminal: unknown, status: ProgramStatus): void {
	const sink = terminal as ProgramStatusTerminal | undefined;
	if (typeof sink?.setProgramStatus !== "function") return;
	try {
		sink.setProgramStatus(status);
	} catch (err) {
		console.error("[pi-ask-herdr] failed to report terminal program status:", err);
	}
}

/** Report the pane as blocked on a question, using the first question as the message. */
export function reportAskBlocked(terminal: unknown, question: string | undefined): void {
	writeProgramStatus(terminal, {
		state: "blocked",
		app: APP_NAME,
		kind: "question",
		message: singleLine(question),
	});
}

/** Restore the state Pi reports while an agent run is in progress. */
export function restoreProgramStatus(terminal: unknown, sessionName?: string): void {
	writeProgramStatus(terminal, {
		state: "working",
		app: APP_NAME,
		message: singleLine(sessionName),
	});
}
