#!/usr/bin/env python3
"""Build the Men catalog from Trendsi (modeled on extract-women.py).

This is the thin men-specific entry point that pulls the segmented
men listing via the Trendsi `home-product` fallback (which works
without the strict `/api/store/list` referer headers) and writes a
snapshot to `data/trendsi-extract/men_catalog.json`.

The shipping catalog file (`data/catalog_men_lite.json`) and R2
images are produced by the downstream `merge-trendsi-extracts.mjs`
script, which consumes this snapshot together with `shoes_catalog.json`
and `swimwear_catalog.json`.

Credentials (NEVER commit these — they're env-only):
    TRENDSI_ACCESS_TOKEN  — Access-Token header
    TRENDSI_COOKIE        — full Cookie header
    TRENDSI_SHOP_ID       — numeric shop id
    TRENDSI_DEVICE_ID     — optional, defaults to 0

Usage:
    python3 artifacts/api-server/scripts/extract-men.py

After this completes, run the merge to upload images to R2 and
update the runtime catalog:
    node artifacts/api-server/scripts/merge-trendsi-extracts.mjs
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "trendsi-extract"
OUT_PATH = OUT_DIR / "men_catalog.json"

API = "https://api.trendsi.com"
HOME_PRODUCT = "/api/product/v2/home-product"

# Heuristic men keywords (Trendsi home-product returns mixed inventory;
# we filter to the men's segment after the pull).
MEN_KEYWORDS = (
    "men's",
    "mens ",
    " men ",
    "for men",
    "male ",
    "guys",
)

SUBCATEGORY_RULES = [
    ("denim", ("denim", "jeans")),
    ("shorts", ("short",)),
    ("bottoms", ("pant", "trouser", "cargo", "joggers", "sweatpant")),
    ("outerwear", ("jacket", "coat", "blazer", "vest", "parka")),
    ("sweaters", ("sweater", "hoodie", "knit", "cardigan", "pullover")),
    ("shoes", ("shoe", "boot", "sneaker", "loafer", "sandal")),
    ("tops", ("tee", "shirt", "polo", "tank", "top")),
]


def classify(title: str) -> str:
    t = title.lower()
    for cat, kws in SUBCATEGORY_RULES:
        if any(k in t for k in kws):
            return cat
    return "other"


def is_mens(title: str) -> bool:
    t = title.lower()
    return any(k in t for k in MEN_KEYWORDS)


def main() -> int:
    token = os.environ.get("TRENDSI_ACCESS_TOKEN")
    cookie = os.environ.get("TRENDSI_COOKIE")
    shop_id = os.environ.get("TRENDSI_SHOP_ID")
    device_id = os.environ.get("TRENDSI_DEVICE_ID", "0")
    if not token or not cookie or not shop_id:
        sys.stderr.write(
            "Missing TRENDSI_ACCESS_TOKEN / TRENDSI_COOKIE / TRENDSI_SHOP_ID\n",
        )
        return 1

    headers = {
        "Access-Token": token,
        "Cookie": cookie,
        "ShopID": shop_id,
        "DeviceID": device_id,
        "User-Agent": "Mozilla/5.0",
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    raw_products: list[dict] = []
    page = 1
    page_size = 50
    while True:
        params = {"page": page, "page_size": page_size}
        r = requests.get(
            API + HOME_PRODUCT, headers=headers, params=params, timeout=30
        )
        r.raise_for_status()
        body = r.json()
        items = body.get("data", {}).get("list") or body.get("data", []) or []
        if not items:
            break
        raw_products.extend(items)
        sys.stdout.write(f"page {page}: +{len(items)} (total {len(raw_products)})\n")
        if len(items) < page_size:
            break
        page += 1
        time.sleep(0.4)

    by_sub: dict[str, list[dict]] = defaultdict(list)
    seen: set[str] = set()
    for p in raw_products:
        title = p.get("title") or p.get("name") or ""
        if not is_mens(title):
            continue
        pid = str(p.get("id") or p.get("product_id") or "")
        if not pid or pid in seen:
            continue
        seen.add(pid)
        sub = classify(title)
        main_image = p.get("main_image") or p.get("image") or ""
        alt_image = p.get("alt_image") or p.get("hover_image") or ""
        price = p.get("price") or p.get("sale_price") or 0
        by_sub[sub].append(
            {
                "id": pid,
                "title": title,
                "price": price,
                "main_image": main_image,
                "alt_image": alt_image,
            }
        )

    out = {
        "summary": {
            "segment": "men",
            "source_endpoint": "home-product",
            "raw_products": len(raw_products),
            "filtered_products": sum(len(v) for v in by_sub.values()),
            "subcategories": {k: len(v) for k, v in sorted(by_sub.items())},
        },
        "items_by_subcategory": dict(sorted(by_sub.items())),
    }
    OUT_PATH.write_text(json.dumps(out, indent=2))
    sys.stdout.write(f"wrote {OUT_PATH}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
