import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  reclassifyMislabeledShoes,
  getReclassifications,
  _resetReclassificationLogForTests,
  setActiveRecategorisationRules,
  type ProductRow,
  type ReclassificationRule,
} from "./catalog.ts";

function makeRow(id: string, title: string, category: string): ProductRow {
  return {
    id,
    title,
    category,
    subCategory: null,
    price: "0.00",
    imageUrls: [],
    sizes: [],
    colors: [],
    gender: "women",
    isNewIn: false,
    isCollection: false,
    isTikTokVerified: false,
    isTrending: false,
    trendScore: 0,
    buckets: [],
  };
}

describe("reclassifyMislabeledShoes", () => {
  it("moves Boot Graphic T-Shirt out of shoes into tops", () => {
    const rows = [makeRow("1", "Boot Graphic T-Shirt", "shoes")];
    reclassifyMislabeledShoes(rows);
    assert.equal(rows[0]!.category, "tops");
  });

  it("moves Bootcut Pants out of shoes into bottoms", () => {
    const rows = [makeRow("2", "Bootcut Pants", "shoes")];
    reclassifyMislabeledShoes(rows);
    assert.equal(rows[0]!.category, "bottoms");
  });

  it("keeps real ankle boots in shoes", () => {
    const rows = [
      makeRow("3", "Ankle Boots Black Leather", "shoes"),
      makeRow("4", "Heeled Sandals", "shoes"),
      makeRow("5", "White Sneakers", "shoes"),
    ];
    reclassifyMislabeledShoes(rows);
    for (const r of rows) assert.equal(r.category, "shoes");
  });

  it("does not touch rows that are not in shoes to start with", () => {
    const rows = [makeRow("6", "Boot Graphic T-Shirt", "tops")];
    reclassifyMislabeledShoes(rows);
    assert.equal(rows[0]!.category, "tops");
  });

  it("classifies Boot Print Hoodie as tops", () => {
    const rows = [makeRow("7", "Boot Print Hoodie", "shoes")];
    reclassifyMislabeledShoes(rows);
    assert.equal(rows[0]!.category, "tops");
  });

  it("classifies a dress mistakenly tagged shoes", () => {
    const rows = [makeRow("8", "Mini Dress with Boot Print", "shoes")];
    reclassifyMislabeledShoes(rows);
    assert.equal(rows[0]!.category, "dresses");
  });

  it("keeps mixed-token boot+sandal titles in shoes (precedence)", () => {
    const rows = [
      makeRow("9", "Boot and Sandal Combo", "shoes"),
      makeRow("10", "Bootie + Sneaker Pack", "shoes"),
    ];
    reclassifyMislabeledShoes(rows);
    for (const r of rows) assert.equal(r.category, "shoes");
  });
});

describe("reclassifyMislabeledShoes audit log", () => {
  it("captures one record per moved row, with hint and original category", () => {
    _resetReclassificationLogForTests();
    const rows = [
      makeRow("audit-1", "Boot Graphic T-Shirt", "shoes"),
      makeRow("audit-2", "Bootcut Pants", "shoes"),
      makeRow("audit-3", "Ankle Boots Black Leather", "shoes"), // stays
    ];
    reclassifyMislabeledShoes(rows);
    const log = getReclassifications();
    assert.equal(log.length, 2);
    const byId = new Map(log.map((r) => [r.id, r]));
    const tee = byId.get("audit-1")!;
    assert.equal(tee.originalCategory, "shoes");
    assert.equal(tee.newCategory, "tops");
    assert.ok(tee.matchedHint, "expected a matchedHint to be captured");
    const pants = byId.get("audit-2")!;
    assert.equal(pants.newCategory, "bottoms");
    assert.ok(pants.observedAt);
  });

  it("does not record anything for rows that stay in shoes", () => {
    _resetReclassificationLogForTests();
    reclassifyMislabeledShoes([
      makeRow("only-shoe", "White Sneakers", "shoes"),
    ]);
    assert.equal(getReclassifications().length, 0);
  });

  it("captures rule id + label when a DB-backed rule fires", () => {
    _resetReclassificationLogForTests();
    const rules = [
      {
        id: 42,
        label: "Tops (custom)",
        re: /\b(t-shirt|tee|hoodie|graphic)\b/i,
        category: "tops",
      },
    ];
    reclassifyMislabeledShoes(
      [makeRow("rule-1", "Boot Graphic T-Shirt", "shoes")],
      rules,
    );
    const log = getReclassifications();
    assert.equal(log.length, 1);
    assert.equal(log[0]!.ruleId, 42);
    assert.equal(log[0]!.ruleLabel, "Tops (custom)");
  });

  it("falls back to null rule id/label when bootstrap defaults fire", () => {
    _resetReclassificationLogForTests();
    reclassifyMislabeledShoes([makeRow("rule-2", "Bootcut Pants", "shoes")]);
    const log = getReclassifications();
    assert.equal(log.length, 1);
    assert.equal(log[0]!.ruleId, null);
    assert.equal(log[0]!.ruleLabel, null);
  });
});

describe("reclassifyMislabeledShoes with an injected custom rule set", () => {
  // Verifies the data-driven rule path: an admin who pushes a brand-new
  // rule (one whose target_category isn't in the legacy NON_SHOE_HINTS
  // list) gets products moved to that fresh target. This is the exact
  // contract that backs the editable rules admin UI.
  it("moves a shoes-tagged product to the rule's bespoke target category", () => {
    _resetReclassificationLogForTests();
    const customRules: ReclassificationRule[] = [
      {
        id: 999,
        label: "Swimwear (custom admin rule)",
        re: /\b(bikini|swimsuit|one[-\s]?piece|swimwear)\b/i,
        category: "swimwear",
      },
    ];
    const rows = [
      makeRow("custom-1", "Tropical Print Bikini", "shoes"),
      // Untouched — no custom rule matches and the legacy defaults
      // aren't in play because we passed an explicit rule list.
      makeRow("custom-2", "White Sneakers", "shoes"),
    ];
    reclassifyMislabeledShoes(rows, customRules);
    assert.equal(rows[0]!.category, "swimwear");
    assert.equal(rows[1]!.category, "shoes");
    const log = getReclassifications();
    assert.equal(log.length, 1);
    assert.equal(log[0]!.id, "custom-1");
    assert.equal(log[0]!.newCategory, "swimwear");
    assert.equal(log[0]!.ruleId, 999);
    assert.equal(log[0]!.ruleLabel, "Swimwear (custom admin rule)");
  });

  it("respects an empty rule set wired through setActiveRecategorisationRules (no moves)", () => {
    // Mirrors the production code path: when the admin disables every
    // rule, the rules module pushes `[]` into catalog via
    // setActiveRecategorisationRules, and the loader must skip
    // recategorisation entirely. We exercise the mutation here so a
    // future refactor that drops/renames the setter trips this test.
    _resetReclassificationLogForTests();
    setActiveRecategorisationRules([]);
    try {
      // Even a title that the bootstrap defaults WOULD have moved
      // ("Boot Graphic T-Shirt" → tops) must stay put when an empty
      // rule list is explicitly applied.
      const rows = [makeRow("empty-1", "Boot Graphic T-Shirt", "shoes")];
      reclassifyMislabeledShoes(rows, []);
      assert.equal(rows[0]!.category, "shoes");
      assert.equal(getReclassifications().length, 0);
    } finally {
      setActiveRecategorisationRules(null);
    }
  });
});
