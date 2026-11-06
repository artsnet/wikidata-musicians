import { COMMONS_API, asNonEmptyString, asRecord, fetchApiJson, type HttpOptions } from "./http.js";

export type CommonsImage = {
  /** Direct file URL on upload.wikimedia.org. */
  url: string;
  /** The Commons file page, which is where attribution must link. */
  filePageUrl: string;
  /** For example `CC BY-SA 4.0`. */
  licenseName: string;
  licenseUrl: string;
  /** Author credit with markup stripped. */
  artistCredit: string;
};

const MAX_TITLES_PER_QUERY = 50;

function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function isHttpsUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Commons normalises a title by replacing underscores with spaces and capitalising the first letter. */
export function normalizeFileTitle(fileName: string): string {
  const name = fileName.trim().replace(/_/g, " ").replace(/^File:/i, "");
  return `File:${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** The imageinfo API appends `utm_*` tracking parameters to file URLs; they are not part of the file's identity. */
export function stripTrackingParams(value: string): string {
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) if (key.startsWith("utm_")) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return value;
  }
}

function imageFromPage(page: Record<string, unknown>): CommonsImage | null {
  const imageInfo = Array.isArray(page.imageinfo) ? asRecord(page.imageinfo[0]) : null;
  const metadata = asRecord(imageInfo?.extmetadata);
  const licenseName = asNonEmptyString(asRecord(metadata?.LicenseShortName)?.value);
  const licenseUrl = asNonEmptyString(asRecord(metadata?.LicenseUrl)?.value);
  const artistRaw = asNonEmptyString(asRecord(metadata?.Artist)?.value);
  const artistCredit = artistRaw ? stripMarkup(artistRaw) : null;
  const url = asNonEmptyString(imageInfo?.url);
  const filePageUrl = asNonEmptyString(imageInfo?.descriptionurl);
  if (!isHttpsUrl(url) || !isHttpsUrl(filePageUrl) || !licenseName || !isHttpsUrl(licenseUrl) || !artistCredit) return null;
  return { url: stripTrackingParams(url), filePageUrl, licenseName, licenseUrl, artistCredit };
}

/**
 * Looks up several Commons files in as few requests as possible (50 titles per request) and
 * returns an image only where the file URL, file page, license name, license URL and author
 * credit are all present. Anything less is not safe to display with attribution, so it is `null`.
 */
export async function fetchCommonsImages(fileNames: readonly string[], options: HttpOptions): Promise<Map<string, CommonsImage | null>> {
  const result = new Map<string, CommonsImage | null>();
  const unique = Array.from(new Set(fileNames.filter((name) => name.trim())));
  for (let start = 0; start < unique.length; start += MAX_TITLES_PER_QUERY) {
    const batch = unique.slice(start, start + MAX_TITLES_PER_QUERY);
    const body = await fetchApiJson(COMMONS_API, {
      action: "query",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist",
      titles: batch.map(normalizeFileTitle).join("|"),
    }, options);
    const query = asRecord(body.query);
    const byTitle = new Map<string, CommonsImage | null>();
    const pages = Array.isArray(query?.pages) ? query.pages : [];
    for (const page of pages) {
      const record = asRecord(page);
      const title = asNonEmptyString(record?.title);
      if (record && title) byTitle.set(title, imageFromPage(record));
    }
    // The API reports titles it rewrote (e.g. different capitalisation) under `normalized`.
    const normalized = new Map<string, string>();
    for (const entry of Array.isArray(query?.normalized) ? query.normalized : []) {
      const record = asRecord(entry);
      const from = asNonEmptyString(record?.from);
      const to = asNonEmptyString(record?.to);
      if (from && to) normalized.set(from, to);
    }
    for (const fileName of batch) {
      const requested = normalizeFileTitle(fileName);
      const title = normalized.get(requested) ?? requested;
      result.set(fileName, byTitle.get(title) ?? null);
    }
  }
  return result;
}
