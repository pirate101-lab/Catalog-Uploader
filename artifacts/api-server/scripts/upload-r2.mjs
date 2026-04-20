// Re-encode catalog images into multiple widths and upload them to Cloudflare
// R2 in parallel via the S3-compatible API.
//
// For every source .webp this emits three responsive variants
// (400 / 800 / 1600px wide) named `<original>_<width>.webp` so the
// frontend can build a real srcset. Source images larger than the variant
// width are downscaled; smaller sources are kept at their native size (no
// upscaling) but still re-encoded so we always upload the three keys the
// frontend asks for.
//
// Two source modes:
//   1. Local directory:  node scripts/upload-r2.mjs <source-dir> [r2-prefix]
//      Walks <source-dir> for *.webp and uploads variants under [r2-prefix].
//   2. R2-to-R2 backfill: node scripts/upload-r2.mjs r2:<src-prefix> [r2-prefix]
//      Lists canonical `<name>.webp` keys under <src-prefix> on the same
//      bucket (skipping anything already ending in `_<width>.webp`),
//      downloads each, and uploads the three sized variants. If
//      [r2-prefix] is omitted, variants are written next to the canonical
//      under <src-prefix>.
//
//   r2-prefix defaults to "catalog/replit_lite/images" (women's catalog).
//   Pass e.g. "catalog/replit_lite_men/images" for the men's catalog.
//   Reads R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET from env.
//   Optional: UPLOAD_CONCURRENCY (default 40), SKIP_EXISTING ("0" disables; default skip),
//             WEBP_QUALITY (default 82), R2_PREFIX (overrides positional prefix).
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";
import sharp from "sharp";

const sourceArg = argv[2];
if (!sourceArg) {
  stderr.write("usage: upload-r2.mjs <source-dir|r2:src-prefix> [r2-prefix]\n");
  exit(1);
}
const fromR2 = sourceArg.startsWith("r2:");
const sourceDir = fromR2 ? null : sourceArg;
const sourcePrefix = fromR2 ? sourceArg.slice(3).replace(/\/+$/, "") : null;

const ENDPOINT = env.R2_S3_ENDPOINT;
const KEY_ID = env.R2_ACCESS_KEY_ID;
const SECRET = env.R2_SECRET_ACCESS_KEY;
const BUCKET = env.R2_BUCKET;
if (!ENDPOINT || !KEY_ID || !SECRET || !BUCKET) {
  stderr.write("Missing R2_S3_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET\n");
  exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
});

const PREFIX = (env.R2_PREFIX ?? argv[3] ?? sourcePrefix ?? "catalog/replit_lite/images").replace(/\/+$/, "");
// Keep these in sync with IMAGE_WIDTHS in artifacts/fashion/src/lib/imageUrl.ts.
const VARIANT_WIDTHS = [400, 800, 1600];
const CONCURRENCY = Number(env.UPLOAD_CONCURRENCY ?? 40);
const SKIP_EXISTING = env.SKIP_EXISTING !== "0";
const WEBP_QUALITY = Number(env.WEBP_QUALITY ?? 82);

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (e.isFile()) {
      out.push(p);
    }
  }
  return out;
}

// A "source" is either a local filesystem path or an R2 object key. In R2
// mode the relative path is computed against `sourcePrefix` so the
// destination layout mirrors the source layout (e.g. `accessories/150316.webp`).
// Walks every key under `prefix` once and partitions them into canonical
// sources (`<name>.webp`) vs. already-uploaded sized variants
// (`<name>_<width>.webp`). The variant set lets us skip the per-key HEAD
// requests on resume — critical when re-running the script repeatedly.
async function listR2Keys(prefix) {
  const sources = [];
  const variants = new Set();
  let ContinuationToken;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}/`, ContinuationToken }),
    );
    for (const obj of resp.Contents ?? []) {
      const key = obj.Key;
      if (!key || !/\.webp$/i.test(key)) continue;
      if (/_(\d+)\.webp$/i.test(key)) variants.add(key);
      else sources.push(key);
    }
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return { sources, variants };
}

let allSources;
let r2VariantIndex = null; // Set<string> of existing variant keys (R2 mode only)
if (fromR2) {
  stdout.write(`Listing r2://${BUCKET}/${sourcePrefix}/ ...\n`);
  const listed = await listR2Keys(sourcePrefix);
  allSources = listed.sources;
  r2VariantIndex = listed.variants;
  stdout.write(`  index: ${allSources.length} canonicals + ${r2VariantIndex.size} existing variants\n`);
} else {
  stdout.write(`Scanning ${sourceDir} ...\n`);
  allSources = (await walk(sourceDir)).filter((f) => /\.webp$/i.test(f));
}
stdout.write(
  `Found ${allSources.length} source images. Bucket=${BUCKET} prefix=${PREFIX} endpoint=${ENDPOINT}\n` +
    `Encoding widths=${VARIANT_WIDTHS.join("/")} quality=${WEBP_QUALITY} concurrency=${CONCURRENCY}\n`,
);

let uploaded = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;
const start = Date.now();

// Only trust the prebuilt variant index when the destination prefix matches
// the source prefix we listed — otherwise it tells us nothing about what
// already exists at the destination, so we must HEAD each key.
const indexCoversDestination = fromR2 && PREFIX === sourcePrefix;

async function exists(key) {
  // R2 mode pre-loaded the full variant index from a single LIST sweep,
  // so we can answer existence in O(1) without per-key HEAD requests.
  // Newly-uploaded variants are added to the index as we go so concurrent
  // workers don't re-upload each other's work.
  if (indexCoversDestination && r2VariantIndex !== null) return r2VariantIndex.has(key);
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === "NotFound" || err.Code === "NotFound") {
      return false;
    }
    throw err;
  }
}

function variantKey(rel, width) {
  // accessories/150316.webp -> accessories/150316_800.webp
  return `${PREFIX}/${rel.replace(/\.webp$/i, `_${width}.webp`)}`;
}

async function readR2Object(key) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function uploadOne(source) {
  // `source` is either a local path or an R2 object key. Compute `rel`
  // (e.g. "accessories/150316.webp") relative to the source root so the
  // destination key is `<PREFIX>/<rel-with-width>`.
  const rel = fromR2
    ? source.slice(sourcePrefix.length + 1)
    : relative(sourceDir, source);
  try {
    // Fast-path: when all variants already exist, skip the (potentially
    // expensive) source download entirely. Critical for resuming R2->R2
    // backfills where the canonical lives behind another network hop.
    if (SKIP_EXISTING) {
      const checks = await Promise.all(VARIANT_WIDTHS.map((w) => exists(variantKey(rel, w))));
      if (checks.every(Boolean)) {
        skipped += VARIANT_WIDTHS.length;
        return;
      }
    }
    const buf = fromR2 ? await readR2Object(source) : await readFile(source);
    // Decode once, then derive each variant from the shared pipeline so we
    // pay the JPEG/PNG/webp parse cost a single time per source image.
    const sourceImg = sharp(buf, { failOn: "none" });
    const meta = await sourceImg.metadata();
    const srcWidth = meta.width ?? 0;

    for (const w of VARIANT_WIDTHS) {
      const key = variantKey(rel, w);
      if (SKIP_EXISTING && (await exists(key))) {
        skipped++;
        continue;
      }
      // withoutEnlargement: never upscale beyond the source's native width;
      // a small source image will simply be re-encoded at its real size.
      const body = await sourceImg
        .clone()
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: body,
          ContentType: "image/webp",
          CacheControl: "public, max-age=31536000, immutable",
          Metadata: { "src-width": String(srcWidth), "variant-width": String(w) },
        }),
      );
      uploaded++;
      bytes += body.length;
      if (r2VariantIndex !== null) r2VariantIndex.add(key);
    }
  } catch (err) {
    failed++;
    if (failed < 10) stderr.write(`FAIL ${rel}: ${err.name ?? ""} ${err.message ?? err}\n`);
  }
}

const queue = allSources.slice();
async function worker() {
  while (queue.length > 0) {
    const f = queue.shift();
    if (!f) return;
    await uploadOne(f);
    const total = uploaded + skipped + failed;
    if (total > 0 && total % 500 === 0) {
      const sec = (Date.now() - start) / 1000;
      const rate = total / Math.max(sec, 0.001);
      stdout.write(
        `  ${total} variants (up=${uploaded} skip=${skipped} fail=${failed}) ${(bytes / 1024 / 1024).toFixed(1)} MB in ${sec.toFixed(0)}s (${rate.toFixed(1)}/s)\n`,
      );
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const sec = (Date.now() - start) / 1000;
stdout.write(
  `Done. up=${uploaded} skip=${skipped} fail=${failed} (${(bytes / 1024 / 1024).toFixed(1)} MB) in ${sec.toFixed(0)}s\n`,
);
exit(failed > 0 ? 2 : 0);
