/**
 * The jev auto-mode weights, read off the ask's authorizer trail.
 *
 * `pi-jev-auto-mode` writes one `jev_authorizer_verdict` review entry per ask
 * it judges. Its `status`/`source`/`rationale` have always been there; a
 * version that also forwards its engine `probabilities`/`thresholds`/
 * `conditions` lets this annotator show *why* the verdict landed in its band.
 *
 * Everything here is best-effort and read-only: a trail that carries no
 * verdict, no weights, or a malformed number yields `undefined` for that part.
 * Nothing is estimated, defaulted, or inferred — an absent weight is absent,
 * not zero.
 */

import type { PromptPayload } from "@gotgenes/pi-permission-system";

/** The review-log event `pi-jev-auto-mode` writes for one ask. */
export const JEV_VERDICT_EVENT = "jev_authorizer_verdict";

/** One review entry of the authorizer chain's trail, as the payload carries it. */
interface ReviewEntry {
  readonly event: string;
  readonly details?: Record<string, unknown>;
}

/** The payload's authorizer trail, when the host attaches one. */
function authorizerTrail(
  payload: PromptPayload,
): readonly ReviewEntry[] | undefined {
  const trail = (payload as { authorizerContext?: readonly ReviewEntry[] })
    .authorizerContext;
  return Array.isArray(trail) ? trail : undefined;
}

/** A probability or threshold: a finite number in (0, 1]. */
function unit(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
    ? value
    : undefined;
}

/** One rule's weight, with the threshold it was compared against when known. */
export interface JevWeight {
  readonly ruleId: string;
  readonly probability: number;
  readonly threshold: number | undefined;
}

/** The jev verdict facts for one ask; every field is independently optional. */
export interface JevVerdictFacts {
  readonly status: string | null;
  readonly source: string | null;
  readonly rationale: string | null;
  readonly decidingRule: string | null;
  readonly weights: readonly JevWeight[];
}

function stringField(
  details: Record<string, unknown>,
  key: string,
): string | null {
  const value = details[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Read a `Record<string, number>`-shaped field, dropping non-unit values. */
function unitRecord(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const parsed = unit(raw);
    if (parsed !== undefined) {
      out[key] = parsed;
    }
  }
  return out;
}

/**
 * The weights carried by the trail, ordered the way a human reads them: the
 * deciding rule first, then by descending probability.
 *
 * `conditions` (one report per asked rule) is accepted as a second source so
 * an emitter that forwards only the per-condition reports still works; the
 * top-level `probabilities` map wins when both are present.
 */
function readWeights(details: Record<string, unknown>): JevWeight[] {
  const probabilities = unitRecord(details.probabilities);
  const thresholds = unitRecord(details.thresholds);

  if (Object.keys(probabilities).length > 0) {
    return Object.entries(probabilities)
      .map(([ruleId, probability]) => ({
        ruleId,
        probability,
        threshold: thresholds[ruleId],
      }))
      .sort((a, b) => b.probability - a.probability);
  }

  const conditions = details.conditions;
  if (!Array.isArray(conditions)) {
    return [];
  }
  const fromConditions: JevWeight[] = [];
  for (const raw of conditions) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const condition = raw as Record<string, unknown>;
    const ruleId =
      typeof condition.ruleId === "string" ? condition.ruleId : null;
    const probability = unit(condition.probability);
    if (ruleId === null || probability === undefined) {
      continue;
    }
    fromConditions.push({
      ruleId,
      probability,
      threshold: unit(condition.threshold),
    });
  }
  return fromConditions.sort((a, b) => b.probability - a.probability);
}

/**
 * The jev verdict facts for this payload, or `undefined` when the trail carries
 * no verdict entry at all.
 *
 * A verdict with no weights still returns facts (`weights: []`): the status and
 * its attribution are worth showing, and the caller decides what to append.
 */
export function readJevVerdict(
  payload: PromptPayload,
): JevVerdictFacts | undefined {
  const entry = authorizerTrail(payload)?.find(
    (candidate) => candidate.event === JEV_VERDICT_EVENT,
  );
  if (entry === undefined) {
    return undefined;
  }
  const details = entry.details ?? {};
  const weights = readWeights(details);
  const decidingRule = stringField(details, "decidingRule");
  return {
    status: stringField(details, "status"),
    source: stringField(details, "source"),
    rationale: stringField(details, "rationale"),
    decidingRule,
    weights:
      decidingRule === null
        ? weights
        : [
            ...weights.filter((weight) => weight.ruleId === decidingRule),
            ...weights.filter((weight) => weight.ruleId !== decidingRule),
          ],
  };
}

/** Two decimal places, the precision the jev UI itself prints. */
function two(value: number): string {
  return value.toFixed(2);
}

/**
 * A compact, human-readable weights line — `p=0.93 (t=0.80)` for one rule,
 * `write p=0.93 (t=0.80), bash p=0.41 (t=0.60)` for several — or `undefined`
 * when the verdict carried no weights.
 *
 * Bounded at `maxEntries` rules, best first, so a wide policy cannot turn the
 * annotation into a table.
 */
export function formatJevWeights(
  facts: JevVerdictFacts | undefined,
  maxEntries = 3,
): string | undefined {
  if (facts === undefined || facts.weights.length === 0) {
    return undefined;
  }
  const shown = facts.weights.slice(0, maxEntries);
  const parts = shown.map((weight) =>
    weight.threshold === undefined
      ? `p=${two(weight.probability)}`
      : `p=${two(weight.probability)} (t=${two(weight.threshold)})`,
  );
  if (shown.length === 1) {
    return parts[0];
  }
  return shown
    .map((weight, index) => `${weight.ruleId} ${parts[index]}`)
    .join(", ");
}

/** `allowed via engine`, or whichever half the verdict carried; `null` if neither. */
export function formatJevStatus(
  facts: JevVerdictFacts | undefined,
): string | null {
  if (facts === undefined) {
    return null;
  }
  const { status, source } = facts;
  if (status !== null && source !== null) {
    return `${status} via ${source}`;
  }
  return status ?? source;
}
