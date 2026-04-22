// The actual resolve hook (loaded off-thread by `--import` →
// `register()`). See test-resolver.mjs for the rationale.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

function probe(url) {
  // Already has a recognised extension? Nothing to do.
  if (/\.[a-z]+$/i.test(url)) return null;
  let path;
  try {
    path = fileURLToPath(url);
  } catch {
    return null;
  }
  if (existsSync(`${path}.ts`)) return `${url}.ts`;
  if (existsSync(path) && statSync(path).isDirectory()) {
    if (existsSync(`${path}/index.ts`)) return `${url}/index.ts`;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (
        err && (err.code === "ERR_MODULE_NOT_FOUND" ||
          err.code === "ERR_UNSUPPORTED_DIR_IMPORT")
      ) {
        const baseUrl = context.parentURL ?? pathToFileURL(`${process.cwd()}/`).href;
        const candidate = new URL(specifier, baseUrl).href;
        const fixed = probe(candidate);
        if (fixed) return nextResolve(fixed, context);
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
