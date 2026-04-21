// Pipe Trendsi extract snapshots into the runtime catalogs.
//
// Reads:  artifacts/api-server/data/trendsi-extract/{men,shoes}_catalog.json
// Writes: artifacts/api-server/data/catalog_men_lite.json   (men merge)
//         artifacts/api-server/data/catalog_lite.json       (women shoes merge)
// Uploads: catalog/replit_lite_men/images/<cat>/<id>{,_400,_800,_1600}.webp
//          catalog/replit_lite/images/shoes/<id>{,_400,_800,_1600}.webp
//
// Env: R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// Optional: CONCURRENCY (default 32), SKIP_EXISTING ("0" disables, default skip)

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env, exit, stderr, stdout } from "node:process";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
const EXTRACT_DIR = resolve(DATA_DIR, "trendsi-extract");

const ENDPOINT = env.R2_S3_ENDPOINT;
const KEY_ID = env.R2_ACCESS_KEY_ID;
const SECRET = env.R2_SECRET_ACCESS_KEY;
const BUCKET = env.R2_BUCKET;
if (!ENDPOINT || !KEY_ID || !SECRET || !BUCKET) {
  stderr.write(
    "Missing R2_S3_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET\n",
  );
  exit(1);
}

const CONCURRENCY = Number(env.CONCURRENCY ?? "32");
const SKIP_EXISTING = (env.SKIP_EXISTING ?? "1") !== "0";
const MAX_SECONDS = Number(env.MAX_SECONDS ?? "0"); // 0 = no cap
const START_TIME = Date.now();
function timeUp() {
  return MAX_SECONDS > 0 && (Date.now() - START_TIME) / 1000 > MAX_SECONDS;
}
const VARIANT_WIDTHS = [400, 800, 1600];
const WEBP_QUALITY = Number(env.WEBP_QUALITY ?? "82");

const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
});

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}
function writeJson(p, data) {
  writeFileSync(p, JSON.stringify(data, null, 2));
}

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "VELOUR-catalog-merge/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function uploadOne(key, body, contentType = "image/webp") {
  if (SKIP_EXISTING && (await objectExists(key))) return "skip";
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return "put";
}

// One product → fetch source, encode canonical + 3 variants, upload all four.
async function processProduct(item, prefix, category) {
  const id = String(item.id);
  const baseKey = `${prefix}/images/${category}/${id}`;
  const canonicalKey = `${baseKey}.webp`;

  // Fast skip: if all four keys already exist, just return.
  if (SKIP_EXISTING) {
    const checks = await Promise.all([
      objectExists(canonicalKey),
      ...VARIANT_WIDTHS.map((w) => objectExists(`${baseKey}_${w}.webp`)),
    ]);
    if (checks.every(Boolean)) return { id, status: "all-exist" };
  }

  const sourceUrl = item.main_image || item.alt_image;
  if (!sourceUrl) return { id, status: "no-source" };

  const raw = await fetchBuffer(sourceUrl);
  const meta = await sharp(raw).metadata();
  const srcW = meta.width ?? 0;

  // Canonical: re-encode as webp at native size (cap at 1600).
  const canonicalBuf = await sharp(raw)
    .resize({
      width: Math.min(srcW || 1600, 1600),
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
  await uploadOne(canonicalKey, canonicalBuf);

  // Variants
  for (const w of VARIANT_WIDTHS) {
    const buf = await sharp(raw)
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    await uploadOne(`${baseKey}_${w}.webp`, buf);
  }
  return { id, status: "ok", bytes: canonicalBuf.length };
}

// Tiny worker-pool helper (avoid pulling in p-limit).
async function runPool(tasks, concurrency, label) {
  const total = tasks.length;
  let done = 0;
  let failed = 0;
  let lastLog = Date.now();
  const results = new Array(total);
  let cursor = 0;
  async function worker() {
    while (true) {
      if (timeUp()) return;
      const i = cursor++;
      if (i >= total) return;
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        failed++;
        results[i] = { error: String(e) };
      }
      done++;
      if (Date.now() - lastLog > 2000) {
        stdout.write(
          `[${label}] ${done}/${total} done, ${failed} failed\n`,
        );
        lastLog = Date.now();
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker()),
  );
  stdout.write(`[${label}] FINAL ${done}/${total} (${failed} failed)\n`);
  return results;
}

// Build the catalog row in the same shape as existing rows.
function toRow(item, category) {
  return {
    id: String(item.id),
    title: item.title,
    price: typeof item.price === "number" ? item.price : Number(item.price),
    category,
    image: `images/${category}/${item.id}.webp`,
    source_image: item.main_image || item.alt_image || undefined,
  };
}

function flatten(extract, categoryMap) {
  // categoryMap: subcategoryKey -> runtime category string
  const out = [];
  for (const [sub, items] of Object.entries(
    extract.items_by_subcategory ?? {},
  )) {
    const category = categoryMap[sub] ?? sub;
    for (const it of items) out.push({ item: it, category });
  }
  return out;
}

// ---------- MEN ----------
const menExtract = readJson(resolve(EXTRACT_DIR, "men_catalog.json"));
// Trendsi men subcategories → existing runtime category vocabulary.
const MEN_CAT_MAP = {
  bottoms: "bottoms",
  denim: "denim",
  outerwear: "outerwear",
  shorts: "shorts",
  sweaters: "knitwear",
  tops: "tops",
  shoes: "shoes",
  other: "other",
};
const menItems = flatten(menExtract, MEN_CAT_MAP);
stdout.write(`MEN: ${menItems.length} items to merge\n`);

// ---------- WOMEN SHOES ----------
const shoesExtract = readJson(resolve(EXTRACT_DIR, "shoes_catalog.json"));
// Every shoes subcategory collapses to "shoes" in the women catalog.
const SHOES_CAT_MAP = Object.fromEntries(
  Object.keys(shoesExtract.items_by_subcategory ?? {}).map((k) => [k, "shoes"]),
);
const shoesItems = flatten(shoesExtract, SHOES_CAT_MAP);
stdout.write(`WOMEN SHOES: ${shoesItems.length} items to merge\n`);

// ---------- IMAGE UPLOAD ----------
const menTasks = menItems.map(
  ({ item, category }) =>
    () =>
      processProduct(item, "catalog/replit_lite_men", category),
);
const shoesTasks = shoesItems.map(
  ({ item, category }) =>
    () =>
      processProduct(item, "catalog/replit_lite", category),
);

stdout.write(
  `Uploading ${menTasks.length + shoesTasks.length} products (concurrency=${CONCURRENCY})...\n`,
);

const menResults = await runPool(menTasks, CONCURRENCY, "men");
const shoesResults = await runPool(shoesTasks, CONCURRENCY, "shoes");

// ---------- MERGE INTO CATALOGS ----------
function mergeCatalog(catalogPath, newRows) {
  const existing = readJson(catalogPath);
  const byId = new Map(existing.map((r) => [String(r.id), r]));
  let added = 0;
  let updated = 0;
  for (const row of newRows) {
    if (byId.has(row.id)) {
      // Preserve any extra fields on the existing row, overwrite known ones.
      byId.set(row.id, { ...byId.get(row.id), ...row });
      updated++;
    } else {
      byId.set(row.id, row);
      added++;
    }
  }
  const merged = Array.from(byId.values());
  writeJson(catalogPath, merged);
  return { total: merged.length, added, updated };
}

// Only include rows whose canonical upload succeeded (or already existed).
function okRows(items, results) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const r = results[i];
    if (
      r &&
      (r.status === "ok" || r.status === "all-exist")
    ) {
      out.push(toRow(items[i].item, items[i].category));
    }
  }
  return out;
}

const menRows = okRows(menItems, menResults);
const shoesRows = okRows(shoesItems, shoesResults);

const menMerge = mergeCatalog(
  resolve(DATA_DIR, "catalog_men_lite.json"),
  menRows,
);
stdout.write(
  `catalog_men_lite.json: total=${menMerge.total}, added=${menMerge.added}, updated=${menMerge.updated}\n`,
);

const shoesMerge = mergeCatalog(
  resolve(DATA_DIR, "catalog_lite.json"),
  shoesRows,
);
stdout.write(
  `catalog_lite.json:     total=${shoesMerge.total}, added=${shoesMerge.added}, updated=${shoesMerge.updated} (women shoes)\n`,
);

stdout.write("DONE\n");
