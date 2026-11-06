import { MUSIC_GROUP_CLASS_IDS, MUSIC_OCCUPATION_IDS } from "./classes.js";
import { fetchCommonsImages, type CommonsImage } from "./commons.js";
import { WikidataMusiciansError, isQid } from "./errors.js";
import type { HttpOptions } from "./http.js";
import { MAX_SEARCH_LIMIT, getEntities, searchEntities, type Entity, type SearchHit } from "./wikidata.js";

export type Musician = {
  /** Wikidata item ID, `Q…`. The stable key. */
  qid: string;
  wikidataUrl: string;
  /** `person` when matched through an occupation (P106), `group` when matched through a class (P31). */
  kind: "person" | "group";
  /** The occupation or class item IDs that made the entity qualify. */
  matchedClassIds: string[];
  /** Label in the first requested language that has one, else the search label, else the QID. */
  name: string;
  /** Description in the first requested language that has one, else the search description, else null. */
  description: string | null;
  /** Labels and descriptions keyed by requested language; absent languages are simply missing. */
  labels: Record<string, string>;
  descriptions: Record<string, string>;
  /** A Commons portrait with complete attribution, or `null` (no image, or attribution incomplete). */
  image: CommonsImage | null;
};

export type ClientOptions = HttpOptions & {
  /**
   * Languages for labels and descriptions, in order of preference. Default `["en"]`. Also the
   * default search language. Wikidata language codes (`ja`, `en`, `de`, …).
   */
  languages?: readonly string[];
  /** Occupation item IDs that qualify a person, replacing the built-in list. */
  occupationIds?: Iterable<string>;
  /** Class item IDs that qualify a group, replacing the built-in list. */
  groupClassIds?: Iterable<string>;
  /** Whether to look up Commons images and attribution. Default true. */
  includeImages?: boolean;
  /** How long search and get results are reused, in milliseconds. Default 10 minutes; 0 disables. */
  cacheTtlMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
};

export type SearchOptions = {
  /** Search language; defaults to the client's first language. */
  language?: string;
  /** Raw search hits to consider before verification, 1–50. Default 10. */
  limit?: number;
};

export type WikidataMusiciansClient = {
  /** Searches labels and aliases, then keeps only verified musicians and groups, in search order. */
  search(query: string, options?: SearchOptions): Promise<Musician[]>;
  /** Fetches one item. Throws `not-found` for a missing item and `not-a-musician` for one that fails verification. */
  get(qid: string): Promise<Musician>;
  readonly languages: readonly string[];
};

export const DEFAULT_LANGUAGES: readonly string[] = ["en"];
export const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1_000;
export const DEFAULT_SEARCH_LIMIT = 10;
const MAX_QUERY_LENGTH = 300;
const LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

type Verdict = { kind: Musician["kind"]; matchedClassIds: string[] } | null;

function verify(entity: Entity, occupations: ReadonlySet<string>, groupClasses: ReadonlySet<string>): Verdict {
  const matchedOccupations = entity.occupations.filter((id) => occupations.has(id));
  if (matchedOccupations.length > 0) return { kind: "person", matchedClassIds: Array.from(new Set(matchedOccupations)) };
  const matchedClasses = entity.instanceOf.filter((id) => groupClasses.has(id));
  if (matchedClasses.length > 0) return { kind: "group", matchedClassIds: Array.from(new Set(matchedClasses)) };
  return null;
}

function pick(values: Record<string, string>, languages: readonly string[]): string | null {
  for (const language of languages) {
    const value = values[language];
    if (value) return value;
  }
  return null;
}

function toMusician(entity: Entity, verdict: NonNullable<Verdict>, hit: SearchHit | null, languages: readonly string[], image: CommonsImage | null): Musician {
  return {
    qid: entity.qid,
    wikidataUrl: `https://www.wikidata.org/wiki/${entity.qid}`,
    kind: verdict.kind,
    matchedClassIds: verdict.matchedClassIds,
    name: pick(entity.labels, languages) ?? hit?.label ?? entity.qid,
    description: pick(entity.descriptions, languages) ?? hit?.description ?? null,
    labels: entity.labels,
    descriptions: entity.descriptions,
    image,
  };
}

export function createWikidataMusiciansClient(options: ClientOptions = {}): WikidataMusiciansClient {
  const languages = (options.languages ?? DEFAULT_LANGUAGES).map((language) => language.trim()).filter(Boolean);
  if (languages.length === 0 || languages.some((language) => !LANGUAGE_CODE.test(language))) {
    throw new WikidataMusiciansError("invalid-input", { cause: new Error("languages must be non-empty Wikidata language codes") });
  }
  const occupations = new Set(options.occupationIds ?? MUSIC_OCCUPATION_IDS.keys());
  const groupClasses = new Set(options.groupClassIds ?? MUSIC_GROUP_CLASS_IDS.keys());
  const includeImages = options.includeImages ?? true;
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  const now = options.now ?? Date.now;
  const http: HttpOptions = {};
  if (options.fetcher) http.fetcher = options.fetcher;
  if (options.timeoutMs !== undefined) http.timeoutMs = options.timeoutMs;
  if (options.userAgent) http.userAgent = options.userAgent;

  const cache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();
  const remember = <T>(key: string, compute: () => Promise<T>): Promise<T> => {
    if (cacheTtlMs === 0) return compute();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.value as Promise<T>;
    const value = compute();
    cache.set(key, { expiresAt: now() + cacheTtlMs, value });
    value.catch(() => cache.delete(key)); // never cache a failure
    return value;
  };

  /** Verifies entities and attaches images; returns musicians in the order of `qids`. */
  const materialize = async (qids: readonly string[], hits: ReadonlyMap<string, SearchHit>): Promise<Map<string, Musician | "missing" | "rejected">> => {
    const entities = await getEntities(qids, languages, http);
    const verdicts = new Map<string, { entity: Entity; verdict: NonNullable<Verdict> }>();
    for (const qid of qids) {
      const entity = entities.get(qid);
      if (!entity) continue;
      const verdict = verify(entity, occupations, groupClasses);
      if (verdict) verdicts.set(qid, { entity, verdict });
    }
    const fileNames = includeImages ? Array.from(verdicts.values(), ({ entity }) => entity.imageFileName).filter((name): name is string => name !== null) : [];
    const images = fileNames.length > 0 ? await fetchCommonsImages(fileNames, http) : new Map<string, CommonsImage | null>();
    const result = new Map<string, Musician | "missing" | "rejected">();
    for (const qid of qids) {
      const verified = verdicts.get(qid);
      if (verified) {
        const image = verified.entity.imageFileName ? (images.get(verified.entity.imageFileName) ?? null) : null;
        result.set(qid, toMusician(verified.entity, verified.verdict, hits.get(qid) ?? null, languages, image));
      } else {
        result.set(qid, entities.get(qid) ? "rejected" : "missing");
      }
    }
    return result;
  };

  return {
    languages,
    search(query, searchOptions = {}) {
      const normalized = query.trim();
      const language = (searchOptions.language ?? languages[0] ?? "en").trim();
      const limit = Math.min(Math.max(1, Math.floor(searchOptions.limit ?? DEFAULT_SEARCH_LIMIT)), MAX_SEARCH_LIMIT);
      if (!normalized || normalized.length > MAX_QUERY_LENGTH || !LANGUAGE_CODE.test(language)) {
        return Promise.reject(new WikidataMusiciansError("invalid-input"));
      }
      return remember(`search:${language}:${limit}:${normalized.toLocaleLowerCase()}`, async () => {
        const hits = await searchEntities(normalized, language, limit, http);
        if (hits.length === 0) return [];
        const byQid = new Map(hits.map((hit) => [hit.qid, hit] as const));
        const materialized = await materialize(Array.from(byQid.keys()), byQid);
        return Array.from(byQid.keys()).flatMap((qid) => {
          const value = materialized.get(qid);
          return value && typeof value === "object" ? [value] : [];
        });
      });
    },
    get(qid) {
      const id = qid.trim();
      if (!isQid(id)) return Promise.reject(new WikidataMusiciansError("invalid-input"));
      return remember(`get:${id}`, async () => {
        const value = (await materialize([id], new Map())).get(id);
        if (value === "missing" || value === undefined) throw new WikidataMusiciansError("not-found");
        if (value === "rejected") throw new WikidataMusiciansError("not-a-musician");
        return value;
      });
    },
  };
}

/** One-off search without keeping a client around. */
export function searchMusicians(query: string, options: ClientOptions & SearchOptions = {}): Promise<Musician[]> {
  const { language, limit, ...clientOptions } = options;
  const searchOptions: SearchOptions = {};
  if (language !== undefined) searchOptions.language = language;
  if (limit !== undefined) searchOptions.limit = limit;
  return createWikidataMusiciansClient({ ...clientOptions, cacheTtlMs: 0 }).search(query, searchOptions);
}

/** One-off lookup without keeping a client around. */
export function getMusician(qid: string, options: ClientOptions = {}): Promise<Musician> {
  return createWikidataMusiciansClient({ ...options, cacheTtlMs: 0 }).get(qid);
}
