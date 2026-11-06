import { WikidataMusiciansError } from "./errors.js";
import { VERSION } from "./version.js";

export const DEFAULT_USER_AGENT = `wikidata-musicians/${VERSION} (+https://github.com/artsnet/wikidata-musicians)`;
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Hosts this package will ever call. */
export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

export type HttpOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** GET a MediaWiki API endpoint and return the parsed JSON object; every failure becomes `unavailable`. */
export async function fetchApiJson(base: string, params: Record<string, string>, options: HttpOptions): Promise<Record<string, unknown>> {
  const fetcher = options.fetcher ?? fetch;
  const url = `${base}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json", "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WikidataMusiciansError("unavailable", { cause: error });
  }
  if (!response.ok) throw new WikidataMusiciansError("unavailable", { cause: new Error(`HTTP ${response.status} from ${base}`) });
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new WikidataMusiciansError("unavailable", { cause: error });
  }
  const record = asRecord(body);
  if (!record) throw new WikidataMusiciansError("unavailable", { cause: new Error(`Non-object JSON from ${base}`) });
  if (record.error) throw new WikidataMusiciansError("unavailable", { cause: new Error(`API error from ${base}: ${JSON.stringify(record.error)}`) });
  return record;
}
