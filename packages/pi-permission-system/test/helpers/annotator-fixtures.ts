import type { Annotator } from "#src/presentation/annotator-registry";

/** The trivial fixture annotator: fixed text, never a model call. */
export function staticAnnotator(text: string): Annotator {
  return () => text;
}

/** Echoes the ask's decision-relevant value, so a test sees the annotator was handed the payload. */
export const echoAnnotator: Annotator = ({ payload }) =>
  `echo: ${payload.request.value}`;
