import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import {
  db,
  recategorisationRulesTable,
  recategorisationRulesMetaTable,
  type RecategorisationRule,
} from "@workspace/db";
import {
  DEFAULT_RECATEGORISATION_RULES,
  compileRule,
  ensureRecategorisationRulesLoaded,
  getCompiledRulesSync,
  invalidateRecategorisationRules,
  _resetRecategorisationRulesCacheForTests,
} from "./recategorisationRules.ts";
import {
  setActiveRecategorisationRules,
  invalidateCatalog,
} from "./catalog.ts";

/** Wipe both rule tables so seeding-related assertions start from a
 *  known empty state. Keeps each test independent of the DB's prior
 *  contents (this DB is shared across the test runner). */
async function resetRulesTables(): Promise<void> {
  await db.delete(recategorisationRulesTable);
  await db.delete(recategorisationRulesMetaTable);
}

function makeRow(overrides: Partial<RecategorisationRule> = {}): RecategorisationRule {
  const now = new Date();
  return {
    id: 1,
    label: "Test rule",
    pattern: "\\bdress\\b",
    targetCategory: "dresses",
    enabled: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("compileRule", () => {
  it("compiles a valid pattern into a case-insensitive RegExp", () => {
    const compiled = compileRule(makeRow({ pattern: "\\btee\\b" }));
    assert.ok(compiled);
    assert.equal(compiled.label, "Test rule");
    assert.equal(compiled.pattern, "\\btee\\b");
    assert.equal(compiled.category, "dresses");
    assert.equal(compiled.re.flags.includes("i"), true);
    assert.equal(compiled.re.test("Graphic TEE"), true);
  });

  it("returns null for an invalid regex pattern instead of throwing", () => {
    const compiled = compileRule(makeRow({ pattern: "(unclosed" }));
    assert.equal(compiled, null);
  });
});

describe("ensureRecategorisationRulesLoaded", () => {
  before(async () => {
    await resetRulesTables();
  });

  beforeEach(async () => {
    _resetRecategorisationRulesCacheForTests();
    setActiveRecategorisationRules(null);
    invalidateCatalog();
    await resetRulesTables();
  });

  after(async () => {
    _resetRecategorisationRulesCacheForTests();
    setActiveRecategorisationRules(null);
    invalidateCatalog();
    await resetRulesTables();
  });

  it("seeds the default rule set on the very first load against an empty table", async () => {
    const before = await db.select().from(recategorisationRulesTable);
    assert.equal(before.length, 0);

    const compiled = await ensureRecategorisationRulesLoaded();

    const rows = await db.select().from(recategorisationRulesTable);
    assert.equal(rows.length, DEFAULT_RECATEGORISATION_RULES.length);
    // Every default label should be present in the DB.
    const labels = new Set(rows.map((r) => r.label));
    for (const d of DEFAULT_RECATEGORISATION_RULES) {
      assert.ok(labels.has(d.label), `expected default label "${d.label}" to be seeded`);
    }
    // Compiled cache mirrors the seeded rows (all enabled).
    assert.equal(compiled.length, DEFAULT_RECATEGORISATION_RULES.length);
    // The meta singleton was inserted, so subsequent loads won't re-seed.
    const meta = await db.select().from(recategorisationRulesMetaTable);
    assert.equal(meta.length, 1);
  });

  it("does NOT re-seed defaults after staff have intentionally deleted every rule", async () => {
    // Seed once.
    await ensureRecategorisationRulesLoaded();
    // Staff wipes the table (legitimate "no auto-recategorisation" choice).
    await db.delete(recategorisationRulesTable);
    _resetRecategorisationRulesCacheForTests();
    setActiveRecategorisationRules(null);

    const compiled = await ensureRecategorisationRulesLoaded();

    const rows = await db.select().from(recategorisationRulesTable);
    assert.equal(rows.length, 0, "must not silently re-seed defaults");
    assert.equal(compiled.length, 0);
  });

  it("compiles only enabled rules into the active cache, ignoring disabled ones", async () => {
    await db.insert(recategorisationRulesTable).values([
      {
        label: "Enabled tops",
        pattern: "\\btee\\b",
        targetCategory: "tops",
        enabled: true,
        sortOrder: 0,
      },
      {
        label: "Disabled bottoms",
        pattern: "\\bjeans?\\b",
        targetCategory: "bottoms",
        enabled: false,
        sortOrder: 1,
      },
    ]);
    // Mark seeded so the loader doesn't try to insert defaults on top.
    await db
      .insert(recategorisationRulesMetaTable)
      .values({ id: 1 })
      .onConflictDoNothing();

    const compiled = await ensureRecategorisationRulesLoaded();

    assert.equal(compiled.length, 1, "disabled rule must be excluded");
    assert.equal(compiled[0]!.label, "Enabled tops");
    assert.equal(compiled[0]!.category, "tops");
  });

  it("skips rows whose stored pattern fails to compile, instead of aborting the load", async () => {
    await db.insert(recategorisationRulesTable).values([
      {
        label: "Good",
        pattern: "\\bdress\\b",
        targetCategory: "dresses",
        enabled: true,
        sortOrder: 0,
      },
      {
        label: "Broken",
        pattern: "(unclosed",
        targetCategory: "tops",
        enabled: true,
        sortOrder: 1,
      },
    ]);
    await db
      .insert(recategorisationRulesMetaTable)
      .values({ id: 1 })
      .onConflictDoNothing();

    const compiled = await ensureRecategorisationRulesLoaded();
    const labels = compiled.map((r) => r.label);
    assert.deepEqual(labels, ["Good"]);
  });

  it("is idempotent: a second call returns the cached array without re-querying defaults", async () => {
    await ensureRecategorisationRulesLoaded();
    const first = getCompiledRulesSync();
    assert.ok(first);
    // Mutate the DB directly — without an explicit invalidate, the cache
    // must keep returning the previously-loaded set.
    await db
      .update(recategorisationRulesTable)
      .set({ enabled: false })
      .where(eq(recategorisationRulesTable.enabled, true));

    const second = await ensureRecategorisationRulesLoaded();
    assert.equal(second, first, "expected the cached array reference to be returned");
    assert.equal(second.length, DEFAULT_RECATEGORISATION_RULES.length);
  });
});

describe("invalidateRecategorisationRules", () => {
  beforeEach(async () => {
    _resetRecategorisationRulesCacheForTests();
    setActiveRecategorisationRules(null);
    invalidateCatalog();
    await resetRulesTables();
  });

  after(async () => {
    _resetRecategorisationRulesCacheForTests();
    setActiveRecategorisationRules(null);
    invalidateCatalog();
    await resetRulesTables();
  });

  it("forces the next ensureRecategorisationRulesLoaded() to re-query the database", async () => {
    await ensureRecategorisationRulesLoaded();
    const initial = getCompiledRulesSync();
    assert.ok(initial);
    const initialCount = initial.length;

    // Disable every seeded rule, then invalidate. The next load must
    // reflect the change (i.e. produce an empty active set).
    await db
      .update(recategorisationRulesTable)
      .set({ enabled: false });

    invalidateRecategorisationRules();
    assert.equal(getCompiledRulesSync(), null, "cache should drop to null after invalidation");

    const reloaded = await ensureRecategorisationRulesLoaded();
    assert.equal(reloaded.length, 0);
    assert.notEqual(reloaded.length, initialCount);
  });
});
