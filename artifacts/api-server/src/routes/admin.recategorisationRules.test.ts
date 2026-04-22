import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";

import {
  db,
  recategorisationRulesTable,
  recategorisationRulesMetaTable,
} from "@workspace/db";
import adminRouter from "./admin.ts";
import {
  _resetRecategorisationRulesCacheForTests,
  ensureRecategorisationRulesLoaded,
  getCompiledRulesSync,
} from "../lib/recategorisationRules.ts";
import {
  setActiveRecategorisationRules,
  invalidateCatalog,
  getAllProducts,
} from "../lib/catalog.ts";

/* ---------- Test server harness ----------
 * Mounts the real admin router behind a no-op auth shim so we can hit
 * the /admin/recategorisation-rules CRUD endpoints over real HTTP.
 * The shim mirrors the OIDC-admin path of `requireAdmin` (authenticated
 * + oidc + empty allowlist + non-production env), which the middleware
 * lets through with a single warning.
 */
let server: Server;
let baseUrl: string;

before(async () => {
  // Make sure requireAdmin's "allowlist empty + production" guard
  // doesn't trip — we want the dev-mode pass-through path.
  delete process.env["ADMIN_EMAILS"];
  if (process.env["NODE_ENV"] === "production") {
    process.env["NODE_ENV"] = "test";
  }
  const app = express();
  app.use(express.json());
  // Minimal stand-in for the auth + pino-http middleware that production
  // installs ahead of the admin router. Sets just enough of req for
  // `requireAdmin` to take its happy path.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated =
      () => true;
    (req as unknown as { authProvider: string }).authProvider = "oidc";
    (req as unknown as { user: { email: string } }).user = {
      email: "test-admin@example.com",
    };
    (req as unknown as { log: { warn: () => void; info: () => void; error: () => void } }).log =
      { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use(adminRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

async function resetRulesTables(): Promise<void> {
  await db.delete(recategorisationRulesTable);
  await db.delete(recategorisationRulesMetaTable);
}

beforeEach(async () => {
  _resetRecategorisationRulesCacheForTests();
  setActiveRecategorisationRules(null);
  invalidateCatalog();
  await resetRulesTables();
});

after(async () => {
  _resetRecategorisationRulesCacheForTests();
  setActiveRecategorisationRules(null);
  invalidateCatalog();
  await resetRulesTables();
});

async function jsonRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

describe("POST /admin/recategorisation-rules", () => {
  it("rejects an invalid regex pattern with a 400 and a descriptive error", async () => {
    const res = await jsonRequest("POST", "/admin/recategorisation-rules", {
      label: "Broken",
      // Unbalanced parenthesis — not a valid regex.
      pattern: "(unclosed",
      targetCategory: "tops",
    });
    assert.equal(res.status, 400);
    const body = res.body as { error?: string };
    assert.ok(body.error, "expected an error message");
    assert.match(body.error!, /pattern is not a valid regex/);
    // Nothing should have been persisted.
    const rows = await db.select().from(recategorisationRulesTable);
    assert.equal(rows.length, 0);
  });

  it("creates a rule when the body is valid and primes the in-memory cache", async () => {
    const res = await jsonRequest("POST", "/admin/recategorisation-rules", {
      label: "Activewear",
      pattern: "\\b(legging|yoga|sports?[\\s-]?bra)\\b",
      targetCategory: "activewear",
    });
    assert.equal(res.status, 201);
    const created = res.body as { id: number; label: string; enabled: boolean };
    assert.equal(created.label, "Activewear");
    assert.equal(created.enabled, true);
    // Cache was reloaded by the route so the next storefront fetch
    // sees the new rule without a cold-start penalty.
    const cache = getCompiledRulesSync();
    assert.ok(cache);
    const labels = cache.map((r) => r.label);
    assert.ok(labels.includes("Activewear"));
  });
});

describe("PATCH /admin/recategorisation-rules/:id", () => {
  it("toggles the enabled flag and refreshes the active cache so the rule stops firing", async () => {
    // Seed one rule directly so we control its id.
    const [row] = await db
      .insert(recategorisationRulesTable)
      .values({
        label: "Toggle me",
        pattern: "\\bbikini\\b",
        targetCategory: "swimwear",
        enabled: true,
        sortOrder: 0,
      })
      .returning();
    assert.ok(row);
    // Mark the rules table as seeded so the loader doesn't re-add defaults.
    await db
      .insert(recategorisationRulesMetaTable)
      .values({ id: 1 })
      .onConflictDoNothing();
    await ensureRecategorisationRulesLoaded();
    assert.equal(
      (getCompiledRulesSync() ?? []).some((r) => r.label === "Toggle me"),
      true,
    );

    // Disable it via PATCH.
    const res = await jsonRequest(
      "PATCH",
      `/admin/recategorisation-rules/${row.id}`,
      { enabled: false },
    );
    assert.equal(res.status, 200);
    assert.equal((res.body as { enabled: boolean }).enabled, false);

    // Persisted change.
    const [reloaded] = await db
      .select()
      .from(recategorisationRulesTable)
      .where(eq(recategorisationRulesTable.id, row.id));
    assert.equal(reloaded?.enabled, false);

    // Active cache no longer includes the disabled rule.
    const cache = getCompiledRulesSync();
    assert.ok(cache);
    assert.equal(
      cache.some((r) => r.label === "Toggle me"),
      false,
      "disabled rule must drop out of the active cache after PATCH",
    );
  });

  it("rejects a PATCH whose pattern is invalid without changing the row", async () => {
    const [row] = await db
      .insert(recategorisationRulesTable)
      .values({
        label: "Stable",
        pattern: "\\bdress\\b",
        targetCategory: "dresses",
        enabled: true,
        sortOrder: 0,
      })
      .returning();
    assert.ok(row);
    const res = await jsonRequest(
      "PATCH",
      `/admin/recategorisation-rules/${row.id}`,
      { pattern: "(also broken" },
    );
    assert.equal(res.status, 400);
    const [unchanged] = await db
      .select()
      .from(recategorisationRulesTable)
      .where(eq(recategorisationRulesTable.id, row.id));
    assert.equal(unchanged?.pattern, "\\bdress\\b");
  });
});

describe("DELETE /admin/recategorisation-rules/:id", () => {
  it("removes the rule and invalidates the catalog cache so the next fetch rebuilds without it", async () => {
    // Seed a rule with a unique pattern that would move our test row.
    const [row] = await db
      .insert(recategorisationRulesTable)
      .values({
        label: "Outerwear test",
        pattern: "\\boutewear-marker\\b",
        targetCategory: "outerwear",
        enabled: true,
        sortOrder: 0,
      })
      .returning();
    assert.ok(row);
    await db
      .insert(recategorisationRulesMetaTable)
      .values({ id: 1 })
      .onConflictDoNothing();
    await ensureRecategorisationRulesLoaded();

    // Prime the catalog cache so we can detect the invalidation. We
    // don't depend on what's in the on-disk JSON catalog — only that
    // calling getAllProducts() twice without an invalidation between
    // returns the same array reference.
    const firstLoad = getAllProducts();
    assert.equal(getAllProducts(), firstLoad, "sanity: cache should be sticky");

    // The rule we created is in the active cache pre-delete.
    const before = getCompiledRulesSync() ?? [];
    assert.equal(
      before.some((r) => r.id === row.id),
      true,
    );

    const res = await jsonRequest(
      "DELETE",
      `/admin/recategorisation-rules/${row.id}`,
    );
    assert.equal(res.status, 204);

    // Row is gone from the DB.
    const remaining = await db
      .select()
      .from(recategorisationRulesTable)
      .where(eq(recategorisationRulesTable.id, row.id));
    assert.equal(remaining.length, 0);

    // The catalog cache was dropped — getAllProducts() now returns a
    // freshly-built array (different reference) because the route's
    // invalidateRecategorisationRules() called invalidateCatalog().
    const afterLoad = getAllProducts();
    assert.notEqual(
      afterLoad,
      firstLoad,
      "catalog cache should be invalidated after DELETE so the next fetch rebuilds",
    );

    // Active rule cache no longer carries the deleted rule.
    const after = getCompiledRulesSync() ?? [];
    assert.equal(
      after.some((r) => r.id === row.id),
      false,
    );
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await jsonRequest("DELETE", "/admin/recategorisation-rules/abc");
    assert.equal(res.status, 400);
  });
});
