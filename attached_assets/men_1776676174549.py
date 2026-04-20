#!/usr/bin/env python3
"""Build a Replit-friendly men catalog: one high-quality WebP image per product."""

from __future__ import annotations

import argparse
import json
import random
import re
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

DEFAULT_STORE_ACCESS_TOKEN = "oSBs76LbLYQOwFByU8lN"
DEFAULT_STORE_COOKIE = (
    "SHOPID=654863; TOKEN=oSBs76LbLYQOwFByU8lN; "
    "ps_mode=trackingV2; ps_partner_key=439a9e290f36; "
    "ps_xid=wfgg0OjKbfO5Tc; pscd=join.trendsi.com"
)

DEFAULT_HOME_ACCESS_TOKEN = "i0a3u6dHdIthrIG50Sdt"
DEFAULT_HOME_COOKIE = (
    "_ga_KFE17CJTBD=GS2.1.s1776514168$o1$g1$t1776514489$j47$l0$h0; "
    "_ga=GA1.1.1017203857.1776514168; SHOPID=654873; TOKEN=i0a3u6dHdIthrIG50Sdt"
)

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
    "tops": ["top", "shirt", "tee", "t-shirt", "polo", "button-down", "hoodie", "sweatshirt"],
    "bottoms": ["pant", "pants", "trouser", "cargo", "chino", "jogger", "bottom"],
    "shorts": ["short", "shorts"],
    "denim": ["denim", "jean", "jeans"],
    "outerwear": ["coat", "jacket", "blazer", "parka", "trench", "windbreaker", "puffer"],
    "sets": ["set", "two-piece", "2 piece", "matching set"],
    "activewear": ["active", "athletic", "workout", "gym", "sport", "running", "training"],
    "knitwear": ["knit", "sweater", "cardigan", "pullover"],
    "swimwear": ["swim", "trunk", "boardshort", "beachwear"],
    "loungewear": ["lounge", "sleepwear", "pajama", "homewear"],
    "underwear": ["underwear", "boxer", "brief", "undershirt", "intimate"],
    "shoes": ["shoe", "sneaker", "boot", "loafer", "slipper", "sandal"],
    "accessories": ["accessory", "hat", "belt", "scarf", "wallet", "bag", "backpack", "sunglass"],
    "formal": ["formal", "suit", "tuxedo", "dress shirt", "office"],
    "basics": ["basic", "everyday", "essential"],
}


@dataclass
class StyleItem:
    id: str
    title: str
    price: float
    category: str
    image_url: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="catalog/replit_lite_men")
    parser.add_argument(
        "--source-mode",
        choices=("auto", "store-list", "home-product"),
        default="auto",
        help="auto tries home-product first, then falls back to store-list.",
    )
    parser.add_argument(
        "--max-total",
        type=int,
        default=0,
        help="0 disables global cap; otherwise limit total selected items.",
    )
    parser.add_argument("--per-category", type=int, default=2_000)
    parser.add_argument("--workers", type=int, default=20)
    parser.add_argument("--timeout", type=int, default=35)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--max-pages", type=int, default=1_000)
    parser.add_argument("--webp-quality", type=int, default=82)
    parser.add_argument("--webp-method", type=int, default=6)
    parser.add_argument("--save-every", type=int, default=200)

    parser.add_argument("--store-access-token", default=DEFAULT_STORE_ACCESS_TOKEN)
    parser.add_argument("--store-cookie", default=DEFAULT_STORE_COOKIE)
    parser.add_argument("--store-referer", default="https://www.trendsi.com/classify/Men/Men%27s%20Bottoms")
    parser.add_argument("--store-device-id", type=int, default=657581)
    parser.add_argument("--store-channel", type=int, default=3)
    parser.add_argument("--store-shop-id", default="654863")
    parser.add_argument("--store-page-size", type=int, default=100)

    parser.add_argument("--home-access-token", default=DEFAULT_HOME_ACCESS_TOKEN)
    parser.add_argument("--home-cookie", default=DEFAULT_HOME_COOKIE)
    parser.add_argument(
        "--home-referer",
        default="https://www.trendsi.com/classify/Men/All",
    )
    parser.add_argument("--home-shop-id", type=int, default=654863)
    parser.add_argument("--home-channel", type=int, default=3)
    parser.add_argument("--home-name", default="Men")
    parser.add_argument("--home-category-nav-id", type=int, default=0)
    parser.add_argument("--home-nav-level", type=int, default=0)
    parser.add_argument("--home-page-size", type=int, default=90)

    parser.add_argument("--min-delay", type=float, default=2.5)
    parser.add_argument("--max-delay", type=float, default=5.5)
    parser.add_argument("--max-total-gb", type=float, default=3.0)
    return parser.parse_args()


def build_store_headers(args: argparse.Namespace) -> dict[str, str]:
    headers = dict(COMMON_HEADERS)
    headers["Alt-Used"] = "www.trendsi.com"
    headers["Access-Token"] = args.store_access_token
    headers["Referer"] = args.store_referer
    headers["Cookie"] = args.store_cookie
    return headers


def build_home_headers(args: argparse.Namespace) -> dict[str, str]:
    headers = dict(COMMON_HEADERS)
    headers["Sec-GPC"] = "1"
    headers["Access-Token"] = args.home_access_token
    headers["Referer"] = args.home_referer
    headers["Cookie"] = args.home_cookie
    headers["TE"] = "trailers"
    return headers


def build_store_payload(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "curPage": 1,
        "pageSize": args.store_page_size,  # forced low page size to reduce ban risk
        "device_id": args.store_device_id,
        "channel": args.store_channel,
        "shopId": str(args.store_shop_id),
    }


def build_home_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "curPage": 1,
        "pageSize": args.home_page_size,
        "name": args.home_name,
    }
    if args.home_shop_id > 0:
        payload["shopId"] = args.home_shop_id
    if args.home_channel > 0:
        payload["channel"] = args.home_channel
    if args.home_category_nav_id > 0:
        payload["categoryNavId"] = args.home_category_nav_id
    if args.home_nav_level > 0:
        payload["navLevel"] = args.home_nav_level
    return payload


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
        for field in ("name", "title", "label", "path", "slug", "category_name"):
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
        for key in ("url", "src", "image", "imageUrl", "img", "imgUrl", "origin"):
            found = first_url(value.get(key))
            if found:
                return found
    return ""


def pick_image_url(style: dict[str, Any]) -> str:
    direct_keys = (
        "mainImage",
        "mainImageUrl",
        "headImage",
        "image",
        "imageUrl",
        "cover",
        "coverUrl",
        "img",
    )
    for key in direct_keys:
        found = first_url(style.get(key))
        if found:
            return found

    for key in ("all_images", "images", "imageList", "gallery", "picList"):
        found = first_url(style.get(key))
        if found:
            return found

    for variant_key in ("variants", "variantList", "skus", "skuList"):
        variants = style.get(variant_key) or []
        if isinstance(variants, dict):
            variants = [variants]
        if not isinstance(variants, list):
            continue
        for variant in variants:
            if not isinstance(variant, dict):
                continue
            for key in ("image", "imageUrl", "img", "imgUrl", "photo", "photoUrl", "images"):
                found = first_url(variant.get(key))
                if found:
                    return found
    return ""


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

    best: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        nonlocal best
        if isinstance(node, list) and node and isinstance(node[0], dict):
            keys = set().union(*(item.keys() for item in node[:10] if isinstance(item, dict)))
            if {"title", "all_images"} & keys and len(node) > len(best):
                best = node
        elif isinstance(node, dict):
            for value in node.values():
                walk(value)

    walk(payload)
    return best


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

    image_url = pick_image_url(style)
    if not image_url:
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
    )
    category = infer_category(title, category_tokens)

    return StyleItem(id=style_id, title=title, price=price, category=category, image_url=image_url)


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
                print(f"[{source_name}] Skipping HTTP {status} on page {page}")
                break

            body = response.json()
            items = find_item_list(body)
            if not items:
                if page == 1:
                    code = body.get("code") if isinstance(body, dict) else None
                    page_meta = body.get("page") if isinstance(body, dict) else {}
                    total = page_meta.get("total") if isinstance(page_meta, dict) else None
                    print(
                        f"[{source_name}] Page 1 returned no products. "
                        f"API code={code} total={total}. "
                        "Refresh token/cookie from a fresh browser cURL and retry."
                    )
                print(f"[{source_name}] No items returned on page {page}, stopping pagination.")
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


def select_balanced(items: list[StyleItem], per_category: int, max_total: int) -> list[StyleItem]:
    grouped: dict[str, list[StyleItem]] = defaultdict(list)
    for item in items:
        grouped[item.category].append(item)

    for category in grouped:
        grouped[category].sort(key=lambda i: (i.title.lower(), i.price, i.id))

    selected: list[StyleItem] = []
    leftovers: list[StyleItem] = []
    for category in sorted(grouped.keys()):
        bucket = grouped[category]
        selected.extend(bucket[:per_category])
        leftovers.extend(bucket[per_category:])

    if max_total > 0 and len(selected) > max_total:
        trimmed: list[StyleItem] = []
        counts: dict[str, int] = defaultdict(int)
        for item in selected:
            if len(trimmed) >= max_total:
                break
            if counts[item.category] >= per_category:
                continue
            trimmed.append(item)
            counts[item.category] += 1
        selected = trimmed
    elif max_total > 0 and len(selected) < max_total and leftovers:
        for item in leftovers:
            if len(selected) >= max_total:
                break
            selected.append(item)

    selected.sort(key=lambda i: (i.category, i.title.lower(), i.price, i.id))
    return selected


def safe_filename(value: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip().lower())
    clean = re.sub(r"-{2,}", "-", clean).strip("-")
    return clean or "item"


def convert_bytes_to_webp(content: bytes, destination: Path, quality: int, method: int) -> tuple[bool, str]:
    try:
        with Image.open(BytesIO(content)) as image:
            if image.mode in {"RGBA", "LA"}:
                converted = image.convert("RGBA")
            else:
                converted = image.convert("RGB")
            destination.parent.mkdir(parents=True, exist_ok=True)
            temp_path = destination.with_suffix(".tmp")
            converted.save(temp_path, "WEBP", quality=quality, method=method, optimize=True)
            temp_path.replace(destination)
        if destination.exists() and destination.stat().st_size > 0:
            return True, "ok"
        return False, "empty-webp"
    except (UnidentifiedImageError, OSError) as exc:
        return False, str(exc)


def download_image_to_webp(
    session: requests.Session,
    item: StyleItem,
    destination: Path,
    timeout: int,
    quality: int,
    method: int,
) -> tuple[bool, str]:
    if destination.exists() and destination.stat().st_size > 0:
        return True, "cached"
    try:
        response = session.get(item.image_url, timeout=timeout)
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
    catalog_path = output_dir / "catalog_men_lite.json"
    summary_path = output_dir / "summary.json"
    failed_path = output_dir / "failed_images.json"

    all_items: list[StyleItem] = []
    session: requests.Session | None = None
    source_used = "none"
    pool_size = max(16, args.workers * 2)

    if args.source_mode in ("auto", "home-product"):
        print("Fetching catalog pages from Trendsi API (home-product)...")
        home_session = build_session(args.retries, pool_size, headers=build_home_headers(args))
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
            session = home_session
            source_used = "home-product"
        else:
            home_session.close()

    if not all_items and args.source_mode in ("auto", "store-list"):
        print("Fetching catalog pages from Trendsi API (store-list fallback)...")
        store_session = build_session(args.retries, pool_size, headers=build_store_headers(args))
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
            session = store_session
            source_used = "store-list"
        else:
            store_session.close()

    if not all_items:
        raise RuntimeError("No items could be fetched from home-product or store-list endpoints.")

    assert session is not None
    print(f"Using source endpoint: {source_used}")

    print(f"Unique normalized styles: {len(all_items):,}")
    selected = select_balanced(all_items, args.per_category, args.max_total)
    print(f"Selected for download: {len(selected):,}")
    max_total_bytes = int(max(args.max_total_gb, 0.0) * (1024**3))
    existing_bytes = sum(path.stat().st_size for path in images_root.rglob("*.webp")) if images_root.exists() else 0
    size_budget = {"bytes_used": existing_bytes}
    budget_lock = threading.Lock()
    if max_total_bytes > 0:
        print(
            f"Image cap: {args.max_total_gb:.2f} GB "
            f"({max_total_bytes:,} bytes); currently used {existing_bytes:,} bytes."
        )

    results: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    done = 0
    done_lock = threading.Lock()

    def one(item: StyleItem) -> tuple[StyleItem, bool, str, str, int]:
        file_name = f"{safe_filename(item.id)}.webp"
        rel = Path("images") / item.category / file_name
        dst = output_dir / rel
        with budget_lock:
            if max_total_bytes > 0 and size_budget["bytes_used"] >= max_total_bytes and not dst.exists():
                return item, False, f"size-cap-{args.max_total_gb:.2f}gb", rel.as_posix(), 0

        ok, reason = download_image_to_webp(
            session=session,
            item=item,
            destination=dst,
            timeout=args.timeout,
            quality=args.webp_quality,
            method=args.webp_method,
        )
        if not ok:
            return item, False, reason, rel.as_posix(), 0

        file_size = dst.stat().st_size if dst.exists() else 0
        with budget_lock:
            if reason != "cached":
                if max_total_bytes > 0 and size_budget["bytes_used"] + file_size > max_total_bytes:
                    if dst.exists():
                        dst.unlink()
                    return item, False, f"size-cap-{args.max_total_gb:.2f}gb", rel.as_posix(), file_size
                size_budget["bytes_used"] += file_size
        return item, True, reason, rel.as_posix(), file_size

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = [executor.submit(one, item) for item in selected]
        for future in as_completed(futures):
            item, ok, reason, rel_path, image_bytes = future.result()
            with done_lock:
                done += 1
                if done % args.save_every == 0:
                    print(f"Downloaded {done:,}/{len(selected):,}", flush=True)

            if ok:
                results.append(
                    {
                        "id": item.id,
                        "title": item.title,
                        "price": round(item.price, 2),
                        "category": item.category,
                        "image": rel_path,
                        "image_bytes": image_bytes,
                        "source_image": item.image_url,
                    }
                )
            else:
                failed.append(
                    {
                        "id": item.id,
                        "title": item.title,
                        "category": item.category,
                        "source_image": item.image_url,
                        "error": reason,
                    }
                )

    session.close()

    results.sort(key=lambda x: (x["category"], x["title"].lower(), x["price"], x["id"]))
    write_json(catalog_path, results)
    write_json(failed_path, failed)

    category_counts: dict[str, int] = defaultdict(int)
    for item in results:
        category_counts[item["category"]] += 1

    summary = {
        "source_endpoint": source_used,
        "total_fetched_styles": len(all_items),
        "target_selected": len(selected),
        "downloaded_ok": len(results),
        "failed": len(failed),
        "max_total": args.max_total if args.max_total > 0 else None,
        "max_total_gb": args.max_total_gb if args.max_total_gb > 0 else None,
        "max_total_bytes": max_total_bytes if max_total_bytes > 0 else None,
        "downloaded_bytes": sum(item.get("image_bytes", 0) for item in results),
        "total_bytes_on_disk": size_budget["bytes_used"],
        "per_category_target": args.per_category,
        "categories": dict(sorted(category_counts.items())),
        "output_catalog": str(catalog_path),
        "output_images_root": str(images_root),
        "failed_log": str(failed_path),
    }
    write_json(summary_path, summary)

    print("Completed.")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
