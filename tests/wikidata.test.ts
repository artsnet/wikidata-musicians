import { describe, expect, it } from "vitest";
import { getEntities, parseEntity, searchEntities } from "../src/wikidata.js";
import { entity, fakeWikimedia, singer } from "./helpers.js";

describe("parseEntity", () => {
  it("extracts labels, descriptions, direct P106 / P31 item ids and the first P18 file", () => {
    const raw = entity("Q1", { labels: { en: "A", ja: " " }, descriptions: { en: "desc" }, P106: [singer, "Q2"], P31: ["Q5"], P18: "A.jpg" }).Q1;
    expect(parseEntity("Q1", raw)).toEqual({ qid: "Q1", labels: { en: "A" }, descriptions: { en: "desc" }, occupations: [singer, "Q2"], instanceOf: ["Q5"], imageFileName: "A.jpg" });
  });

  it("returns null for a missing or malformed entity", () => {
    expect(parseEntity("Q1", { id: "Q1", missing: "" })).toBeNull();
    expect(parseEntity("Q1", undefined)).toBeNull();
    expect(parseEntity("Q1", "nope")).toBeNull();
  });

  it("tolerates claims with no datavalue (novalue / somevalue snaks)", () => {
    const raw = { claims: { P106: [{ mainsnak: { snaktype: "novalue" } }], P18: [{ mainsnak: { snaktype: "somevalue" } }] } };
    expect(parseEntity("Q1", raw)).toEqual({ qid: "Q1", labels: {}, descriptions: {}, occupations: [], instanceOf: [], imageFileName: null });
  });
});

describe("searchEntities", () => {
  it("keeps only hits with a valid QID and a label", async () => {
    const wiki = fakeWikimedia({ search: () => ({ search: [{ id: "Q1", label: "A", description: "d" }, { id: "P31", label: "prop" }, { id: "Q2" }, { id: "Q3", label: "C" }] }) });
    await expect(searchEntities("x", "en", 10, { fetcher: wiki.fetcher })).resolves.toEqual([{ qid: "Q1", label: "A", description: "d" }, { qid: "Q3", label: "C", description: null }]);
    expect(wiki.calls[0]?.url.searchParams.get("formatversion")).toBe("2");
  });
});

describe("getEntities", () => {
  it("fetches at most 50 ids per request and maps missing ids to null", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `Q${i + 1}`);
    const wiki = fakeWikimedia({ entities: (params) => ({ entities: Object.fromEntries((params.get("ids") ?? "").split("|").map((qid) => [qid, qid === "Q51" ? { id: qid, missing: "" } : entity(qid, { P106: [singer] })[qid]])) }) });
    const entities = await getEntities(ids, ["en"], { fetcher: wiki.fetcher });
    expect(wiki.calls).toHaveLength(2);
    expect(entities.get("Q1")).toMatchObject({ occupations: [singer] });
    expect(entities.get("Q51")).toBeNull();
  });
});
