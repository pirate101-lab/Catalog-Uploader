// Re-encode catalog images into multiple widths and upload them to Cloudflare
// R2 in parallel via the S3-compatible API.
//
// For every source .webp under <source-dir>, this emits three responsive
// variants (400 / 800 / 1600px wide) named `<original>_<width>.webp` so the
// frontend can build a real srcset. Source files larger than the variant
// width are downscaled; smaller files are kept at their native size (no
// upscaling) but still re-encoded so we always upload the three keys the
// frontend asks for.
//
// Usage: node scripts/upload-r2.mjs <source-dir>
//   Reads R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET from env.
//   Optional: UPLOAD_CONCURRENCY (default 40), SKIP_EXISTING ("0" disables; default skip),
//             WEBP_QUALITY (default 82).
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";
import sharp from "sharp";

const sourceDir = argv[2];
if (!sourceDir) {
  stderr.write("usage: upload-r2.mjs <source-dir>\n");
  exit(1);
}

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

const PREFIX = "catalog/replit_lite/images";
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

stdout.write(`Scanning ${sourceDir} ...\n`);
const allFiles = (await walk(sourceDir)).filter((f) => /\.webp$/i.test(f));
stdout.write(
  `Found ${allFiles.length} source images. Bucket=${BUCKET} prefix=${PREFIX} endpoint=${ENDPOINT}\n` +
    `Encoding widths=${VARIANT_WIDTHS.join("/")} quality=${WEBP_QUALITY} concurrency=${CONCURRENCY}\n`,
);

let uploaded = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;
const start = Date.now();

async function exists(key) {
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

async function uploadOne(localPath) {
  const rel = relative(sourceDir, localPath); // accessories/150316.webp
  try {
    // Decode once, then derive each variant from the shared pipeline so we
    // pay the JPEG/PNG/webp parse cost a single time per source image.
    const source = sharp(await readFile(localPath), { failOn: "none" });
    const meta = await source.metadata();
    const srcWidth = meta.width ?? 0;

    for (const w of VARIANT_WIDTHS) {
      const key = variantKey(rel, w);
      if (SKIP_EXISTING && (await exists(key))) {
        skipped++;
        continue;
      }
      // withoutEnlargement: never upscale beyond the source's native width;
      // a small source image will simply be re-encoded at its real size.
      const body = await source
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
    }
  } catch (err) {
    failed++;
    if (failed < 10) stderr.write(`FAIL ${rel}: ${err.name ?? ""} ${err.message ?? err}\n`);
  }
}

const queue = allFiles.slice();
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
