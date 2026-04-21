#!/usr/bin/env python3
"""Extract a single Trendsi /api/store/list page and produce a lite catalog
plus per-product WebP images suitable for upload-r2.mjs.

Used to pull men's catalog (Referer: classify/Men/All) and ladies-shoes
(Referer: classify/Category/Shoes). Uses the same env-var-only credential
contract as extract-women.py — no hardcoded token / cookie / shop-id.

Usage:
    export TRENDSI_ACCESS_TOKEN=...
    export TRENDSI_COOKIE=...
    export TRENDSI_SHOP_ID=...
    export TRENDSI_DEVICE_ID=...        # optional, defaults to 0
    python3 scripts/extract-trendsi-list.py \\
        --referer https://www.trendsi.com/classify/Men/All \\
        --out-json data/catalog_men_lite.json \\
        --out-dir /tmp/trendsi-men-images \\
        --default-category other
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
from PIL import Image, ImageFile, UnidentifiedImageError
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ImageFile.LOAD_TRUNCATED_IMAGES = True

API_URL = "https://www.trendsi.com/api/store/list"

CATEGORY_RULES: dict[str, list[str]] = {
    "activewear": ["active", "athletic", "yoga", "workout", "gym", "sport", "running"],
    "basics": ["basic", "everyday", "essential"],
    "bottoms": ["pants", "trouser", "legging", "jogger", "shorts", "skirt", "sweatpant"],
    "denim": ["denim", "jean"],
    "dresses": ["dress", "midi", "mini", "maxi", "gown"],
    "intimates": ["bra", "panty", "lingerie", "underwear", "intimate"],
    "jumpsuits": ["jumpsuit", "romper", "overall"],
    "knitwear": ["knit", "sweater", "cardigan", "pullover"],
    "loungewear": ["lounge", "sleepwear", "pajama", "homewear"],
    "outerwear": ["coat", "jacket", "blazer", "parka", "trench", "vest", "hoodie"],
    "sets": ["set", "two-piece", "matching"],
    "shoes": ["shoe", "sneaker", "heel", "sandal", "boot", "loafer", "flat", "slipper"],
    "swimwear": ["swim", "bikini", "trunk", "boardshort"],
    "tops": ["top", "shirt", "blouse", "tee", "tank", "polo", "sweatshirt"],
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--referer", required=True)
    p.add_argument("--out-json", required=True, help="Path to write lite catalog JSON.")
    p.add_argument("--out-dir", required=True, help="Local dir to write WebP images.")
    p.add_argument("--default-category", default=None,
                   help="If set, every row gets this category (overrides inference).")
    p.add_argument("--page-size", type=int, default=100,
                   help="Per-page size; upstream rejects values much above ~100.")
    p.add_argument("--max-pages", type=int, default=200,
                   help="Safety cap on pagination loop.")
    p.add_argument("--cur-page", type=int, default=1)
    p.add_argument("--workers", type=int, default=16)
    p.add_argument("--timeout", type=int, default=45)
    p.add_argument("--retries", type=int, default=4)
    p.add_argument("--webp-quality", type=int, default=84)
    p.add_argument("--clean-out-dir", action="store_true")

    p.add_argument("--access-token", default=os.environ.get("TRENDSI_ACCESS_TOKEN"))
    p.add_argument("--cookie", default=os.environ.get("TRENDSI_COOKIE"))
    p.add_argument("--shop-id", default=os.environ.get("TRENDSI_SHOP_ID"))
    _raw_dev = (os.environ.get("TRENDSI_DEVICE_ID") or "0").strip()
    try:
        _dev_default = int(_raw_dev)
    except ValueError:
        sys.stderr.write(f"WARN: TRENDSI_DEVICE_ID={_raw_dev!r} is not numeric; using 0.\n")
        _dev_default = 0
    p.add_argument("--device-id", type=int, default=_dev_default)
    p.add_argument("--channel", type=int, default=3)
    args = p.parse_args()

    missing = [n for n, v in (
        ("--access-token / TRENDSI_ACCESS_TOKEN", args.access_token),
        ("--cookie / TRENDSI_COOKIE", args.cookie),
        ("--shop-id / TRENDSI_SHOP_ID", args.shop_id),
    ) if not v]
    if missing:
        sys.stderr.write(
            "ERROR: Missing required Trendsi credentials: " + ", ".join(missing) +
            "\nSee the docstring at the top of this script for how to provide them.\n"
        )
        sys.exit(2)
    return args


def build_session(args: argparse.Namespace) -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=args.retries, read=args.retries, connect=args.retries,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "POST"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=32, pool_maxsize=32)
    s.mount("https://", adapter)
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-GB,en;q=0.5",
        "Content-Type": "application/json",
        "platform": "2",
        "os": "3",
        "version": "V1.2.9",
        "Access-Token": args.access_token,
        "shippingTo": "1",
        "currency": "USD",
        "timezone": "-180",
        "Origin": "https://www.trendsi.com",
        "Referer": args.referer,
        "Cookie": args.cookie,
    })
    return s


def first_url(value: Any) -> str:
    if isinstance(value, str):
        v = value.strip()
        return v if v.startswith(("http://", "https://")) else ""
    if isinstance(value, list):
        for item in value:
            u = first_url(item)
            if u:
                return u
    if isinstance(value, dict):
        for k in ("url", "src", "image", "imageUrl", "img", "imgUrl", "origin",
                  "iconImage", "mainImage", "headImage"):
            u = first_url(value.get(k))
            if u:
                return u
    return ""


def collect_image(style: dict[str, Any]) -> str:
    color_list = style.get("colorList") or []
    if isinstance(color_list, list):
        for c in color_list:
            if isinstance(c, dict):
                u = (first_url(c.get("iconImage")) or first_url(c.get("image"))
                     or first_url(c.get("headImage")) or first_url(c.get("mainImage")))
                if u:
                    return u
    for k in ("mainImage", "mainImageUrl", "headImage", "image", "imageUrl",
              "cover", "coverUrl", "img"):
        u = first_url(style.get(k))
        if u:
            return u
    for k in ("all_images", "images", "imageList", "gallery", "picList"):
        u = first_url(style.get(k))
        if u:
            return u
    return ""


def try_float(v: Any, d: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def infer_category(title: str) -> str:
    t = title.lower()
    for cat, words in CATEGORY_RULES.items():
        if any(w in t for w in words):
            return cat
    return "other"


def find_items(payload: Any) -> list[dict[str, Any]]:
    for path in [("data", "list"), ("data", "items"), ("data", "records"),
                 ("result",), ("list",), ("items",), ("records",)]:
        node = payload
        ok = True
        for k in path:
            if not isinstance(node, dict) or k not in node:
                ok = False
                break
            node = node[k]
        if ok and isinstance(node, list):
            return [x for x in node if isinstance(x, dict)]
    return []


def safe_id(raw: Any) -> str:
    s = str(raw or "").strip()
    s = re.sub(r"[^A-Za-z0-9_.-]", "", s)
    return s


def download_one(session: requests.Session, url: str, dest: Path,
                 quality: int, timeout: int) -> tuple[bool, str]:
    try:
        r = session.get(url, timeout=timeout, stream=True)
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"
        buf = BytesIO(r.content)
        try:
            img = Image.open(buf)
            img.load()
        except (UnidentifiedImageError, OSError) as e:
            return False, f"decode: {e}"
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        img.save(dest, format="WEBP", quality=quality, method=6)
        return True, ""
    except (requests.RequestException, OSError) as e:
        return False, str(e)


def main() -> int:
    args = parse_args()

    out_dir = Path(args.out_dir).resolve()
    if args.clean_out_dir and out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    sess = build_session(args)
    items: list[dict[str, Any]] = []
    page = args.cur_page
    total_known: int | None = None
    print(f"POST {API_URL}  referer={args.referer}  pageSize={args.page_size}", flush=True)
    while page <= args.cur_page + args.max_pages - 1:
        payload = {
            "curPage": page,
            "pageSize": args.page_size,
            "device_id": args.device_id,
            "channel": args.channel,
            "shopId": str(args.shop_id),
        }
        resp = sess.post(API_URL, json=payload, timeout=args.timeout)
        if resp.status_code != 200:
            sys.stderr.write(f"page {page}: HTTP {resp.status_code}\n")
            sys.stderr.write((resp.text or "")[:400] + "\n")
            return 3
        body = resp.json()
        if total_known is None and isinstance(body, dict):
            meta = body.get("page") or {}
            if isinstance(meta, dict):
                total_known = meta.get("total")
                print(f"  upstream total = {total_known}", flush=True)
        page_items = find_items(body)
        if not page_items:
            if page == args.cur_page:
                sys.stderr.write("no items on first page; dumping head:\n")
                sys.stderr.write((resp.text or "")[:400] + "\n")
                return 4
            break
        items.extend(page_items)
        print(f"  page {page}: +{len(page_items)} (running total {len(items)})", flush=True)
        if total_known is not None and len(items) >= total_known:
            break
        if len(page_items) < args.page_size:
            break
        page += 1
    print(f"  fetched {len(items)} raw items across {page - args.cur_page + 1} page(s)", flush=True)

    # First pass: build catalog rows (skip duplicates by id) and image jobs.
    seen: set[str] = set()
    rows: list[dict[str, Any]] = []
    jobs: list[tuple[str, str, str]] = []  # (id, source_url, dest_path)
    skipped_no_image = 0
    skipped_no_title = 0
    for raw in items:
        sid = safe_id(raw.get("style_id") or raw.get("product_code")
                      or raw.get("id") or raw.get("itemId"))
        if not sid or sid in seen:
            continue
        title = str(raw.get("title") or raw.get("name") or "").strip()
        if not title:
            skipped_no_title += 1
            continue
        url = collect_image(raw)
        if not url:
            skipped_no_image += 1
            continue
        price = try_float(raw.get("base_price"),
                          try_float(raw.get("price"),
                                    try_float(raw.get("minPrice"),
                                              try_float(raw.get("wholesalePrice"), 0.0))))
        category = args.default_category or infer_category(title)
        image_rel = f"{sid}.webp"
        rows.append({
            "id": sid,
            "title": title,
            "price": round(price, 2),
            "category": category,
            "image": image_rel,
            "source_image": url,
        })
        jobs.append((sid, url, str(out_dir / image_rel)))
        seen.add(sid)

    print(f"  catalog rows: {len(rows)}  skipped_no_title={skipped_no_title} "
          f"skipped_no_image={skipped_no_image}", flush=True)

    # Second pass: download + transcode in parallel.
    ok = 0
    fails: list[tuple[str, str]] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(download_one, sess, url, Path(dest), args.webp_quality, args.timeout):
            (sid, url, dest) for (sid, url, dest) in jobs
        }
        done = 0
        for fut in as_completed(futures):
            sid, url, _ = futures[fut]
            try:
                success, err = fut.result()
            except (requests.RequestException, OSError) as e:
                success, err = False, str(e)
            if success:
                ok += 1
            else:
                fails.append((sid, err))
            done += 1
            if done % 200 == 0:
                print(f"  images: {done}/{len(jobs)} (ok={ok} fail={len(fails)})", flush=True)
    print(f"  done. ok={ok} fail={len(fails)} (first 5 fails: {fails[:5]})", flush=True)

    # Drop rows whose image failed so we don't reference broken keys in R2.
    failed_ids = {sid for sid, _ in fails}
    rows = [r for r in rows if r["id"] not in failed_ids]
    print(f"  final rows after dropping failed images: {len(rows)}", flush=True)

    out_json = Path(args.out_json).resolve()
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    print(f"wrote {out_json} ({out_json.stat().st_size} bytes, {len(rows)} rows)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
