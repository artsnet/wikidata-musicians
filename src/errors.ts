export type WikidataMusiciansErrorCode = "invalid-input" | "not-found" | "not-a-musician" | "unavailable";

export class WikidataMusiciansError extends Error {
  readonly code: WikidataMusiciansErrorCode;

  constructor(code: WikidataMusiciansErrorCode, options?: { cause?: unknown }) {
    super(`Wikidata musicians request failed: ${code}`, options);
    this.name = "WikidataMusiciansError";
    this.code = code;
  }
}

export const QID_PATTERN = /^Q[1-9]\d{0,15}$/;

export function isQid(value: string): boolean {
  return QID_PATTERN.test(value);
}
