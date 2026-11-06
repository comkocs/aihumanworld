// Skin translation tables (标签词表 §8.2 / §9) for the public pages.
// Files live at content/skins/<skin>/<locale>.json; a missing file, a missing
// entry or a missing facet keeps the neutral key and is marked missing.
// No name is ever invented.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { SKINS, type Skin } from "../facts/enums.ts";

export interface SkinEntry {
  key: string;
  name: string;
  flavor: string | null;
}

export interface SkinTable {
  skin: Skin;
  locale: string;
  entries: ReadonlyMap<string, SkinEntry>;
}

export interface SkinBook {
  /** `<skin>/<locale>` → table. */
  tables: ReadonlyMap<string, SkinTable>;
  /** Locales found for one skin, sorted. */
  localesOf(skin: Skin): string[];
}

const SKIN_SET = new Set<string>(SKINS);

function isSkin(v: string): v is Skin {
  return SKIN_SET.has(v);
}

export async function loadSkins(dir: string): Promise<SkinBook> {
  const tables = new Map<string, SkinTable>();
  let skins: string[] = [];
  try {
    skins = await readdir(dir);
  } catch {
    skins = [];
  }
  for (const skin of skins) {
    if (!isSkin(skin)) continue;
    let files: string[] = [];
    try {
      files = (await readdir(join(dir, skin))).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      const locale = file.slice(0, -".json".length);
      const raw = JSON.parse(await readFile(join(dir, skin, file), "utf8")) as {
        skin?: unknown;
        locale?: unknown;
        entries?: { key?: unknown; name?: unknown; flavor?: unknown }[];
      };
      if (raw.skin !== skin || raw.locale !== locale || !Array.isArray(raw.entries)) continue;
      const entries = new Map<string, SkinEntry>();
      for (const e of raw.entries) {
        if (typeof e.key !== "string" || typeof e.name !== "string" || e.name.length === 0) continue;
        if (e.flavor !== null && typeof e.flavor !== "string") continue;
        entries.set(e.key, { key: e.key, name: e.name, flavor: e.flavor });
      }
      tables.set(`${skin}/${locale}`, { skin, locale, entries });
    }
  }
  return {
    tables,
    localesOf(skin) {
      const out: string[] = [];
      for (const key of tables.keys()) {
        if (key.startsWith(`${skin}/`)) out.push(key.slice(skin.length + 1));
      }
      return out.sort();
    },
  };
}

/** One translated facet: the registered name, or the key itself when absent. */
export interface Named {
  key: string;
  name: string;
  /** True when the table has no row for this key (标签词表 §8.2: keep the key). */
  missing: boolean;
}

export interface Lexicon {
  skin: Skin | null;
  locale: string | null;
  name(key: string): Named;
}

const NONE: Lexicon = { skin: null, locale: null, name: (key) => ({ key, name: key, missing: true }) };

/** Neutral keys only: no skin chosen, or the chosen table does not exist. */
export function neutralLexicon(): Lexicon {
  return NONE;
}

export function lexiconFor(book: SkinBook, skin: Skin, locale: string): Lexicon {
  const table = book.tables.get(`${skin}/${locale}`);
  if (table === undefined) return NONE;
  return {
    skin,
    locale,
    name(key) {
      const hit = table.entries.get(key);
      return hit === undefined ? { key, name: key, missing: true } : { key, name: hit.name, missing: false };
    },
  };
}
