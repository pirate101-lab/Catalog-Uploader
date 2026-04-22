import { asc } from "drizzle-orm";
import {
  db,
  recategorisationRulesTable,
  recategorisationRulesMetaTable,
  type RecategorisationRule,
} from "@workspace/db";
import { invalidateCatalog, setActiveRecategorisationRules } from "./catalog";

/**
 * One compiled rule fed to `reclassifyMislabeledShoes`. We keep both
 * the original DB row metadata (id, label, pattern, enabled flag) and
 * the compiled regex so the catalog loader doesn't have to recompile
 * on every catalog reload, and the admin list can display the source
 * pattern verbatim.
 */
export interface CompiledRule {
  id: number;
  label: string;
  pattern: string;
  re: RegExp;
  category: string;
}

/**
 * Default rule set seeded into the database the first time the server
 * boots against an empty `recategorisation_rules` table. Mirrors the
 * historical hard-coded NON_SHOE_HINTS in catalog.ts so behaviour is
 * unchanged out of the box. Once seeded, staff can edit/disable/delete
 * any of these from the admin without touching the code.
 */
export const DEFAULT_RECATEGORISATION_RULES: Array<{
  label: string;
  pattern: string;
  targetCategory: string;
}> = [
  {
    label: "Bottoms (jeans, pants, shorts, skirts)",
    pattern:
      "\\bbootcut\\b|\\bjeans?\\b|\\bdenim\\b|\\bpants?\\b|\\btrouser|\\bleggings?\\b|\\bshorts?\\b|\\bskirt|\\bskort",
    targetCategory: "bottoms",
  },
  {
    label: "Tops (tee, shirt, hoodie, blouse)",
    pattern:
      "\\b(t[\\s-]?shirt|tee|tees|sweatshirt|hoodie|blouse|cami|tank|crop\\s?top|polo|shirt|top|graphic)\\b",
    targetCategory: "tops",
  },
  {
    label: "Dresses",
    pattern: "\\bdress(es)?\\b|\\bgown\\b",
    targetCategory: "dresses",
  },
  {
    label: "Jumpsuits / rompers",
    pattern: "\\bjumpsuit|\\bromper|\\boveralls?\\b",
    targetCategory: "jumpsuits",
  },
  {
    label: "Outerwear (jacket, coat, blazer, cardigan)",
    pattern:
      "\\bjacket|\\bcoat\\b|\\bblazer|\\boutwear|\\bouterwear|\\bparka|\\bcardigan",
    targetCategory: "outerwear",
  },
  {
    label: "Sweaters / knits",
    pattern: "\\bsweater|\\bknit\\b|\\bpullover",
    targetCategory: "sweaters",
  },
  {
    label: "Sets / multi-piece",
    pattern:
      "\\b(set|sets|two[\\s-]?piece|2[\\s-]?piece|3[\\s-]?piece)\\b",
    targetCategory: "sets",
  },
];

let cache: CompiledRule[] | null = null;

/**
 * Compile a single DB row into a regex + metadata. Returns null when
 * the pattern fails to parse (admin saved an invalid regex) so the
 * loader can skip it cleanly without aborting the whole reload.
 */
export function compileRule(row: RecategorisationRule): CompiledRule | null {
  try {
    return {
      id: row.id,
      label: row.label,
      pattern: row.pattern,
      re: new RegExp(row.pattern, "i"),
      category: row.targetCategory,
    };
  } catch {
    return null;
  }
}

/**
 * Synchronous accessor for the catalog loader. Returns the cached set
 * of enabled rules, or null if rules haven't been loaded yet — in
 * which case the catalog falls back to its built-in defaults so the
 * very first boot before `ensureRecategorisationRulesLoaded` resolves
 * still has working classification.
 */
export function getCompiledRulesSync(): CompiledRule[] | null {
  return cache;
}

async function fetchRows(): Promise<RecategorisationRule[]> {
  return db
    .select()
    .from(recategorisationRulesTable)
    .orderBy(
      asc(recategorisationRulesTable.sortOrder),
      asc(recategorisationRulesTable.id),
    );
}

/**
 * Load (and seed-on-first-install) the recategorisation rules into the
 * in-process cache. Idempotent — safe to call multiple times. Invokes
 * `invalidateCatalog()` so the next product fetch rebuilds with the
 * fresh rule set.
 *
 * Seeding is gated by the `recategorisation_rules_meta` singleton: the
 * defaults are inserted at most once per database. If staff later
 * delete every rule, the table can legitimately be empty and we MUST
 * NOT silently re-seed defaults — that would override a deliberate
 * "no auto-recategorisation" choice.
 */
export async function ensureRecategorisationRulesLoaded(): Promise<
  CompiledRule[]
> {
  // `!== null` (not truthy) so an intentionally empty active set
  // (`cache = []` after admin disables every rule) still short-circuits
  // and avoids re-hitting the DB on every loadCatalog call.
  if (cache !== null) return cache;
  const meta = await db
    .select()
    .from(recategorisationRulesMetaTable)
    .limit(1);
  const alreadySeeded = meta.length > 0;
  let rows = await fetchRows();
  if (!alreadySeeded) {
    // First-ever boot against this DB. If the table happens to already
    // have rows (e.g. an install that predates this meta table) we
    // simply mark seeded and leave the existing rows alone.
    if (rows.length === 0) {
      await db.insert(recategorisationRulesTable).values(
        DEFAULT_RECATEGORISATION_RULES.map((r, i) => ({
          label: r.label,
          pattern: r.pattern,
          targetCategory: r.targetCategory,
          sortOrder: i,
        })),
      );
      rows = await fetchRows();
    }
    await db
      .insert(recategorisationRulesMetaTable)
      .values({ id: 1 })
      .onConflictDoNothing();
  }
  cache = rows
    .filter((r) => r.enabled)
    .map(compileRule)
    .filter((r): r is CompiledRule => r !== null);
  // Always push — even an empty array — so the catalog respects an
  // intentionally-empty admin rule set instead of falling back to the
  // hard-coded defaults.
  setActiveRecategorisationRules(
    cache.map((r) => ({ re: r.re, category: r.category })),
  );
  invalidateCatalog();
  return cache;
}

/**
 * Drop the in-memory rule cache and the catalog cache. Called after
 * any admin CRUD on `recategorisation_rules` so the next catalog
 * reload picks up the change immediately.
 */
export function invalidateRecategorisationRules(): void {
  cache = null;
  invalidateCatalog();
}

/**
 * Read every rule (including disabled ones) for the admin list.
 * Rule editing is rare and the table is tiny, so we hit the DB
 * directly rather than caching disabled rows.
 */
export function listAllRecategorisationRules(): Promise<RecategorisationRule[]> {
  return fetchRows();
}

/**
 * Test helper — clears the rules cache without touching the DB so
 * unit tests that exercise the catalog loader can start from a known
 * state. Not part of the public storefront contract.
 */
export function _resetRecategorisationRulesCacheForTests(): void {
  cache = null;
}
