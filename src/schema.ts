import { z } from "zod";
import type { Musician } from "./client.js";
import { WikidataMusiciansError, type WikidataMusiciansErrorCode } from "./errors.js";

/** The JSON shape shared by the CLI (`--json`) and the MCP tools. Bump only for a breaking change. */
export const SCHEMA_VERSION = 1 as const;

export const commonsImageSchema = z.object({
  url: z.string().describe("Direct file URL on upload.wikimedia.org"),
  filePageUrl: z.string().describe("Commons file page; attribution must link here"),
  licenseName: z.string().describe("For example CC BY-SA 4.0"),
  licenseUrl: z.string(),
  artistCredit: z.string().describe("Author credit, markup stripped"),
});

export const musicianSchema = z.object({
  qid: z.string().describe("Wikidata item ID, the stable key"),
  wikidataUrl: z.string(),
  kind: z.enum(["person", "group"]),
  matchedClassIds: z.array(z.string()).describe("Occupation (P106) or class (P31) items that qualified the entity"),
  name: z.string().describe("Label in the first requested language that has one"),
  description: z.string().nullable(),
  labels: z.record(z.string(), z.string()).describe("Labels keyed by language"),
  descriptions: z.record(z.string(), z.string()).describe("Descriptions keyed by language"),
  image: commonsImageSchema.nullable().describe("Commons portrait with complete attribution, or null"),
});

export const errorCodeSchema = z.enum(["invalid-input", "not-found", "not-a-musician", "unavailable"]);

export const searchResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  ok: z.literal(true),
  query: z.string(),
  language: z.string(),
  musicians: z.array(musicianSchema),
});

export const getResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  ok: z.literal(true),
  qid: z.string(),
  musician: musicianSchema,
});

export const failureSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  ok: z.literal(false),
  input: z.string(),
  error: z.object({ code: errorCodeSchema, message: z.string() }),
});

export type SearchResult = z.infer<typeof searchResultSchema>;
export type GetResult = z.infer<typeof getResultSchema>;
export type Failure = z.infer<typeof failureSchema>;
export type Output = SearchResult | GetResult | Failure;

export const errorMessages: Record<WikidataMusiciansErrorCode, string> = {
  "invalid-input": "Empty or over-long query, malformed QID, or unknown language code. No request was made.",
  "not-found": "No Wikidata item with that QID.",
  "not-a-musician": "The item exists but has no direct musical occupation (P106) or musical-group class (P31).",
  "unavailable": "Wikidata or Wikimedia Commons could not be reached, timed out, or returned an error.",
};

export function toSearchResult(query: string, language: string, musicians: Musician[]): SearchResult {
  return { schemaVersion: SCHEMA_VERSION, ok: true, query, language, musicians };
}

export function toGetResult(qid: string, musician: Musician): GetResult {
  return { schemaVersion: SCHEMA_VERSION, ok: true, qid, musician };
}

/** Maps any thrown value to a failure record; non-package errors become `unavailable`. */
export function toFailure(input: string, error: unknown): Failure {
  const code: WikidataMusiciansErrorCode = error instanceof WikidataMusiciansError ? error.code : "unavailable";
  return { schemaVersion: SCHEMA_VERSION, ok: false, input, error: { code, message: errorMessages[code] } };
}
