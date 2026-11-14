import { vi } from "vitest";
import type { Annotator } from "#src/presentation/annotator-registry";

/** A log double for the runner: a durable record and an operator warning. */
export function makeAnnotationLog() {
  return { review: vi.fn(), warn: vi.fn() };
}

/** The trivial fixture annotator: fixed text, never a model call. */
export function staticAnnotator(text: string): Annotator {
  return () => text;
}

/** Echoes the ask's decision-relevant value, so a test sees the annotator was handed the payload. */
export const echoAnnotator: Annotator = ({ payload }) =>
  `echo: ${payload.request.value}`;

/** Never answers: models an annotator whose model call hangs. */
export const hangingAnnotator: Annotator = () =>
  new Promise<string | undefined>(() => undefined);

/** Throws before returning a promise. */
export const throwingAnnotator: Annotator = () => {
  throw new Error("boom");
};

/** Rejects asynchronously. */
export const rejectingAnnotator: Annotator = () =>
  Promise.reject(new Error("boom"));
