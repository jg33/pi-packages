/**
 * The built-in prompt annotators (asks-parity plan item 5, D3: annotators, not
 * a new subsystem).
 *
 * Registered once at composition through the existing `registerAnnotator`
 * surface; each runs only when the operator names it in `annotatorChain` (the
 * opt-in activation model, as for every annotator).
 *
 * Two names rather than one, because they answer different questions and the
 * human reads them as different rows (#PPB-10):
 *
 * - `pending-command` — what this ask would run and why the prompt exists.
 * - `jev-verdict` — the verdict the authorizer chain already wrote for this ask
 *   (D4: read from the existing authorizer result, no new model call).
 *
 * Joined into one sentence the verdict trailed the explanation and read as part
 * of it; as its own annotated row it is what it is — the chain's decision.
 *
 * The `Annotator` return type is the wall of ADR 0011 §8: none of this can
 * decide anything.
 */
import type { Annotator } from "./annotator-registry";
import type { PromptPayload } from "./prompt-payload";

/** The name the operator puts in `annotatorChain` to activate this annotator. */
const NAME = "pending-command";

/** The name that activates the chain-verdict annotator. */
const VERDICT_NAME = "jev-verdict";

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

/** Register the built-in annotators. Called once by the extension factory. */
export function registerPendingCommandAnnotator(
  surface: AnnotatorRegistrationSurface,
): void {
  surface.registerAnnotator(NAME, createPendingCommandAnnotator());
  surface.registerAnnotator(VERDICT_NAME, createJevVerdictAnnotator());
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
    return parts.length === 0 ? undefined : parts.join("; ");
  };
}

function createJevVerdictAnnotator(): Annotator {
  return ({ payload }) => jevVerdict(payload);
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
    .join(" — ")
    .trim();
  // A verdict with no words is no verdict: an empty row would read as a fault.
  return line === "" ? undefined : line;
}
