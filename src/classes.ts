/**
 * Wikidata items that make an entity count as a musician (P106 occupation) or a musical group
 * (P31 instance of). Only direct statements are checked: subclass chains are deliberately not
 * followed, so that an ambiguous item stays hidden until its Wikidata data is explicit.
 * Extend either list through `ClientOptions.occupationIds` / `groupClassIds`.
 */
export const MUSIC_OCCUPATION_IDS: ReadonlyMap<string, string> = new Map([
  ["Q177220", "singer"],
  ["Q639669", "musician"],
  ["Q49757", "songwriter"],
  ["Q36834", "composer"],
  ["Q855091", "guitarist"],
  ["Q386724", "drummer"],
  ["Q486748", "pianist"],
  ["Q2259451", "rapper"],
  ["Q1930187", "DJ"],
  ["Q183945", "record producer"],
  ["Q158852", "conductor"],
]);

export const MUSIC_GROUP_CLASS_IDS: ReadonlyMap<string, string> = new Map([
  ["Q2088357", "musical group"],
  ["Q215380", "band"],
]);

export type MusicClass = { qid: string; label: string; role: "occupation" | "group" };

/** The built-in lists as one array, for documentation and the offline MCP tool. */
export function listMusicClasses(): MusicClass[] {
  return [
    ...Array.from(MUSIC_OCCUPATION_IDS, ([qid, label]): MusicClass => ({ qid, label, role: "occupation" })),
    ...Array.from(MUSIC_GROUP_CLASS_IDS, ([qid, label]): MusicClass => ({ qid, label, role: "group" })),
  ];
}
