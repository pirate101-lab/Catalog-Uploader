import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface CatalogProductRaw {
  id: string;
  title: string;
  price: number;
  category: string;
  image: string;
  source_image?: string;
}

export type Gender = "women" | "men";

export type BucketKey =
  | "new_in"
  | "collection"
  | "tiktok_verified"
  | "trending";

export const ALL_BUCKETS: BucketKey[] = [
  "new_in",
  "collection",
  "tiktok_verified",
  "trending",
];

export interface ProductRow {
  id: string;
  title: string;
  category: string | null;
  subCategory: string | null;
  price: string;
  imageUrls: string[];
  sizes: string[];
  colors: { name: string; hex: string; image?: string }[];
  gender: Gender;
  /**
   * Bucket flags — synthesised deterministically at boot from the
   * existing catalog (the live Trendsi feed is gated behind expired
   * credentials, so the four merch buckets are derived from numeric
   * id + price + a stable hash of the id rather than scraped). Both
   * women and men receive bucket flags — the top nav exposes the tabs
   * for women only, but the homepage "today's featured edit" grid
   * filters by tiktok_verified for whichever gender is active, so the
   * men pool needs the flags too.
   */
  isNewIn: boolean;
  isCollection: boolean;
  isTikTokVerified: boolean;
  isTrending: boolean;
  /** 0..1 numeric score used to sort within the trending bucket. */
  trendScore: number;
  /** Pre-flattened list of bucket keys this product belongs to. */
  buckets: BucketKey[];
  /** Optional admin-authored fields (custom products carry these
   * directly; JSON-catalog products acquire them through overrides). */
  badge?: string | null;
  featured?: boolean;
  hidden?: boolean;
  stockLevel?: number | null;
  /** ISO timestamp of soft-delete on a custom product, if any. */
  deletedAt?: string | null;
}

const PUBLIC_BASE = (process.env["R2_PUBLIC_BASE_URL"] ?? "").replace(/\/+$/, "");
const KEY_PREFIX_BY_GENDER: Record<Gender, string> = {
  women: "catalog/replit_lite",
  men: "catalog/replit_lite_men",
};

function rewriteImageUrl(relPath: string, gender: Gender): string {
  const clean = relPath.replace(/^\/+/, "");
  if (clean.includes("..") || clean.includes("\\")) {
    return `/image-coming-soon.svg`;
  }
  if (!PUBLIC_BASE) {
    return `/image-coming-soon.svg`;
  }
  return `${PUBLIC_BASE}/${KEY_PREFIX_BY_GENDER[gender]}/${clean}`;
}

// FNV-1a 32-bit hash → stable per-id randomness in [0, 1). Same id
// always produces the same value, so bucket membership stays stable
// across server restarts and the daily-rotation seed is reproducible.
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

function numericIdPart(id: string): number {
  // Catalog ids are numeric strings (e.g. "150316") so the parsed
  // value approximates "newness": Trendsi assigns sequentially.
  const m = id.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

interface BucketDerivation {
  isNewIn: boolean;
  isCollection: boolean;
  isTikTokVerified: boolean;
  isTrending: boolean;
  trendScore: number;
  buckets: BucketKey[];
}

const EMPTY_BUCKETS: BucketDerivation = {
  isNewIn: false,
  isCollection: false,
  isTikTokVerified: false,
  isTrending: false,
  trendScore: 0,
  buckets: [],
};

interface UpstreamFlag {
  isNewIn: boolean;
  isCollection: boolean;
  isTikTokVerified: boolean;
  isTrending: boolean;
  trendScore: number;
  observed: boolean;
}

interface UpstreamFlagsFile {
  _meta?: Record<string, unknown>;
  flags: Record<string, UpstreamFlag>;
}

// Load per-product bucket flags pulled from Trendsi's home-product API
// (see scripts/enrich-women-buckets.py). Returns null when the snapshot
// file is missing — callers fall back to deterministic synthesis.
function loadUpstreamFlags(): Map<string, UpstreamFlag> | null {
  const dataPath = resolve(__dirname, "../data", "catalog_buckets.json");
  if (!existsSync(dataPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(dataPath, "utf-8")) as UpstreamFlagsFile;
    if (!parsed || typeof parsed !== "object" || !parsed.flags) return null;
    return new Map(Object.entries(parsed.flags));
  } catch {
    return null;
  }
}

// Derive bucket flags for a single-gender catalog slice. Prefers real
// upstream flags from catalog_buckets.json when a product is "observed"
// there (women only — the men catalog has no upstream coverage), and
// falls back to deterministic synthesis (top 30% by numeric id →
// new_in, hash%2==0 → collection, hash%4==0 → tiktok_verified, top
// 30% by trendScore → trending) for any product without coverage. Run
// per-gender so each gender's "top 30%" is computed within its own pool
// and one gender doesn't crowd the other out of the merch buckets.
function deriveBuckets(rows: ProductRow[]): void {
  if (rows.length === 0) return;
  const upstream = loadUpstreamFlags();

  const nidSorted = [...rows]
    .map((r) => ({ id: r.id, nid: numericIdPart(r.id) }))
    .sort((a, b) => b.nid - a.nid);
  const newInCutoff = Math.max(1, Math.floor(rows.length * 0.3));
  const synthNewInIds = new Set(nidSorted.slice(0, newInCutoff).map((x) => x.id));

  // Synthesised trendScore = blend of stable hash + price-tier kicker
  // so trending skews toward mid-priced viral hits, not random or
  // only-expensive. Used both as the trending sort key (mixed with
  // upstream scores) and as the synth-fallback membership signal.
  const scored = rows.map((r) => {
    const h = hash01(r.id);
    const price = Number(r.price);
    const tierBoost = price >= 25 && price <= 60 ? 0.15 : 0;
    const trendScore = Math.min(1, h * 0.85 + tierBoost);
    return { id: r.id, trendScore, h };
  });
  const scoreMap = new Map(scored.map((s) => [s.id, s]));
  const synthTrendCutoff = Math.max(1, Math.floor(rows.length * 0.3));
  const synthTrendingIds = new Set(
    [...scored].sort((a, b) => b.trendScore - a.trendScore)
      .slice(0, synthTrendCutoff)
      .map((x) => x.id),
  );

  for (const r of rows) {
    const s = scoreMap.get(r.id)!;
    // Strip the gender prefix (women products carry no "m-") so we can
    // look up the raw upstream id; women rows already keep the bare id.
    const upstreamFlag = upstream?.get(r.id);
    let isNewIn: boolean;
    let isCollection: boolean;
    let isTikTokVerified: boolean;
    let isTrending: boolean;
    let trendScore: number;
    if (upstreamFlag && upstreamFlag.observed) {
      isNewIn = upstreamFlag.isNewIn;
      isCollection = upstreamFlag.isCollection;
      isTikTokVerified = upstreamFlag.isTikTokVerified;
      isTrending = upstreamFlag.isTrending;
      // Upstream trendScore is 0 for most rows (raw maxEarn signal is
      // sparse), so blend in a small synthesised tiebreaker to keep the
      // trending sort stable and avoid huge equal-score plateaus.
      trendScore = upstreamFlag.trendScore > 0
        ? upstreamFlag.trendScore
        : s.trendScore * 0.5;
    } else {
      const hashBucket = Math.floor(s.h * 1000);
      isCollection = hashBucket % 2 === 0;
      isTikTokVerified = hashBucket % 4 === 0;
      isNewIn = synthNewInIds.has(r.id);
      isTrending = synthTrendingIds.has(r.id);
      trendScore = s.trendScore;
    }
    const buckets: BucketKey[] = [];
    if (isNewIn) buckets.push("new_in");
    if (isCollection) buckets.push("collection");
    if (isTikTokVerified) buckets.push("tiktok_verified");
    if (isTrending) buckets.push("trending");
    r.isNewIn = isNewIn;
    r.isCollection = isCollection;
    r.isTikTokVerified = isTikTokVerified;
    r.isTrending = isTrending;
    r.trendScore = trendScore;
    r.buckets = buckets;
  }
}

function loadOne(fileName: string, gender: Gender): ProductRow[] {
  // After esbuild bundling, __dirname === artifacts/api-server/dist, so the data dir is one level up.
  const dataPath = resolve(__dirname, "../data", fileName);
  if (!existsSync(dataPath)) return [];
  const raw = JSON.parse(readFileSync(dataPath, "utf-8")) as CatalogProductRaw[];
  // Namespace IDs by gender to avoid collisions between catalogs.
  return raw.map((p) => ({
    id: `${gender === "men" ? "m-" : ""}${p.id}`,
    title: p.title,
    category: p.category ?? null,
    subCategory: null,
    price: p.price.toFixed(2),
    imageUrls: p.image ? [rewriteImageUrl(p.image, gender)] : [],
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: [],
    gender,
    ...EMPTY_BUCKETS,
    buckets: [],
  }));
}

// Words in a product title that prove the item is genuinely footwear.
// `\bboot\b` matches "boot" / "boots" / "ankle boot" but NOT "bootcut"
// or "Boot Graphic T-Shirt" (those have other tokens after `boot`
// without a word boundary in the right place — the regex still matches
// "Boot " in "Boot Graphic", so we further require the whole title
// has NO disqualifying garment keyword below).
const SHOE_KEYWORDS = /\b(boot|bootie|booties|sneaker|sandal|heel|heels|loafer|pump|pumps|mule|slipper|slide|slides|oxford|derby|stiletto|wedge|wedges|espadrille|trainer|trainers|clog|clogs|moccasin|brogue|chelsea|flats?|flip[\s-]?flop|crocs?)\b/i;

// Strong signals the title is something OTHER than footwear, even if
// the word "boot" appears (e.g. "Boot Graphic T-Shirt", "Bootcut Pants").
//
// These are the *fallback* rules used by `reclassifyMislabeledShoes`
// when the caller doesn't pass an explicit rule list AND when the
// editable rule cache from the database hasn't been populated yet (e.g.
// during the very first request after a cold boot, or in unit tests
// that exercise the function directly without touching the DB). The
// authoritative source of truth for production is the
// `recategorisation_rules` table — see `lib/recategorisationRules.ts`.
const NON_SHOE_HINTS: Array<{ re: RegExp; category: string }> = [
  { re: /\bbootcut\b|\bjeans?\b|\bdenim\b|\bpants?\b|\btrouser|\bleggings?\b|\bshorts?\b|\bskirt|\bskort/i, category: "bottoms" },
  { re: /\b(t[\s-]?shirt|tee|tees|sweatshirt|hoodie|blouse|cami|tank|crop\s?top|polo|shirt|top|graphic)\b/i, category: "tops" },
  { re: /\bdress(es)?\b|\bgown\b/i, category: "dresses" },
  { re: /\bjumpsuit|\bromper|\boveralls?\b/i, category: "jumpsuits" },
  { re: /\bjacket|\bcoat\b|\bblazer|\boutwear|\bouterwear|\bparka|\bcardigan/i, category: "outerwear" },
  { re: /\bsweater|\bknit\b|\bpullover/i, category: "sweaters" },
  { re: /\b(set|sets|two[\s-]?piece|2[\s-]?piece|3[\s-]?piece)\b/i, category: "sets" },
];

/**
 * Module-level injectable rule list used by `loadCatalog`. Tri-state
 * by design:
 *   - `null`  → DB-backed rules have not been loaded yet (very first
 *               boot before `ensureRecategorisationRulesLoaded`
 *               resolves, or unit tests that never touch the DB). We
 *               fall back to the hard-coded NON_SHOE_HINTS so the
 *               classifier still produces sane output during that
 *               narrow bootstrap window.
 *   - `[]`   → Admin has loaded the rules from the DB and the active
 *               set is intentionally empty (every rule disabled or
 *               deleted). We must respect that and skip recategorisation
 *               entirely — falling back to NON_SHOE_HINTS here would
 *               silently override the admin's choice.
 *   - `[…]`  → Use exactly these rules.
 *
 * Kept as a module-level binding (rather than read on every call to
 * `reclassifyMislabeledShoes`) so importing the rule module from this
 * file would create a circular dependency — instead the rules module
 * pushes its compiled rules in via `setActiveRecategorisationRules`.
 */
let activeRules: Array<{ re: RegExp; category: string }> | null = null;

/**
 * Replace the live rule list used by the next catalog reload. Called
 * by `recategorisationRules.ts` whenever the DB-backed rule cache is
 * loaded or invalidated. Pass an empty array to mean "no rules" — the
 * loader will skip recategorisation entirely. Pass `null` only to
 * reset to the not-loaded bootstrap state (used by tests). Pair with
 * `invalidateCatalog()` to force the already-built catalog to rebuild
 * with the new rules on the next `getAllProducts()` call.
 */
export function setActiveRecategorisationRules(
  rules: Array<{ re: RegExp; category: string }> | null,
): void {
  activeRules = rules;
}

/**
 * Audit record for a single auto-recategorisation, surfaced to the
 * admin so staff can spot-check the heuristic and revert false moves.
 */
export interface ReclassificationRecord {
  id: string;
  title: string;
  gender: Gender;
  originalCategory: string;
  newCategory: string;
  /** The non-shoe garment keyword that triggered the move (e.g.
   *  "t-shirt", "bootcut", "dress"). Null for the rare case where the
   *  category was changed without a hint capture. */
  matchedHint: string | null;
  /** ISO timestamp of when the record was captured (boot time). */
  observedAt: string;
}

// In-process scratch log of reclassifications observed by the most
// recent `reclassifyMislabeledShoes` run(s). The authoritative store
// is now the `reclassification_events` DB table — see
// `lib/reclassificationPersistence.ts` — but we still buffer the
// current load's records here so:
//   1. unit tests can assert on what fired without touching the DB;
//   2. `loadCatalog()` has a single batch to hand off to the persister
//      after the synchronous classification step completes.
// Bounded so a runaway catalog cannot balloon process memory.
const MAX_RECLASSIFICATION_RECORDS = 1000;
const reclassificationLog: ReclassificationRecord[] = [];

export function getReclassifications(): ReclassificationRecord[] {
  // Newest first so the admin UI can render "most recent" without
  // re-sorting on the client.
  return [...reclassificationLog].reverse();
}

/**
 * Test/seed helper — clears the audit log so unit tests don't carry
 * state between cases. Not part of the public storefront contract.
 */
export function _resetReclassificationLogForTests(): void {
  reclassificationLog.length = 0;
}

/**
 * Callback invoked once per `loadCatalog()` call with the records
 * captured during that load. Wired up by
 * `lib/reclassificationPersistence.ts` to upsert into the DB and prune
 * stale rows. Kept as a module-level setter (rather than a direct
 * import) to avoid a circular dep between catalog.ts and the
 * persistence module that depends on it.
 */
type ReclassificationPersister = (
  records: ReclassificationRecord[],
) => void | Promise<void>;
let persister: ReclassificationPersister | null = null;

export function setReclassificationPersister(
  fn: ReclassificationPersister | null,
): void {
  persister = fn;
}

/**
 * Some upstream rows are mis-tagged with `category: "shoes"` but are
 * actually apparel (e.g. "Boot Graphic T-Shirt", "Bootcut Pants"). We
 * keep a row in shoes ONLY if its title contains a real footwear
 * keyword AND no stronger garment signal — otherwise we move it to
 * the matching apparel bucket so the storefront's Shoes filter is clean.
 *
 * Mutates rows in place AND appends an audit record for each change so
 * staff can inspect the moves in the admin (see getReclassifications).
 */
export function reclassifyMislabeledShoes(
  rows: ProductRow[],
  rules: Array<{ re: RegExp; category: string }> = NON_SHOE_HINTS,
): void {
  for (const r of rows) {
    if (r.category !== "shoes") continue;
    const title = r.title ?? "";
    // Find the first non-shoe garment hint that matches the title.
    const garment = rules.find((h) => h.re.test(title));
    const hasShoeKeyword = SHOE_KEYWORDS.test(title);
    // If a garment hint matches and we don't see an unambiguous shoe
    // keyword (other than "boot", which is the source of the false
    // positives), move the row to the suggested category.
    if (garment) {
      // `boot` alone is ambiguous — treat as a shoe only when no
      // garment hint is present. Real footwear keywords (sneaker,
      // sandal, heel, …) override the garment hint and keep the row
      // in shoes.
      const allMatches = title.match(new RegExp(SHOE_KEYWORDS, "gi")) ?? [];
      const strongShoe = hasShoeKeyword && allMatches.some(
        (m) => !/^boot(s|ie|ies)?$/i.test(m),
      );
      if (strongShoe) continue;
      const hintMatch = title.match(garment.re);
      const matchedHint = hintMatch ? hintMatch[0] : null;
      const original = r.category;
      r.category = garment.category;
      if (reclassificationLog.length >= MAX_RECLASSIFICATION_RECORDS) {
        reclassificationLog.shift();
      }
      reclassificationLog.push({
        id: r.id,
        title,
        gender: r.gender,
        originalCategory: original,
        newCategory: garment.category,
        matchedHint,
        observedAt: new Date().toISOString(),
      });
    }
  }
}

function loadCatalog(): ProductRow[] {
  const women = loadOne("catalog_lite.json", "women");
  const men = loadOne("catalog_men_lite.json", "men");
  // Move mis-categorised "shoes" rows (e.g. "Boot Graphic T-Shirt")
  // into the right apparel bucket BEFORE bucket derivation so the
  // featured grids don't surface them under Shoes.
  // `activeRules === null` means the DB-backed rule cache hasn't loaded
  // yet — use the hard-coded defaults so we still produce sane output.
  // `activeRules === []` is a deliberate admin choice to disable every
  // rule and must be respected.
  const rulesToApply = activeRules ?? NON_SHOE_HINTS;
  if (rulesToApply.length > 0) {
    reclassifyMislabeledShoes(women, rulesToApply);
    reclassifyMislabeledShoes(men, rulesToApply);
  }
  // Synthesise the four merch buckets for both catalogs. The top-nav
  // tabs (New In / Collection / TikTok Verified / Trending) are
  // women-only, but the homepage featured grid filters by
  // tiktok_verified for whichever gender is active — so the men pool
  // also needs bucket flags or the men's edit grid renders empty.
  deriveBuckets(women);
  deriveBuckets(men);
  // Default sort: gender → category → title (stable, readable when paginated).
  const all = [...women, ...men];
  all.sort((a, b) => {
    if (a.gender !== b.gender) return a.gender === "women" ? -1 : 1;
    const ca = a.category ?? "";
    const cb = b.category ?? "";
    if (ca !== cb) return ca.localeCompare(cb);
    return a.title.localeCompare(b.title);
  });
  // Hand the freshly captured reclassification records to the
  // persister (DB upsert + prune). Always invoked — even with an
  // empty batch — so the 90-day prune still runs when a load produces
  // zero events (e.g. all rules disabled or upstream catalog cleaned
  // up). Fire-and-forget so a slow/failing DB write never blocks a
  // storefront request; errors are logged inside the persister.
  if (persister) {
    void Promise.resolve(persister([...reclassificationLog]));
  }
  return all;
}

let cache: ProductRow[] | null = null;

export function getAllProducts(): ProductRow[] {
  if (cache === null) {
    cache = loadCatalog();
  }
  return cache;
}

/**
 * Drop the cached catalog so the next `getAllProducts()` call rebuilds
 * from disk and re-runs `reclassifyMislabeledShoes` against whatever
 * rule set is currently installed via `setActiveRecategorisationRules`.
 * Also clears the in-memory reclassification audit log so the admin
 * panel reflects only the moves produced by the new rule set.
 */
export function invalidateCatalog(): void {
  cache = null;
  reclassificationLog.length = 0;
}

export function getProductById(id: string): ProductRow | null {
  return getAllProducts().find((p) => p.id === id) ?? null;
}
