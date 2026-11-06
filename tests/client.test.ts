import { describe, expect, it } from "vitest";
import { createWikidataMusiciansClient, getMusician, searchMusicians } from "../src/client.js";
import { WikidataMusiciansError } from "../src/errors.js";
import { DEFAULT_USER_AGENT } from "../src/http.js";
import { band, commonsPage, entity, fakeWikimedia, singer } from "./helpers.js";

const fullImage = {
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg",
  filePageUrl: "https://commons.wikimedia.org/wiki/File:Example_Performer.webp",
  licenseName: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  artistCredit: "Example Photographer",
};

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WikidataMusiciansError) return error.code;
    throw error;
  }
  throw new Error("expected a failure");
}

describe("search", () => {
  it("verifies hits in one entity request, attaches attributed images, and keeps search order", async () => {
    const wiki = fakeWikimedia({
      search: () => ({ search: [{ id: "Q1", label: "Example Performer", description: "Japanese singer" }, { id: "Q2", label: "Not music" }, { id: "Q3", label: "Example Band" }] }),
      entities: (params) => {
        expect(params.get("ids")).toBe("Q1|Q2|Q3");
        expect(params.get("languages")).toBe("ja|en");
        expect(params.get("props")).toBe("labels|descriptions|claims");
        return {
          entities: {
            ...entity("Q1", { labels: { ja: "サンプル演奏家", en: "Example Performer" }, descriptions: { ja: "日本の歌手", en: "Japanese singer" }, P106: [singer], P18: "Example Performer.webp" }),
            ...entity("Q2", { labels: { en: "Not music" }, P106: ["Q82955"] }),
            ...entity("Q3", { labels: { en: "Example Band" }, P31: [band] }),
          },
        };
      },
      commons: (params) => {
        expect(params.get("titles")).toBe("File:Example Performer.webp");
        return { query: { pages: [commonsPage("File:Example Performer.webp")] } };
      },
    });
    const client = createWikidataMusiciansClient({ fetcher: wiki.fetcher, languages: ["ja", "en"], userAgent: "Test/1.0 (test@example.com)" });

    await expect(client.search("Example")).resolves.toEqual([
      {
        qid: "Q1",
        wikidataUrl: "https://www.wikidata.org/wiki/Q1",
        kind: "person",
        matchedClassIds: [singer],
        name: "サンプル演奏家",
        description: "日本の歌手",
        labels: { ja: "サンプル演奏家", en: "Example Performer" },
        descriptions: { ja: "日本の歌手", en: "Japanese singer" },
        image: fullImage,
      },
      {
        qid: "Q3",
        wikidataUrl: "https://www.wikidata.org/wiki/Q3",
        kind: "group",
        matchedClassIds: [band],
        name: "Example Band",
        description: null,
        labels: { en: "Example Band" },
        descriptions: {},
        image: null,
      },
    ]);
    expect(wiki.calls.map((call) => call.url.hostname)).toEqual(["www.wikidata.org", "www.wikidata.org", "commons.wikimedia.org"]);
    const search = wiki.calls[0]?.url.searchParams;
    expect(search?.get("language")).toBe("ja");
    expect(search?.get("limit")).toBe("10");
    expect(search?.get("search")).toBe("Example");
    for (const call of wiki.calls) expect(call.init.headers).toMatchObject({ "User-Agent": "Test/1.0 (test@example.com)" });
  });

  it("falls back to the search label and description when no requested language has one", async () => {
    const wiki = fakeWikimedia({
      search: () => ({ search: [{ id: "Q1", label: "Fallback Label", description: "from search" }] }),
      entities: () => ({ entities: entity("Q1", { labels: { de: "Deutsch" }, P106: [singer] }) }),
    });
    const [musician] = await searchMusicians("x", { fetcher: wiki.fetcher, languages: ["ja"] });
    expect(musician).toMatchObject({ name: "Fallback Label", description: "from search", labels: { de: "Deutsch" } });
  });

  it("returns an empty list without an entity request when the search has no hits", async () => {
    const wiki = fakeWikimedia({});
    await expect(searchMusicians("nothing", { fetcher: wiki.fetcher })).resolves.toEqual([]);
    expect(wiki.calls).toHaveLength(1);
  });

  it("drops the image when Commons attribution is incomplete", async () => {
    const wiki = fakeWikimedia({
      search: () => ({ search: [{ id: "Q1", label: "A" }] }),
      entities: () => ({ entities: entity("Q1", { P106: [singer], P18: "A.jpg" }) }),
      commons: () => ({ query: { pages: [commonsPage("File:A.jpg", { artist: false })] } }),
    });
    const [musician] = await searchMusicians("A", { fetcher: wiki.fetcher });
    expect(musician?.image).toBeNull();
  });

  it("skips the Commons request entirely with includeImages false", async () => {
    const wiki = fakeWikimedia({
      search: () => ({ search: [{ id: "Q1", label: "A" }] }),
      entities: () => ({ entities: entity("Q1", { P106: [singer], P18: "A.jpg" }) }),
    });
    const [musician] = await searchMusicians("A", { fetcher: wiki.fetcher, includeImages: false });
    expect(musician?.image).toBeNull();
    expect(wiki.calls.map((call) => call.url.hostname)).toEqual(["www.wikidata.org", "www.wikidata.org"]);
  });

  it("honours a custom occupation list", async () => {
    const wiki = fakeWikimedia({
      search: () => ({ search: [{ id: "Q1", label: "Bassist" }, { id: "Q2", label: "Singer" }] }),
      entities: () => ({ entities: { ...entity("Q1", { P106: ["Q1150533"] }), ...entity("Q2", { P106: [singer] }) } }),
    });
    const found = await searchMusicians("x", { fetcher: wiki.fetcher, occupationIds: ["Q1150533"] });
    expect(found.map((musician) => musician.qid)).toEqual(["Q1"]);
  });

  it("passes language and limit through and clamps the limit", async () => {
    const wiki = fakeWikimedia({});
    const client = createWikidataMusiciansClient({ fetcher: wiki.fetcher, languages: ["en"] });
    await client.search("x", { language: "de", limit: 500 });
    expect(wiki.calls[0]?.url.searchParams.get("language")).toBe("de");
    expect(wiki.calls[0]?.url.searchParams.get("limit")).toBe("50");
  });

  it("rejects an empty query, an over-long query and a bad language without a request", async () => {
    const wiki = fakeWikimedia({});
    const client = createWikidataMusiciansClient({ fetcher: wiki.fetcher });
    expect(await code(client.search("   "))).toBe("invalid-input");
    expect(await code(client.search("x".repeat(301)))).toBe("invalid-input");
    expect(await code(client.search("x", { language: "not a code" }))).toBe("invalid-input");
    expect(wiki.calls).toHaveLength(0);
    expect(() => createWikidataMusiciansClient({ languages: [] })).toThrow(WikidataMusiciansError);
  });

  it("sends the default User-Agent, which names only this library", async () => {
    const wiki = fakeWikimedia({});
    await searchMusicians("x", { fetcher: wiki.fetcher });
    expect(wiki.calls[0]?.init.headers).toMatchObject({ "User-Agent": DEFAULT_USER_AGENT });
    expect(DEFAULT_USER_AGENT.split("/")[0]).toBe("wikidata-musicians");
  });

  it("maps HTTP errors, API errors and bad JSON to unavailable with a cause", async () => {
    const http500 = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(searchMusicians("x", { fetcher: http500 })).rejects.toMatchObject({ code: "unavailable", cause: expect.any(Error) });
    const apiError = (async () => new Response(JSON.stringify({ error: { code: "badvalue" } }), { status: 200 })) as unknown as typeof fetch;
    await expect(searchMusicians("x", { fetcher: apiError })).rejects.toMatchObject({ code: "unavailable" });
    const notJson = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    await expect(searchMusicians("x", { fetcher: notJson })).rejects.toMatchObject({ code: "unavailable" });
    const network = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(searchMusicians("x", { fetcher: network })).rejects.toMatchObject({ code: "unavailable", cause: expect.any(TypeError) });
  });
});

describe("get", () => {
  it("returns a verified musician for a QID", async () => {
    const wiki = fakeWikimedia({
      entities: (params) => {
        expect(params.get("ids")).toBe("Q5383");
        return { entities: entity("Q5383", { labels: { en: "Example" }, P106: [singer] }) };
      },
    });
    await expect(getMusician("Q5383", { fetcher: wiki.fetcher })).resolves.toMatchObject({ qid: "Q5383", name: "Example", kind: "person" });
  });

  it("uses the QID as the name when there is no label at all", async () => {
    const wiki = fakeWikimedia({ entities: () => ({ entities: entity("Q7", { P31: [band] }) }) });
    await expect(getMusician("Q7", { fetcher: wiki.fetcher })).resolves.toMatchObject({ name: "Q7", description: null, kind: "group" });
  });

  it("distinguishes a missing item from a non-musician", async () => {
    const missing = fakeWikimedia({ entities: () => ({ entities: { Q404: { id: "Q404", missing: "" } } }) });
    expect(await code(getMusician("Q404", { fetcher: missing.fetcher }))).toBe("not-found");
    const painter = fakeWikimedia({ entities: () => ({ entities: entity("Q5", { P106: ["Q1028181"] }) }) });
    expect(await code(getMusician("Q5", { fetcher: painter.fetcher }))).toBe("not-a-musician");
  });

  it("rejects a malformed QID without a request", async () => {
    const wiki = fakeWikimedia({});
    expect(await code(getMusician("5383", { fetcher: wiki.fetcher }))).toBe("invalid-input");
    expect(await code(getMusician("Q0", { fetcher: wiki.fetcher }))).toBe("invalid-input");
    expect(wiki.calls).toHaveLength(0);
  });
});

describe("cache", () => {
  it("reuses a search and a get within the TTL, case-insensitively, and expires afterwards", async () => {
    let time = 0;
    const wiki = fakeWikimedia({
      search: () => ({ search: [{ id: "Q1", label: "A" }] }),
      entities: () => ({ entities: entity("Q1", { P106: [singer] }) }),
    });
    const client = createWikidataMusiciansClient({ fetcher: wiki.fetcher, cacheTtlMs: 1000, now: () => time });
    await client.search("Abc");
    await client.search("abc");
    expect(wiki.calls).toHaveLength(2);
    await client.get("Q1");
    await client.get("Q1");
    expect(wiki.calls).toHaveLength(3);
    time = 1001;
    await client.search("abc");
    expect(wiki.calls).toHaveLength(5);
  });

  it("does not cache a failure", async () => {
    let fail = true;
    const wiki = fakeWikimedia({
      search: () => {
        if (fail) throw new Error("boom");
        return { search: [] };
      },
    });
    const failingFetcher = (async (...args: Parameters<typeof fetch>) => {
      if (fail) return new Response("", { status: 503 });
      return wiki.fetcher(...args);
    }) as typeof fetch;
    const client = createWikidataMusiciansClient({ fetcher: failingFetcher, cacheTtlMs: 60_000 });
    await expect(client.search("x")).rejects.toMatchObject({ code: "unavailable" });
    fail = false;
    await expect(client.search("x")).resolves.toEqual([]);
  });

  it("is disabled with cacheTtlMs 0", async () => {
    const wiki = fakeWikimedia({});
    const client = createWikidataMusiciansClient({ fetcher: wiki.fetcher, cacheTtlMs: 0 });
    await client.search("x");
    await client.search("x");
    expect(wiki.calls).toHaveLength(2);
  });
});
