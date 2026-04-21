#!/usr/bin/env python3
"""Enrich the existing women catalog with real Trendsi bucket flags.

This script does NOT re-download images. It fetches metadata only:
  - All Women styles (paginated) for is_new / trend_score / tagName
  - All TikTok Verified styles (paginated) for the explicit tiktok set

It then writes catalog_buckets.json mapping product id -> flags, which
the API server reads in lib/catalog.ts to replace synthesised buckets
with upstream truth.

Usage:
  python3 scripts/enrich-women-buckets.py \
      --access-token <TOKEN> --shop-id <SHOPID> [--device-id <ID>]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


HOME_PRODUCT_URL = "https://www.trendsi.com/api/product/v2/home-product"

COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en;q=0.5",
    "Content-Type": "application/json",
    "platform": "2",
    "os": "3",
    "version": "V1.2.9",
    "shippingTo": "1",
    "currency": "USD",
    "timezone": "-180",
    "Origin": "https://www.trendsi.com",
}

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = REPO_ROOT / "data" / "catalog_lite.json"
BUCKETS_PATH = REPO_ROOT / "data" / "catalog_buckets.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--access-token", required=True)
    parser.add_argument("--shop-id", required=True)
    parser.add_argument("--device-id", type=int, default=657591)
    parser.add_argument("--page-size", type=int, default=2000)
    parser.add_argument("--max-pages", type=int, default=2000)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--min-delay", type=float, default=0.0)
    parser.add_argument("--max-delay", type=float, default=0.0)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--trending-cutoff", type=float, default=0.30,
                        help="Top X fraction of items by trend_score get isTrending=true.")
    return parser.parse_args()


def build_session(args: argparse.Namespace, referer: str) -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=args.retries, read=args.retries, connect=args.retries,
        backoff_factor=1.0,
        status_forcelist=(429, 502, 503, 504),
        allowed_methods=frozenset({"GET", "POST"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=8)
    session.mount("https://", adapter)
    headers = dict(COMMON_HEADERS)
    headers["Access-Token"] = args.access_token
    headers["Cookie"] = f"SHOPID={args.shop_id}; TOKEN={args.access_token}"
    headers["Referer"] = referer
    session.headers.update(headers)
    return session


def parse_style(raw: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    sid = raw.get("id") or raw.get("style_id") or raw.get("product_code")
    if sid is None:
        return None
    sid = str(sid)
    tag_name = str(raw.get("tagName") or "")
    tag_type = str(raw.get("tagType") or "")
    is_new = "new" in tag_name.lower() or tag_type == "1"
    is_tiktok = bool(raw.get("exprtedToTiktok") is True)
    try:
        sold = float(raw.get("sold") or 0)
    except (TypeError, ValueError):
        sold = 0.0
    try:
        max_earn = float(raw.get("maxEarn") or 0)
    except (TypeError, ValueError):
        max_earn = 0.0
    return sid, {
        "is_new": is_new,
        "is_tiktok": is_tiktok,
        "trend_score": max(sold, max_earn),
        "tag_name": tag_name,
    }


def fetch_one_page(
    session: requests.Session,
    base_payload: dict[str, Any],
    page: int,
    timeout: int,
    max_attempts: int = 5,
) -> tuple[int, list[dict[str, Any]], int | None]:
    payload = dict(base_payload)
    payload["curPage"] = page
    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        try:
            resp = session.post(HOME_PRODUCT_URL, json=payload, timeout=timeout)
            if resp.status_code in (500, 502, 503, 504, 429):
                raise requests.HTTPError(f"HTTP {resp.status_code}")
            if resp.status_code >= 400:
                raise requests.HTTPError(f"HTTP {resp.status_code}")
            body = resp.json()
            items = body.get("result") if isinstance(body, dict) else None
            if not isinstance(items, list):
                items = []
            page_meta = body.get("page") if isinstance(body, dict) else {}
            total = page_meta.get("total") if isinstance(page_meta, dict) else None
            return page, items, total
        except (requests.RequestException, json.JSONDecodeError) as exc:
            last_exc = exc
            time.sleep(1.5 * (attempt + 1) + random.random())
    raise last_exc if last_exc else RuntimeError("unknown fetch failure")


def fetch_all_styles(
    session: requests.Session,
    base_payload: dict[str, Any],
    label: str,
    args: argparse.Namespace,
) -> dict[str, dict[str, Any]]:
    """Return dict of id -> {is_new, is_tiktok, trend_score, tagName}."""
    # Page 1 first to learn total.
    try:
        page_no, items, total = fetch_one_page(session, base_payload, 1, args.timeout)
    except (requests.RequestException, json.JSONDecodeError) as exc:
        print(f"[{label}] page 1 failed: {exc}", flush=True)
        return {}
    out: dict[str, dict[str, Any]] = {}
    for raw in items:
        if isinstance(raw, dict):
            parsed = parse_style(raw)
            if parsed:
                out[parsed[0]] = parsed[1]
    page_size = max(1, len(items))
    if total is None or total <= page_size:
        print(f"[{label}] page 1 only: received={len(items)} unique={len(out)} (total={total})", flush=True)
        return out

    total_pages = (total + page_size - 1) // page_size
    total_pages = min(total_pages, args.max_pages)
    print(
        f"[{label}] page 1: received={len(items)} unique={len(out)} | "
        f"total={total} pages_to_fetch={total_pages-1} more (page_size={page_size})",
        flush=True,
    )

    pages_to_do = list(range(2, total_pages + 1))
    completed = 1
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(fetch_one_page, session, base_payload, p, args.timeout): p
            for p in pages_to_do
        }
        for fut in as_completed(futures):
            p = futures[fut]
            try:
                _, items, _ = fut.result()
            except (requests.RequestException, json.JSONDecodeError) as exc:
                print(f"[{label}] page {p} error: {exc}", flush=True)
                continue
            added = 0
            for raw in items:
                if not isinstance(raw, dict):
                    continue
                parsed = parse_style(raw)
                if not parsed:
                    continue
                sid, info = parsed
                if sid in out:
                    continue
                out[sid] = info
                added += 1
            completed += 1
            if completed % 5 == 0 or completed == total_pages:
                print(
                    f"[{label}] {completed}/{total_pages} pages done, unique={len(out)}",
                    flush=True,
                )
            if args.min_delay or args.max_delay:
                time.sleep(random.uniform(args.min_delay, args.max_delay))

    return out


def main() -> int:
    args = parse_args()

    if not CATALOG_PATH.exists():
        print(f"ERROR: {CATALOG_PATH} not found", file=sys.stderr)
        return 1

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    catalog_ids = {str(p["id"]) for p in catalog}
    print(f"Local catalog has {len(catalog_ids)} women products.", flush=True)

    print("=== Pulling all-women styles from Trendsi ===", flush=True)
    women_session = build_session(args, "https://www.trendsi.com/classify/Category")
    women_payload = {
        "pageSize": args.page_size,
        "name": "Women",
        "shopId": int(args.shop_id),
        "channel": 3,
    }
    women_styles = fetch_all_styles(women_session, women_payload, "women", args)
    women_session.close()

    print("=== Pulling TikTok-Verified styles from Trendsi ===", flush=True)
    tt_session = build_session(args, "https://www.trendsi.com/classify/TikTok%20Verified/All")
    tt_payload = {
        "pageSize": args.page_size,
        "name": "TikTok Verified",
        "categoryNavId": 5324,
        "navLevel": 2,
        "shopId": int(args.shop_id),
        "channel": 3,
    }
    tt_styles = fetch_all_styles(tt_session, tt_payload, "tiktok", args)
    tt_session.close()

    # Compute trending cutoff over the union of styles we actually saw,
    # restricted to ids that exist in our local catalog (so the cutoff
    # reflects what we actually surface).
    seen_in_local = [
        (sid, info["trend_score"])
        for sid, info in women_styles.items()
        if sid in catalog_ids and info["trend_score"] > 0
    ]
    seen_in_local.sort(key=lambda x: x[1], reverse=True)
    trending_cap = max(1, int(len(catalog_ids) * args.trending_cutoff))
    trending_ids = {sid for sid, _ in seen_in_local[:trending_cap]}
    print(
        f"Trending cutoff: top {args.trending_cutoff*100:.0f}% by trend_score "
        f"among observed local items -> {len(trending_ids)} ids "
        f"(of {len(seen_in_local)} observed with positive score).",
        flush=True,
    )

    tiktok_ids = set(tt_styles.keys()) | {
        sid for sid, info in women_styles.items() if info["is_tiktok"]
    }
    new_ids = {sid for sid, info in women_styles.items() if info["is_new"]}

    flags: dict[str, dict[str, Any]] = {}
    coverage = {"observed": 0, "missing": 0}
    for pid in catalog_ids:
        observed_women = pid in women_styles
        observed_tt = pid in tt_styles
        info = women_styles.get(pid) or tt_styles.get(pid) or {}
        if observed_women or observed_tt:
            coverage["observed"] += 1
        else:
            coverage["missing"] += 1
        flags[pid] = {
            "isNewIn": pid in new_ids,
            # "Collection" upstream = the entire women catalog browse view.
            "isCollection": True,
            "isTikTokVerified": pid in tiktok_ids,
            "isTrending": pid in trending_ids,
            "trendScore": float(info.get("trend_score", 0.0)),
            "observed": observed_women or observed_tt,
        }

    payload = {
        "_meta": {
            "generated_at": int(time.time()),
            "source": "trendsi.home-product",
            "local_catalog_size": len(catalog_ids),
            "women_styles_seen": len(women_styles),
            "tiktok_styles_seen": len(tt_styles),
            "tiktok_total_ids": len(tiktok_ids),
            "new_total_ids": len(new_ids),
            "trending_total_ids": len(trending_ids),
            "coverage_observed": coverage["observed"],
            "coverage_missing": coverage["missing"],
            "trending_cutoff": args.trending_cutoff,
        },
        "flags": flags,
    }
    BUCKETS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Wrote {BUCKETS_PATH} ({BUCKETS_PATH.stat().st_size} bytes).", flush=True)
    print(json.dumps(payload["_meta"], indent=2), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
