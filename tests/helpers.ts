import { vi } from "vitest";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export type Call = { url: URL; init: RequestInit };

/** A fetch double that answers by MediaWiki `action` (and `titles` for Commons) and records every call. */
export function fakeWikimedia(handlers: { search?: (params: URLSearchParams) => unknown; entities?: (params: URLSearchParams) => unknown; commons?: (params: URLSearchParams) => unknown }) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, init: init ?? {} });
    const params = url.searchParams;
    const action = params.get("action");
    if (url.hostname === "www.wikidata.org" && action === "wbsearchentities") return jsonResponse(handlers.search?.(params) ?? { search: [] });
    if (url.hostname === "www.wikidata.org" && action === "wbgetentities") return jsonResponse(handlers.entities?.(params) ?? { entities: {} });
    if (url.hostname === "commons.wikimedia.org" && action === "query") return jsonResponse(handlers.commons?.(params) ?? { query: { pages: [] } });
    return new Response("unexpected", { status: 500 });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls, mock: fetcher };
}

export function entity(qid: string, overrides: { labels?: Record<string, string>; descriptions?: Record<string, string>; P106?: string[]; P31?: string[]; P18?: string } = {}) {
  const localized = (values: Record<string, string> | undefined) => Object.fromEntries(Object.entries(values ?? {}).map(([language, value]) => [language, { language, value }]));
  const item = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
  return {
    [qid]: {
      id: qid,
      labels: localized(overrides.labels),
      descriptions: localized(overrides.descriptions),
      claims: {
        ...(overrides.P106 ? { P106: overrides.P106.map(item) } : {}),
        ...(overrides.P31 ? { P31: overrides.P31.map(item) } : {}),
        ...(overrides.P18 ? { P18: [{ mainsnak: { datavalue: { value: overrides.P18 } } }] } : {}),
      },
    },
  };
}

export function commonsPage(title: string, extra: { url?: string; descriptionurl?: string; license?: boolean; artist?: boolean } = {}) {
  const extmetadata: Record<string, { value: string }> = {};
  if (extra.license ?? true) {
    extmetadata.LicenseShortName = { value: "CC BY-SA 4.0" };
    extmetadata.LicenseUrl = { value: "https://creativecommons.org/licenses/by-sa/4.0/" };
  }
  if (extra.artist ?? true) extmetadata.Artist = { value: '<a href="https://example.org/u">Example <b>Photographer</b></a>' };
  return {
    title,
    imageinfo: [{ url: extra.url ?? "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg", descriptionurl: extra.descriptionurl ?? `https://commons.wikimedia.org/wiki/${title.replace(/ /g, "_")}`, extmetadata }],
  };
}

export const singer = "Q177220";
export const band = "Q215380";
