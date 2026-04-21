#!/usr/bin/env python3
"""Build a Women catalog from Trendsi Category/All with bucketed outputs and WebP images.

Credentials
-----------
Trendsi requires a logged-in session token + cookie. They are NOT
committed to this repo. Provide them at run time via environment
variables (preferred) or CLI flags:

    export TRENDSI_ACCESS_TOKEN=...   # value of the Access-Token header
    export TRENDSI_COOKIE=...         # full Cookie header value
    export TRENDSI_SHOP_ID=...        # numeric shop id from the cookie
    export TRENDSI_DEVICE_ID=...      # optional; defaults to 0
    # Optional, only if you need TikTok-Verified scraping:
    export TRENDSI_TIKTOK_STORE_REFERER=...
    export TRENDSI_TIKTOK_HOME_REFERER=...
    python3 artifacts/api-server/scripts/extract-women.py

To capture a fresh set, open trendsi.com in a logged-in browser, copy
the values from any /api/store/list or /api/product/v2/home-product
request via DevTools "Copy as cURL", and feed them into the env vars
above. If a captured token expires, the script logs the upstream's
"refresh credentials" sentinel (HTTP 200 with total:0).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
from PIL import Image, ImageFile, UnidentifiedImageError
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


ImageFile.LOAD_TRUNCATED_IMAGES = True

API_URL_STORE_LIST = "https://www.trendsi.com/api/store/list"
API_URL_HOME_PRODUCT = "https://www.trendsi.com/api/product/v2/home-product"

COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Content-Type": "application/json",
    "platform": "2",
    "os": "3",
    "version": "V1.2.9",
    "shippingTo": "1",
    "currency": "USD",
    "timezone": "-180",
    "Origin": "https://www.trendsi.com",
    "DNT": "1",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}

CATEGORY_RULES: dict[str, list[str]] = {
    "activewear": ["active", "athletic", "yoga", "workout", "gym", "sport", "running", "training"],
    "basics": ["basic", "everyday", "essential"],
    "bottoms": ["pants", "trouser", "legging", "jogger", "bottom", "skirt", "sweatpant"],
    "denim": ["denim", "jean", "jeans"],
    "dresses": ["dress", "midi", "mini", "maxi", "gown"],
    "formal": ["formal", "evening", "cocktail", "party", "wedding", "bridal", "office"],
    "intimates": ["bra", "panty", "lingerie", "underwear", "intimate", "shapewear"],
    "jumpsuits": ["jumpsuit", "romper", "overall"],
    "knitwear": ["knit", "sweater", "cardigan", "pullover"],
    "loungewear": ["lounge", "sleepwear", "pajama", "homewear"],
    "maternity": ["maternity", "pregnancy", "pregnant"],
    "outerwear": ["coat", "jacket", "blazer", "parka", "trench", "vest"],
    "plus-size": ["plus size", "curve", "curvy"],
    "sets": ["set", "two-piece", "2 piece", "matching set"],
    "shoes": ["shoe", "sneaker", "heel", "sandal", "boot", "loafer", "flat", "slipper"],
    "swimwear": ["swim", "bikini", "one-piece", "beachwear", "tankini", "cover-up"],
    "tops": ["top", "shirt", "blouse", "tee", "tank", "cami", "bodysuit", "hoodie", "sweatshirt"],
}

ALLOWED_WOMEN_CATEGORIES = set(CATEGORY_RULES.keys())
MERCH_BUCKETS = ("new_in", "collection", "tiktok_verified", "trending")


@dataclass
class StyleItem:
    id: str
    title: str
    price: float
    women_category: str
    image_candidates: list[tuple[str, str | None]]
    is_new: bool
    is_tiktok: bool
    trend_score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="catalog/replit_lite")
    parser.add_argument(
        "--source-mode",
        choices=("auto", "store-list", "home-product"),
        default="auto",
        help="auto tries store-list first, then falls back to home-product.",
    )
    parser.add_argument("--per-category", type=int, default=2_500)
    parser.add_argument("--max-total-gb", type=float, default=5.0)
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--timeout", type=int, default=35)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--max-pages", type=int, default=1_000)
    parser.add_argument("--webp-quality", type=int, default=84)
    parser.add_argument("--webp-method", type=int, default=6)
    parser.add_argument("--save-every", type=int, default=200)
    parser.add_argument("--no-clean-output", action="store_false", dest="clean_output")

    parser.add_argument(
        "--access-token",
        default=os.environ.get("TRENDSI_ACCESS_TOKEN"),
        help="Trendsi Access-Token header. Defaults to $TRENDSI_ACCESS_TOKEN.",
    )
    parser.add_argument(
        "--cookie",
        default=os.environ.get("TRENDSI_COOKIE"),
        help="Trendsi Cookie header. Defaults to $TRENDSI_COOKIE.",
    )
    parser.add_argument("--referer", default="https://www.trendsi.com/classify/Category/All")
    parser.add_argument(
        "--device-id",
        type=int,
        default=int(os.environ.get("TRENDSI_DEVICE_ID", "0")),
    )
    parser.add_argument("--channel", type=int, default=3)
    parser.add_argument(
        "--shop-id",
        default=os.environ.get("TRENDSI_SHOP_ID"),
        help="Trendsi numeric shop id. Defaults to $TRENDSI_SHOP_ID.",
    )
    parser.add_argument("--store-page-size", type=int, default=100)
    parser.add_argument("--home-page-size", type=int, default=90)
    parser.add_argument("--home-name", default="Women")
    parser.add_argument("--home-category-nav-id", type=int, default=0)
    parser.add_argument("--home-nav-level", type=int, default=0)
    parser.add_argument(
        "--tiktok-store-referer",
        default=os.environ.get("TRENDSI_TIKTOK_STORE_REFERER", ""),
    )
    parser.add_argument(
        "--tiktok-home-referer",
        default=os.environ.get("TRENDSI_TIKTOK_HOME_REFERER", ""),
    )
    parser.add_argument("--tiktok-home-name", default="TikTok Verified")
    parser.add_argument("--tiktok-home-category-nav-id", type=int, default=5324)
    parser.add_argument("--tiktok-home-nav-level", type=int, default=2)
    parser.add_argument("--tiktok-home-page-size", type=int, default=90)
    parser.add_argument("--tiktok-store-page-size", type=int, default=100)
    parser.add_argument("--tiktok-max-pages", type=int, default=200)

    parser.add_argument("--min-delay", type=float, default=2.5)
    parser.add_argument("--max-delay", type=float, default=5.5)
    parser.set_defaults(clean_output=True)
    args = parser.parse_args()

    missing = [
        name
        for name, value in (
            ("--access-token / TRENDSI_ACCESS_TOKEN", args.access_token),
            ("--cookie / TRENDSI_COOKIE", args.cookie),
            ("--shop-id / TRENDSI_SHOP_ID", args.shop_id),
        )
        if not value
    ]
    if missing:
        sys.stderr.write(
            "ERROR: Missing required Trendsi credentials: "
            + ", ".join(missing)
            + "\nSee the docstring at the top of this script for how to provide them.\n"
        )
        sys.exit(2)
    return args


def build_store_headers(args: argparse.Namespace) -> dict[str, str]:
    headers = dict(COMMON_HEADERS)
    headers["Alt-Used"] = "www.trendsi.com"
    headers["Access-Token"] = args.access_token
    headers["Referer"] = args.referer
    headers["Cookie"] = args.cookie
    headers["TE"] = "trailers"
    return headers


def build_home_headers(args: argparse.Namespace) -> dict[str, str]:
    headers = dict(COMMON_HEADERS)
    headers["Alt-Used"] = "www.trendsi.com"
    headers["Access-Token"] = args.access_token
    headers["Referer"] = args.referer
    headers["Cookie"] = args.cookie
    headers["TE"] = "trailers"
    return headers


def build_tiktok_store_headers(args: argparse.Namespace) -> dict[str, str]:
    headers = dict(COMMON_HEADERS)
    headers["Access-Token"] = args.access_token
    headers["Referer"] = args.tiktok_store_referer
    headers["Cookie"] = args.cookie
    headers["Alt-Used"] = "www.trendsi.com"
    headers["TE"] = "trailers"
    return headers


def build_tiktok_home_headers(args: argparse.Namespace) -> dict[str, str]:
    headers = dict(COMMON_HEADERS)
    headers["Access-Token"] = args.access_token
    headers["Referer"] = args.tiktok_home_referer
    headers["Cookie"] = args.cookie
    headers["TE"] = "trailers"
    return headers


def build_store_payload(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "curPage": 1,
        "pageSize": args.store_page_size,  # forced small page size to reduce ban risk
        "device_id": args.device_id,
        "channel": args.channel,
        "shopId": str(args.shop_id),
    }


def build_home_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "curPage": 1,
        "pageSize": args.home_page_size,
        "name": args.home_name,
        "shopId": int(args.shop_id),
        "channel": args.channel,
    }
    if args.home_category_nav_id > 0:
        payload["categoryNavId"] = args.home_category_nav_id
    if args.home_nav_level > 0:
        payload["navLevel"] = args.home_nav_level
    return payload


def build_tiktok_store_payload(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "curPage": 1,
        "pageSize": args.tiktok_store_page_size,
        "device_id": args.device_id,
        "channel": args.channel,
        "shopId": str(args.shop_id),
    }


def build_tiktok_home_payload(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "curPage": 1,
        "pageSize": args.tiktok_home_page_size,
        "name": args.tiktok_home_name,
        "categoryNavId": args.tiktok_home_category_nav_id,
        "navLevel": args.tiktok_home_nav_level,
        "shopId": int(args.shop_id),
        "channel": args.channel,
    }


def build_session(retries: int, pool_size: int, headers: dict[str, str]) -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=retries,
        read=retries,
        connect=retries,
        backoff_factor=1.0,
        status_forcelist=(429, 502, 503, 504),
        allowed_methods=frozenset({"GET", "POST"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=pool_size, pool_maxsize=pool_size)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update(headers)
    return session


def try_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def flatten_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        cleaned = value.strip()
        return [cleaned] if cleaned else []
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(flatten_strings(item))
        return out
    if isinstance(value, dict):
        out: list[str] = []
        for field in ("name", "title", "label", "path", "slug", "category_name", "color"):
            out.extend(flatten_strings(value.get(field)))
        return out
    return []


def first_url(value: Any) -> str:
    if isinstance(value, str):
        clean = value.strip()
        if clean.startswith(("http://", "https://")):
            return clean
        return ""
    if isinstance(value, list):
        for item in value:
            found = first_url(item)
            if found:
                return found
    if isinstance(value, dict):
        for key in ("url", "src", "image", "imageUrl", "img", "imgUrl", "origin", "iconImage"):
            found = first_url(value.get(key))
            if found:
                return found
    return ""


def normalize_color(color_value: Any) -> str | None:
    if not isinstance(color_value, str):
        return None
    color = color_value.strip()
    return color or None


def collect_image_candidates(style: dict[str, Any]) -> list[tuple[str, str | None]]:
    candidates: list[tuple[str, str | None]] = []
    seen: set[str] = set()

    def add_candidate(url_value: Any, color: str | None = None) -> None:
        url = first_url(url_value)
        if not url or url in seen:
            return
        seen.add(url)
        candidates.append((url, color))

    color_list = style.get("colorList") or []
    if isinstance(color_list, list):
        for color_item in color_list:
            if not isinstance(color_item, dict):
                continue
            color = normalize_color(color_item.get("color"))
            add_candidate(color_item.get("iconImage"), color)
            add_candidate(color_item.get("image"), color)
            add_candidate(color_item.get("headImage"), color)
            add_candidate(color_item.get("mainImage"), color)

    for key in ("mainImage", "mainImageUrl", "headImage", "image", "imageUrl", "cover", "coverUrl", "img"):
        add_candidate(style.get(key))

    for key in ("all_images", "images", "imageList", "gallery", "picList"):
        value = style.get(key)
        if isinstance(value, list):
            for item in value:
                add_candidate(item)
        else:
            add_candidate(value)

    sku_list = style.get("skuList") or style.get("skus") or []
    if isinstance(sku_list, dict):
        sku_list = [sku_list]
    if isinstance(sku_list, list):
        for sku in sku_list:
            if not isinstance(sku, dict):
                continue
            add_candidate(sku.get("image"))
            add_candidate(sku.get("imageUrl"))
            add_candidate(sku.get("imgUrl"))

    return candidates


def pick_two_images(candidates: list[tuple[str, str | None]]) -> list[tuple[str, str | None]]:
    if not candidates:
        return []
    first = candidates[0]
    second: tuple[str, str | None] | None = None

    first_color = (first[1] or "").lower()
    if first_color:
        for candidate in candidates[1:]:
            if candidate[0] == first[0]:
                continue
            other_color = (candidate[1] or "").lower()
            if other_color and other_color != first_color:
                second = candidate
                break

    if second is None:
        for candidate in candidates[1:]:
            if candidate[0] != first[0]:
                second = candidate
                break

    return [first] + ([second] if second else [])


def infer_category(title: str, category_tokens: list[str]) -> str:
    source = f"{title} {' '.join(category_tokens)}".lower()
    for category, words in CATEGORY_RULES.items():
        if any(word in source for word in words):
            return category
    return "other"


def find_item_list(payload: Any) -> list[dict[str, Any]]:
    candidate_paths = [
        ("data", "list"),
        ("data", "items"),
        ("data", "records"),
        ("result",),
        ("list",),
        ("items",),
        ("records",),
    ]
    for path in candidate_paths:
        node = payload
        ok = True
        for key in path:
            if not isinstance(node, dict) or key not in node:
                ok = False
                break
            node = node[key]
        if ok and isinstance(node, list) and node and isinstance(node[0], dict):
            return node
    return []


def parse_numeric_id(value: str) -> int:
    match = re.search(r"\d+", value)
    if not match:
        return 0
    try:
        return int(match.group(0))
    except ValueError:
        return 0


def normalize_style(style: dict[str, Any], index: int) -> StyleItem | None:
    style_id = str(
        style.get("style_id")
        or style.get("product_code")
        or style.get("id")
        or f"style-{index+1}"
    ).strip()
    if not style_id:
        return None

    title = str(style.get("title") or style.get("name") or "").strip()
    if not title:
        return None

    image_candidates = collect_image_candidates(style)
    if not image_candidates:
        return None

    price = try_float(
        style.get("base_price"),
        try_float(
            style.get("price"),
            try_float(
                style.get("minPrice"),
                try_float(style.get("minPriceB"), try_float(style.get("wholesalePrice"), 0.0)),
            ),
        ),
    )
    category_tokens = (
        flatten_strings(style.get("categories"))
        + flatten_strings(style.get("category"))
        + flatten_strings(style.get("type"))
        + flatten_strings(style.get("subTitle"))
        + flatten_strings(style.get("brand"))
        + flatten_strings(style.get("colorList"))
    )
    women_category = infer_category(title, category_tokens)
    if women_category not in ALLOWED_WOMEN_CATEGORIES:
        return None

    is_new = "new" in str(style.get("tagName") or "").lower() or str(style.get("tagType")) == "1"
    is_tiktok = bool(style.get("exprtedToTiktok") is True)
    trend_score = max(
        try_float(style.get("maxEarn"), 0.0),
        try_float(style.get("sold"), 0.0),
        try_float(style.get("wholesalePriceMax"), 0.0),
    )

    return StyleItem(
        id=style_id,
        title=title,
        price=price,
        women_category=women_category,
        image_candidates=image_candidates,
        is_new=is_new,
        is_tiktok=is_tiktok,
        trend_score=trend_score,
    )


def fetch_catalog_styles(
    session: requests.Session,
    api_url: str,
    source_name: str,
    base_payload: dict[str, Any],
    timeout: int,
    max_pages: int,
    min_delay: float,
    max_delay: float,
) -> list[StyleItem]:
    styles_by_id: dict[str, StyleItem] = {}
    page = 1

    while page <= max_pages:
        payload = dict(base_payload)
        payload["curPage"] = page
        try:
            response = session.post(api_url, json=payload, timeout=timeout)
            status = response.status_code
            if status in (403, 500):
                print(f"[{source_name}] Stopping on HTTP {status} at page {page}")
                break
            if status >= 400:
                print(f"[{source_name}] Stopping on HTTP {status} at page {page}")
                break

            body = response.json()
            items = find_item_list(body)
            if not items:
                if page == 1:
                    code = body.get("code") if isinstance(body, dict) else None
                    page_meta = body.get("page") if isinstance(body, dict) else {}
                    total = page_meta.get("total") if isinstance(page_meta, dict) else None
                    print(
                        f"[{source_name}] Page 1 returned no items. API code={code} total={total}. "
                        "If this persists, refresh token/cookie from browser cURL."
                    )
                print(f"[{source_name}] No items on page {page}, stopping.")
                break

            added = 0
            for idx, raw in enumerate(items):
                if not isinstance(raw, dict):
                    continue
                normalized = normalize_style(raw, idx)
                if normalized is None or normalized.id in styles_by_id:
                    continue
                styles_by_id[normalized.id] = normalized
                added += 1

            print(
                f"[{source_name}] Page {page}: received={len(items)} "
                f"added_unique={added} total_unique={len(styles_by_id)}",
                flush=True,
            )
            page += 1
            time.sleep(random.uniform(min_delay, max_delay))
        except (requests.RequestException, json.JSONDecodeError) as exc:
            print(f"[{source_name}] Network/JSON error on page {page}: {exc}")
            break

    return list(styles_by_id.values())


def fetch_tiktok_verified_styles(args: argparse.Namespace, pool_size: int) -> tuple[list[StyleItem], str]:
    max_pages = min(args.max_pages, args.tiktok_max_pages)

    print("Fetching explicit TikTok Verified pages from store-list...")
    store_session = build_session(args.retries, pool_size, build_tiktok_store_headers(args))
    store_items = fetch_catalog_styles(
        store_session,
        api_url=API_URL_STORE_LIST,
        source_name="tiktok-store-list",
        base_payload=build_tiktok_store_payload(args),
        timeout=args.timeout,
        max_pages=max_pages,
        min_delay=args.min_delay,
        max_delay=args.max_delay,
    )
    store_session.close()
    if store_items:
        return store_items, "store-list"

    print("Fetching explicit TikTok Verified pages from home-product...")
    home_session = build_session(args.retries, pool_size, build_tiktok_home_headers(args))
    home_items = fetch_catalog_styles(
        home_session,
        api_url=API_URL_HOME_PRODUCT,
        source_name="tiktok-home-product",
        base_payload=build_tiktok_home_payload(args),
        timeout=args.timeout,
        max_pages=max_pages,
        min_delay=args.min_delay,
        max_delay=args.max_delay,
    )
    home_session.close()
    if home_items:
        return home_items, "home-product"
    return [], "none"


def take_with_fallback(primary: list[StyleItem], fallback: list[StyleItem], limit: int) -> list[StyleItem]:
    out: list[StyleItem] = []
    seen: set[str] = set()
    for source in (primary, fallback):
        for item in source:
            if item.id in seen:
                continue
            out.append(item)
            seen.add(item.id)
            if len(out) >= limit:
                return out
    return out


def build_bucket_selections(
    items: list[StyleItem],
    per_category: int,
    explicit_tiktok_items: list[StyleItem] | None = None,
) -> tuple[dict[str, list[StyleItem]], dict[str, Any]]:
    recency_sorted = sorted(items, key=lambda i: (-parse_numeric_id(i.id), i.title.lower(), i.price))
    trending_sorted = sorted(
        items,
        key=lambda i: (-i.trend_score, not i.is_new, -parse_numeric_id(i.id), i.title.lower()),
    )
    new_primary = [item for item in recency_sorted if item.is_new]
    explicit_tiktok_items = explicit_tiktok_items or []
    explicit_sorted = sorted(
        explicit_tiktok_items,
        key=lambda i: (-parse_numeric_id(i.id), i.title.lower(), i.price),
    )
    tiktok_primary = explicit_sorted or [item for item in recency_sorted if item.is_tiktok]
    trending_primary = [item for item in trending_sorted if item.trend_score > 0]

    buckets: dict[str, list[StyleItem]] = {}
    for bucket_name in MERCH_BUCKETS:
        if bucket_name == "new_in":
            buckets[bucket_name] = take_with_fallback(new_primary, recency_sorted, per_category)
        elif bucket_name == "collection":
            buckets[bucket_name] = recency_sorted[:per_category]
        elif bucket_name == "tiktok_verified":
            buckets[bucket_name] = take_with_fallback(tiktok_primary, trending_sorted, per_category)
        elif bucket_name == "trending":
            buckets[bucket_name] = take_with_fallback(trending_primary, trending_sorted, per_category)

    grouped: dict[str, list[StyleItem]] = defaultdict(list)
    for item in items:
        grouped[item.women_category].append(item)
    for category in sorted(grouped.keys()):
        grouped[category].sort(key=lambda i: (-parse_numeric_id(i.id), i.title.lower(), i.price))
        buckets[category] = grouped[category][:per_category]

    notes = {
        "tiktok_flagged_products": len(tiktok_primary),
        "tiktok_explicit_products": len(explicit_sorted),
        "tiktok_verified_used_fallback": len(tiktok_primary) < per_category,
        "new_flagged_products": len(new_primary),
        "trending_scored_products": len(trending_primary),
    }
    return buckets, notes


def safe_filename(value: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip().lower())
    clean = re.sub(r"-{2,}", "-", clean).strip("-")
    return clean or "item"


def convert_bytes_to_webp(content: bytes, destination: Path, quality: int, method: int) -> tuple[bool, str]:
    try:
        with Image.open(BytesIO(content)) as image:
            converted = image.convert("RGBA" if image.mode in {"RGBA", "LA"} else "RGB")
            destination.parent.mkdir(parents=True, exist_ok=True)
            temp_path = destination.with_suffix(".tmp")
            converted.save(temp_path, "WEBP", quality=quality, method=method, optimize=True)
            temp_path.replace(destination)
        if destination.exists() and destination.stat().st_size > 0:
            return True, "ok"
        return False, "empty-webp"
    except (UnidentifiedImageError, OSError) as exc:
        return False, str(exc)


def download_url_to_webp(
    session: requests.Session,
    url: str,
    destination: Path,
    timeout: int,
    quality: int,
    method: int,
) -> tuple[bool, str]:
    if destination.exists() and destination.stat().st_size > 0:
        return True, "cached"
    try:
        response = session.get(url, timeout=timeout)
        if response.status_code != 200:
            return False, f"http-{response.status_code}"
        return convert_bytes_to_webp(response.content, destination, quality, method)
    except requests.RequestException as exc:
        return False, str(exc)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()
    images_root = output_dir / "images"
    catalog_path = output_dir / "catalog_lite.json"
    bucket_catalog_path = output_dir / "catalog_by_bucket.json"
    summary_path = output_dir / "summary.json"
    failed_path = output_dir / "failed_images.json"

    if args.clean_output and output_dir.exists():
        shutil.rmtree(output_dir)

    pool_size = max(16, args.workers * 2)
    all_items: list[StyleItem] = []
    active_session: requests.Session | None = None
    source_used = "none"

    if args.source_mode in ("auto", "store-list"):
        print("Fetching catalog pages from store-list...")
        store_session = build_session(args.retries, pool_size, build_store_headers(args))
        store_items = fetch_catalog_styles(
            store_session,
            api_url=API_URL_STORE_LIST,
            source_name="store-list",
            base_payload=build_store_payload(args),
            timeout=args.timeout,
            max_pages=args.max_pages,
            min_delay=args.min_delay,
            max_delay=args.max_delay,
        )
        if store_items:
            all_items = store_items
            active_session = store_session
            source_used = "store-list"
        else:
            store_session.close()

    if not all_items and args.source_mode in ("auto", "home-product"):
        print("Fetching catalog pages from home-product fallback...")
        home_session = build_session(args.retries, pool_size, build_home_headers(args))
        home_items = fetch_catalog_styles(
            home_session,
            api_url=API_URL_HOME_PRODUCT,
            source_name="home-product",
            base_payload=build_home_payload(args),
            timeout=args.timeout,
            max_pages=args.max_pages,
            min_delay=args.min_delay,
            max_delay=args.max_delay,
        )
        if home_items:
            all_items = home_items
            active_session = home_session
            source_used = "home-product"
        else:
            home_session.close()

    if not all_items:
        raise RuntimeError("No women clothing items could be fetched from store-list or home-product.")

    assert active_session is not None
    print(f"Using source endpoint: {source_used}")
    print(f"Filtered women clothing+shoes candidates: {len(all_items):,}")

    tiktok_items, tiktok_source = fetch_tiktok_verified_styles(args, pool_size)
    tiktok_id_set = {item.id for item in tiktok_items}
    print(f"Explicit TikTok Verified source: {tiktok_source}; products={len(tiktok_items):,}")

    bucket_selections, selection_notes = build_bucket_selections(
        all_items, args.per_category, explicit_tiktok_items=tiktok_items
    )
    bucket_counts_targeted = {bucket: len(items) for bucket, items in bucket_selections.items()}

    selected_by_id: dict[str, StyleItem] = {}
    for items in bucket_selections.values():
        for item in items:
            selected_by_id[item.id] = item
    selected_items = sorted(
        selected_by_id.values(),
        key=lambda i: (i.women_category, -parse_numeric_id(i.id), i.title.lower()),
    )
    print(f"Unique products selected across buckets: {len(selected_items):,}")

    max_total_bytes = int(max(args.max_total_gb, 0.0) * (1024**3))
    size_state = {"bytes_used": 0}
    size_lock = threading.Lock()
    print(f"Global size cap: {args.max_total_gb:.2f} GB ({max_total_bytes:,} bytes)")

    downloaded_records: dict[str, dict[str, Any]] = {}
    failed: list[dict[str, Any]] = []
    done = 0
    done_lock = threading.Lock()

    def download_product(item: StyleItem) -> tuple[str, dict[str, Any] | None, dict[str, Any] | None]:
        chosen_images = pick_two_images(item.image_candidates)
        if not chosen_images:
            return item.id, None, {"id": item.id, "title": item.title, "error": "no-image-candidate"}

        images_payload: list[dict[str, Any]] = []
        base_name = safe_filename(item.id)

        for index, (image_url, color_name) in enumerate(chosen_images, start=1):
            rel_path = Path("images") / item.women_category / f"{base_name}-{index}.webp"
            dst_path = output_dir / rel_path

            with size_lock:
                if max_total_bytes > 0 and size_state["bytes_used"] >= max_total_bytes and not dst_path.exists():
                    break

            ok, reason = download_url_to_webp(
                session=active_session,
                url=image_url,
                destination=dst_path,
                timeout=args.timeout,
                quality=args.webp_quality,
                method=args.webp_method,
            )
            if not ok:
                continue

            file_size = dst_path.stat().st_size if dst_path.exists() else 0
            with size_lock:
                if reason != "cached":
                    if max_total_bytes > 0 and size_state["bytes_used"] + file_size > max_total_bytes:
                        if dst_path.exists():
                            dst_path.unlink()
                        break
                    size_state["bytes_used"] += file_size

            images_payload.append(
                {
                    "path": rel_path.as_posix(),
                    "source_image": image_url,
                    "color": color_name,
                    "bytes": file_size,
                }
            )

        if not images_payload:
            return item.id, None, {"id": item.id, "title": item.title, "error": "size-cap-or-download-fail"}

        record = {
            "id": item.id,
            "title": item.title,
            "price": round(item.price, 2),
            "category": item.women_category,
            "image": images_payload[0]["path"],
            "hover_image": images_payload[1]["path"] if len(images_payload) > 1 else images_payload[0]["path"],
            "images": [image["path"] for image in images_payload],
            "image_colors": [image["color"] for image in images_payload if image["color"]],
            "source_images": [image["source_image"] for image in images_payload],
            "is_new_in": item.is_new,
            "is_tiktok_verified": item.id in tiktok_id_set or item.is_tiktok,
            "trend_score": round(item.trend_score, 2),
            "downloaded_bytes": sum(image["bytes"] for image in images_payload),
        }
        return item.id, record, None

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = [executor.submit(download_product, item) for item in selected_items]
        for future in as_completed(futures):
            product_id, record, failure = future.result()
            with done_lock:
                done += 1
                if done % args.save_every == 0:
                    print(f"Processed {done:,}/{len(selected_items):,}", flush=True)

            if record is not None:
                downloaded_records[product_id] = record
            elif failure is not None:
                failed.append(failure)

    active_session.close()

    id_to_buckets: dict[str, set[str]] = defaultdict(set)
    for bucket, items in bucket_selections.items():
        for item in items:
            if item.id in downloaded_records:
                id_to_buckets[item.id].add(bucket)

    for product_id, buckets in id_to_buckets.items():
        downloaded_records[product_id]["buckets"] = sorted(buckets)

    unique_catalog = sorted(
        downloaded_records.values(),
        key=lambda item: (item["category"], item["title"].lower(), item["price"], item["id"]),
    )
    write_json(catalog_path, unique_catalog)

    bucket_catalog: dict[str, list[dict[str, Any]]] = {}
    for bucket, items in bucket_selections.items():
        records = [downloaded_records[item.id] for item in items if item.id in downloaded_records]
        bucket_catalog[bucket] = sorted(records, key=lambda r: (r["title"].lower(), r["price"], r["id"]))
    write_json(bucket_catalog_path, bucket_catalog)
    write_json(failed_path, failed)

    final_bucket_counts = {bucket: len(items) for bucket, items in bucket_catalog.items()}
    summary = {
        "source_endpoint": source_used,
        "tiktok_verified_source": tiktok_source,
        "total_filtered_candidates": len(all_items),
        "per_category_target": args.per_category,
        "requested_buckets": list(MERCH_BUCKETS) + sorted(ALLOWED_WOMEN_CATEGORIES),
        "bucket_counts_targeted": bucket_counts_targeted,
        "bucket_counts_downloaded": final_bucket_counts,
        "selection_notes": selection_notes,
        "unique_products_downloaded": len(unique_catalog),
        "failed_products": len(failed),
        "max_total_gb": args.max_total_gb if args.max_total_gb > 0 else None,
        "max_total_bytes": max_total_bytes if max_total_bytes > 0 else None,
        "total_bytes_on_disk": size_state["bytes_used"],
        "output_catalog": str(catalog_path),
        "output_bucket_catalog": str(bucket_catalog_path),
        "output_images_root": str(images_root),
        "failed_log": str(failed_path),
    }
    write_json(summary_path, summary)

    print("Completed.")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
