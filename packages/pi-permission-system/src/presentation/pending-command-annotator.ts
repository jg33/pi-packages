/**
 * The built-in prompt annotator (asks-parity plan item 5, D3: an annotator,
 * not a new subsystem).
 *
 * Registered once at composition through the existing `registerAnnotator`
 * surface; it runs only when the operator names `"pending-command"` in
 * `annotatorChain` (the opt-in activation model, as for every annotator).
 *
 * Its answer is advisory text — what this ask would run and why the prompt
 * exists — plus the jev-auto-mode verdict the chain already wrote for this ask
 * when the captured trail carried one (D4: read from the existing authorizer
 * result, no new model call). The `Annotator` return type is the wall of
 * ADR 0011 §8: none of this can decide anything.
 */
import type { Annotator } from "./annotator-registry";
import type { PromptPayload } from "./prompt-payload";

/** The name the operator puts in `annotatorChain` to activate this annotator. */
const NAME = "pending-command";

/**
 * pi-jev-auto-mode's per-ask review event — its own literal, matched exactly.
 * It is not a declared cross-package contract, so a rename degrades to no
 * verdict line rather than to a wrong one.
 */
const JEV_VERDICT_EVENT = "jev_authorizer_verdict";

/**
 * The registrar seam this package already publishes (`PermissionsService`).
 * Declared structurally so this presentation module does not depend on the
 * service layer for one method.
 */
interface AnnotatorRegistrationSurface {
  registerAnnotator(name: string, annotator: Annotator): () => void;
}

/** Register the one built-in annotator. Called once by the extension factory. */
export function registerPendingCommandAnnotator(
  surface: AnnotatorRegistrationSurface,
): void {
  surface.registerAnnotator(NAME, createPendingCommandAnnotator());
}

function createPendingCommandAnnotator(): Annotator {
  return ({ payload }) => {
    const parts: string[] = [];
    const { request } = payload;
    if (request.value !== "") {
      parts.push(
        `runs "${request.value}" via ${request.toolName ?? payload.kind}`,
      );
    }
    if (request.matchedPattern !== null) {
      parts.push(
        `rule "${request.matchedPattern}" matched on ${request.surface}`,
      );
    }
    const verdict = jevVerdict(payload);
    if (verdict !== undefined) {
      parts.push(verdict);
    }
    return parts.length === 0 ? undefined : parts.join("; ");
  };
}

/**
 * The jev-auto-mode verdict line from this ask's captured trail — `undefined`
 * when the trail is absent or carries no verdict for this ask.
 */
function jevVerdict(payload: PromptPayload): string | undefined {
  const entry = payload.authorizerContext?.find(
    (candidate) => candidate.event === JEV_VERDICT_EVENT,
  );
  const details = entry?.details;
  if (details === undefined) return undefined;
  const status = typeof details.status === "string" ? details.status : null;
  const source = typeof details.source === "string" ? details.source : null;
  const rationale =
    typeof details.rationale === "string" ? details.rationale : null;
  const judgement =
    status !== null && source !== null
      ? `${status} via ${source}`
      : (status ?? source);
  const line = [judgement, rationale]
    .filter((part): part is string => part !== null)
    .join(" — ");
  return line === "" ? undefined : `jev-auto-mode: ${line}`;
}
