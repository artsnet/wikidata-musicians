import { describe, expect, it, vi } from "vitest";
import { EXIT_CODES, HELP, parseArgs, runCli } from "../src/cli.js";
import type { Musician, WikidataMusiciansClient } from "../src/client.js";
import { WikidataMusiciansError } from "../src/errors.js";
import { VERSION } from "../src/version.js";

const musician: Musician = {
  qid: "Q1", wikidataUrl: "https://www.wikidata.org/wiki/Q1", kind: "person", matchedClassIds: ["Q177220"], name: "Example", description: "singer",
  labels: { en: "Example" }, descriptions: { en: "singer" },
  image: { url: "https://upload.wikimedia.org/x.jpg", filePageUrl: "https://commons.wikimedia.org/wiki/File:X.jpg", licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", artistCredit: "Photographer" },
};

function io(argv: string[], client: Partial<WikidataMusiciansClient> = {}, env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const createClient = vi.fn(() => ({ languages: ["en"], search: vi.fn(async () => [musician]), get: vi.fn(async () => musician), ...client }));
  const run = () => runCli({ argv, env, stdout: (text) => out.push(text), stderr: (text) => err.push(text), createClient });
  return { run, out, err, createClient };
}

describe("parseArgs", () => {
  it("parses search with options", () => {
    expect(parseArgs(["search", "Ryuichi", "Sakamoto", "--json", "--languages", "ja,en", "--language", "ja", "--limit", "5", "--no-images", "--user-agent", "X/1", "--timeout", "500"])).toEqual({
      kind: "run",
      options: { json: true, command: { kind: "search", query: "Ryuichi Sakamoto", language: "ja", limit: 5 }, client: { languages: ["ja", "en"], includeImages: false, userAgent: "X/1", timeoutMs: 500 } },
    });
  });

  it("parses get and classes", () => {
    expect(parseArgs(["get", "Q5383"])).toMatchObject({ kind: "run", options: { command: { kind: "get", qid: "Q5383" } } });
    expect(parseArgs(["classes", "--json"])).toMatchObject({ kind: "run", options: { json: true, command: { kind: "classes" } } });
  });

  it("reads the User-Agent and languages from the environment, flags override", () => {
    const env = { WIKIDATA_MUSICIANS_USER_AGENT: "Env/1", WIKIDATA_MUSICIANS_LANGUAGES: "de, fr" };
    expect(parseArgs(["get", "Q1"], env)).toMatchObject({ options: { client: { userAgent: "Env/1", languages: ["de", "fr"] } } });
    expect(parseArgs(["get", "Q1", "--languages", "ja"], env)).toMatchObject({ options: { client: { languages: ["ja"] } } });
  });

  it.each([[], ["bogus"], ["search"], ["get"], ["get", "Q1", "Q2"], ["classes", "x"], ["search", "x", "--limit", "0"], ["search", "x", "--limit", "51"], ["search", "x", "--nope"], ["get", "Q1", "--user-agent"]])(
    "rejects %j",
    (...argv) => {
      expect(parseArgs(argv)).toMatchObject({ kind: "usage-error" });
    },
  );

  it("recognises help and version", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
  });
});

describe("runCli", () => {
  it("prints help and the version", async () => {
    const help = io(["-h"]);
    expect(await help.run()).toBe(0);
    expect(help.out.join("")).toBe(HELP);
    const version = io(["--version"]);
    expect(await version.run()).toBe(0);
    expect(version.out.join("")).toBe(`${VERSION}\n`);
  });

  it("prints a JSON search result", async () => {
    const { run, out, createClient } = io(["search", "Example", "--json", "--language", "ja", "--limit", "3"], {}, { WIKIDATA_MUSICIANS_USER_AGENT: "T/1" });
    expect(await run()).toBe(0);
    expect(JSON.parse(out.join(""))).toEqual({ schemaVersion: 1, ok: true, query: "Example", language: "ja", musicians: [musician] });
    expect(createClient).toHaveBeenCalledWith({ userAgent: "T/1", cacheTtlMs: 0 });
    const client = createClient.mock.results[0]?.value as { search: ReturnType<typeof vi.fn> };
    expect(client.search).toHaveBeenCalledWith("Example", { language: "ja", limit: 3 });
  });

  it("prints a JSON get result and the human form", async () => {
    const json = io(["get", "Q1", "--json"]);
    expect(await json.run()).toBe(0);
    expect(JSON.parse(json.out.join(""))).toEqual({ schemaVersion: 1, ok: true, qid: "Q1", musician });
    const human = io(["get", "Q1"]);
    expect(await human.run()).toBe(0);
    expect(human.out.join("")).toContain("Q1  Example  (singer)");
    expect(human.out.join("")).toContain("credit:   Photographer, CC BY 4.0");
  });

  it("warns on stderr when no User-Agent is configured", async () => {
    const { run, err } = io(["get", "Q1"]);
    await run();
    expect(err.join("")).toContain("no User-Agent set");
    const quiet = io(["get", "Q1", "--user-agent", "App/1"]);
    await quiet.run();
    expect(quiet.err).toEqual([]);
  });

  it("maps failures to exit codes and a JSON failure line", async () => {
    const notFound = io(["get", "Q404", "--json"], { get: vi.fn(async () => { throw new WikidataMusiciansError("not-found"); }) });
    expect(await notFound.run()).toBe(EXIT_CODES["not-found"]);
    expect(JSON.parse(notFound.out.join(""))).toMatchObject({ ok: false, input: "Q404", error: { code: "not-found" } });
    const notMusician = io(["get", "Q5"], { get: vi.fn(async () => { throw new WikidataMusiciansError("not-a-musician"); }) });
    expect(await notMusician.run()).toBe(EXIT_CODES["not-a-musician"]);
    expect(notMusician.err.join("")).toContain("error: not-a-musician");
    const crash = io(["search", "x", "--json"], { search: vi.fn(async () => { throw new Error("boom"); }) });
    expect(await crash.run()).toBe(EXIT_CODES.unavailable);
  });

  it("lists the classes offline without creating a client", async () => {
    const { run, out, createClient } = io(["classes", "--json"]);
    expect(await run()).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.classes).toEqual(expect.arrayContaining([{ qid: "Q177220", label: "singer", role: "occupation" }, { qid: "Q215380", label: "band", role: "group" }]));
    expect(createClient).not.toHaveBeenCalled();
  });

  it("prints a friendly line when the search verified nothing", async () => {
    const { run, out } = io(["search", "nobody"], { search: vi.fn(async () => []) });
    expect(await run()).toBe(0);
    expect(out.join("")).toContain('no verified musicians for "nobody"');
  });
});
