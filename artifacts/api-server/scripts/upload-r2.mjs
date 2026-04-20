// Upload catalog images to Cloudflare R2 in parallel via the S3-compatible API.
// Usage: node scripts/upload-r2.mjs <source-dir>
//   Reads R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET from env.
//   Optional: UPLOAD_CONCURRENCY (default 80), SKIP_EXISTING ("0" disables; default skip).
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";

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
const CONCURRENCY = Number(env.UPLOAD_CONCURRENCY ?? 80);
const SKIP_EXISTING = env.SKIP_EXISTING !== "0";

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
const allFiles = await walk(sourceDir);
stdout.write(`Found ${allFiles.length} files. Bucket=${BUCKET} prefix=${PREFIX} endpoint=${ENDPOINT}\n`);

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

async function uploadOne(localPath) {
  const rel = relative(sourceDir, localPath); // accessories/150316.webp
  const key = `${PREFIX}/${rel}`;
  try {
    if (SKIP_EXISTING && (await exists(key))) {
      skipped++;
      return;
    }
    const body = await readFile(localPath);
    const st = await stat(localPath);
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    }));
    uploaded++;
    bytes += st.size;
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
      stdout.write(`  ${total}/${allFiles.length} (up=${uploaded} skip=${skipped} fail=${failed}) ${(bytes / 1024 / 1024).toFixed(1)} MB in ${sec.toFixed(0)}s (${rate.toFixed(1)}/s)\n`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const sec = (Date.now() - start) / 1000;
stdout.write(`Done. up=${uploaded} skip=${skipped} fail=${failed} (${(bytes / 1024 / 1024).toFixed(1)} MB) in ${sec.toFixed(0)}s\n`);
exit(failed > 0 ? 2 : 0);
