// Upload catalog images to object storage in parallel.
// Usage: PUBLIC_OBJECT_SEARCH_PATHS=... node scripts/upload-catalog.mjs <source-dir>
import { Storage } from "@google-cloud/storage";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";

const SIDECAR = "http://127.0.0.1:1106";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

const sourceDir = argv[2];
if (!sourceDir) {
  stderr.write("usage: upload-catalog.mjs <source-dir>\n");
  exit(1);
}

const publicPaths = (env.PUBLIC_OBJECT_SEARCH_PATHS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (publicPaths.length === 0) {
  stderr.write("PUBLIC_OBJECT_SEARCH_PATHS is not set\n");
  exit(1);
}
const basePath = publicPaths[0];
const parts = basePath.replace(/^\/+/, "").split("/");
const bucketName = parts[0];
const baseObjectPrefix = parts.slice(1).join("/"); // e.g. "public"
const bucket = storage.bucket(bucketName);

const PREFIX = "catalog/replit_lite/images";
const CONCURRENCY = Number(env.UPLOAD_CONCURRENCY ?? 80);
const SKIP_EXISTING = env.SKIP_EXISTING !== "0";

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await walk(p);
      out.push(...sub);
    } else if (e.isFile()) {
      out.push(p);
    }
  }
  return out;
}

stdout.write(`Scanning ${sourceDir} ...\n`);
const allFiles = await walk(sourceDir);
stdout.write(`Found ${allFiles.length} files. Bucket=${bucketName} prefix=${baseObjectPrefix}/${PREFIX}\n`);

let uploaded = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;
const start = Date.now();

async function uploadOne(localPath) {
  const rel = relative(sourceDir, localPath); // e.g. accessories/150316.webp
  const objectName = `${baseObjectPrefix}/${PREFIX}/${rel}`;
  const file = bucket.file(objectName);
  try {
    if (SKIP_EXISTING) {
      const [exists] = await file.exists();
      if (exists) {
        skipped++;
        return;
      }
    }
    const st = await stat(localPath);
    await bucket.upload(localPath, {
      destination: objectName,
      metadata: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" },
      resumable: false,
    });
    uploaded++;
    bytes += st.size;
  } catch (err) {
    failed++;
    if (failed < 5) stderr.write(`FAIL ${rel}: ${err.message}\n`);
  }
}

const queue = allFiles.slice();
async function worker() {
  while (queue.length > 0) {
    const f = queue.shift();
    if (!f) return;
    await uploadOne(f);
    const total = uploaded + skipped + failed;
    if (total % 500 === 0) {
      const sec = (Date.now() - start) / 1000;
      stdout.write(`  ${total}/${allFiles.length} (up=${uploaded} skip=${skipped} fail=${failed}) ${(bytes / 1024 / 1024).toFixed(1)} MB in ${sec.toFixed(0)}s\n`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const sec = (Date.now() - start) / 1000;
stdout.write(`Done. up=${uploaded} skip=${skipped} fail=${failed} (${(bytes / 1024 / 1024).toFixed(1)} MB) in ${sec.toFixed(0)}s\n`);
exit(failed > 0 ? 2 : 0);
