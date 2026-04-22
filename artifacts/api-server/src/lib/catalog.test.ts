import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { reclassifyMislabeledShoes, type ProductRow } from "./catalog.ts";

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
