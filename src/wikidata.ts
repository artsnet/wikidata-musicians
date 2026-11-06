import { WIKIDATA_API, asNonEmptyString, asRecord, fetchApiJson, type HttpOptions } from "./http.js";
import { isQid } from "./errors.js";

export type SearchHit = { qid: string; label: string; description: string | null };

export const MAX_SEARCH_LIMIT = 50;
const MAX_ENTITIES_PER_REQUEST = 50;

/** `wbsearchentities`: label and alias matching in one language. Returns raw hits, not yet verified as musicians. */
export async function searchEntities(query: string, language: string, limit: number, options: HttpOptions): Promise<SearchHit[]> {
  const body = await fetchApiJson(WIKIDATA_API, {
    action: "wbsearchentities",
    type: "item",
    language,
    uselang: language,
    limit: String(Math.min(Math.max(1, Math.floor(limit)), MAX_SEARCH_LIMIT)),
    search: query,
  }, options);
  const search = Array.isArray(body.search) ? body.search : [];
  return search.flatMap((item): SearchHit[] => {
    const record = asRecord(item);
    const qid = asNonEmptyString(record?.id);
    const label = asNonEmptyString(record?.label);
    if (!qid || !isQid(qid) || !label) return [];
    return [{ qid, label, description: asNonEmptyString(record?.description) }];
  });
}

export type Entity = {
  qid: string;
  labels: Record<string, string>;
  descriptions: Record<string, string>;
  /** Item IDs from direct P106 (occupation) statements. */
  occupations: string[];
  /** Item IDs from direct P31 (instance of) statements. */
  instanceOf: string[];
  /** First P18 (image) file name, if any. */
  imageFileName: string | null;
};

function claimItemIds(claims: Record<string, unknown> | null, property: string): string[] {
  const statements = claims?.[property];
  if (!Array.isArray(statements)) return [];
  return statements.flatMap((statement) => {
    const mainSnak = asRecord(asRecord(statement)?.mainsnak);
    const value = asRecord(asRecord(mainSnak?.datavalue)?.value);
    const id = asNonEmptyString(value?.id);
    return id ? [id] : [];
  });
}

function claimFirstString(claims: Record<string, unknown> | null, property: string): string | null {
  const statements = claims?.[property];
  if (!Array.isArray(statements)) return null;
  for (const statement of statements) {
    const mainSnak = asRecord(asRecord(statement)?.mainsnak);
    const value = asNonEmptyString(asRecord(mainSnak?.datavalue)?.value);
    if (value) return value;
  }
  return null;
}

function localizedValues(values: Record<string, unknown> | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [language, entry] of Object.entries(values ?? {})) {
    const value = asNonEmptyString(asRecord(entry)?.value);
    if (value) result[language] = value;
  }
  return result;
}

export function parseEntity(qid: string, raw: unknown): Entity | null {
  const record = asRecord(raw);
  if (!record || record.missing !== undefined) return null;
  const claims = asRecord(record.claims);
  return {
    qid,
    labels: localizedValues(asRecord(record.labels)),
    descriptions: localizedValues(asRecord(record.descriptions)),
    occupations: claimItemIds(claims, "P106"),
    instanceOf: claimItemIds(claims, "P31"),
    imageFileName: claimFirstString(claims, "P18"),
  };
}

/**
 * `wbgetentities` for up to 50 items per request, asking only for the labels and descriptions in
 * `languages` and for claims. Missing items map to `null`.
 */
export async function getEntities(qids: readonly string[], languages: readonly string[], options: HttpOptions): Promise<Map<string, Entity | null>> {
  const result = new Map<string, Entity | null>();
  const unique = Array.from(new Set(qids));
  for (let start = 0; start < unique.length; start += MAX_ENTITIES_PER_REQUEST) {
    const batch = unique.slice(start, start + MAX_ENTITIES_PER_REQUEST);
    const body = await fetchApiJson(WIKIDATA_API, {
      action: "wbgetentities",
      ids: batch.join("|"),
      props: "labels|descriptions|claims",
      languages: languages.join("|"),
    }, options);
    const entities = asRecord(body.entities);
    for (const qid of batch) result.set(qid, parseEntity(qid, entities?.[qid]));
  }
  return result;
}
