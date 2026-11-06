import { describe, expect, it } from "vitest";
import { fetchCommonsImages, normalizeFileTitle, stripTrackingParams } from "../src/commons.js";
import { commonsPage, fakeWikimedia } from "./helpers.js";

describe("normalizeFileTitle", () => {
  it("adds the File: prefix, replaces underscores and capitalises the first letter", () => {
    expect(normalizeFileTitle("example_photo.jpg")).toBe("File:Example photo.jpg");
    expect(normalizeFileTitle("File:Already Fine.png")).toBe("File:Already Fine.png");
    expect(normalizeFileTitle("  spaced .webp ")).toBe("File:Spaced .webp");
  });
});

describe("fetchCommonsImages", () => {
  it("looks up many files in one request and maps results back through the API's normalisation", async () => {
    const wiki = fakeWikimedia({
      commons: (params) => {
        expect(params.get("titles")).toBe("File:A.jpg|File:B c.png|File:Missing.jpg");
        expect(params.get("iiprop")).toBe("url|extmetadata");
        return {
          query: {
            normalized: [{ from: "File:B c.png", to: "File:B C.png" }],
            pages: [commonsPage("File:A.jpg"), commonsPage("File:B C.png"), { title: "File:Missing.jpg", missing: true }],
          },
        };
      },
    });
    const images = await fetchCommonsImages(["A.jpg", "B_c.png", "Missing.jpg"], { fetcher: wiki.fetcher });
    expect(images.get("A.jpg")).toMatchObject({ licenseName: "CC BY-SA 4.0", artistCredit: "Example Photographer", filePageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg" });
    expect(images.get("B_c.png")).toMatchObject({ filePageUrl: "https://commons.wikimedia.org/wiki/File:B_C.png" });
    expect(images.get("Missing.jpg")).toBeNull();
    expect(wiki.calls).toHaveLength(1);
  });

  it("returns null for a file whose license or URLs are not https", async () => {
    const wiki = fakeWikimedia({
      commons: () => ({ query: { pages: [commonsPage("File:A.jpg", { url: "http://upload.wikimedia.org/x.jpg" }), commonsPage("File:B.jpg", { license: false })] } }),
    });
    const images = await fetchCommonsImages(["A.jpg", "B.jpg"], { fetcher: wiki.fetcher });
    expect(images.get("A.jpg")).toBeNull();
    expect(images.get("B.jpg")).toBeNull();
  });

  it("splits more than 50 files across requests", async () => {
    const wiki = fakeWikimedia({ commons: () => ({ query: { pages: [] } }) });
    const names = Array.from({ length: 51 }, (_, i) => `F${i}.jpg`);
    await fetchCommonsImages(names, { fetcher: wiki.fetcher });
    expect(wiki.calls).toHaveLength(2);
  });

  it("makes no request for an empty list", async () => {
    const wiki = fakeWikimedia({});
    await expect(fetchCommonsImages([], { fetcher: wiki.fetcher })).resolves.toEqual(new Map());
    expect(wiki.calls).toHaveLength(0);
  });
});

describe("stripTrackingParams", () => {
  it("removes utm_* parameters and keeps everything else", () => {
    expect(stripTrackingParams("https://upload.wikimedia.org/a/b/X.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original")).toBe("https://upload.wikimedia.org/a/b/X.jpg");
    expect(stripTrackingParams("https://upload.wikimedia.org/a/b/X.jpg?width=300&utm_source=x")).toBe("https://upload.wikimedia.org/a/b/X.jpg?width=300");
    expect(stripTrackingParams("not a url")).toBe("not a url");
  });

  it("is applied to the file URL of a resolved image", async () => {
    const wiki = fakeWikimedia({ commons: () => ({ query: { pages: [commonsPage("File:A.jpg", { url: "https://upload.wikimedia.org/a/A.jpg?utm_source=commons.wikimedia.org" })] } }) });
    const images = await fetchCommonsImages(["A.jpg"], { fetcher: wiki.fetcher });
    expect(images.get("A.jpg")?.url).toBe("https://upload.wikimedia.org/a/A.jpg");
  });
});
