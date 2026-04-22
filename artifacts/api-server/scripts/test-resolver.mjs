// Custom Node resolver hook used only by `pnpm test`. The api-server
// source omits explicit `.ts` extensions on relative imports because
// the production build is bundled by esbuild, which resolves them
// implicitly. Node's native ESM loader does NOT — so when our test
// files load real modules (admin router, lib helpers, …) the chain
// breaks at the very first extensionless import.
//
// We register a resolve hook that, when an extensionless relative
// specifier fails to resolve, retries with `.ts` (or `/index.ts`)
// appended. Keeps the production source untouched while letting
// `node --test` exercise the real code paths end-to-end.
import { register } from "node:module";

register("./test-resolver-hooks.mjs", import.meta.url);
