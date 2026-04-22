import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  buildOrderViewUrl,
  mintOrderViewToken,
  verifyOrderViewToken,
} from "./orderViewToken.ts";

const SECRET = "session_secret_primary";
const OTHER_SECRET = "session_secret_rotated";
const ORDER_ID = "order_abc_123";
const STOREFRONT = "https://shop.example.com";
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

let originalSecret: string | undefined;

before(() => {
  originalSecret = process.env["SESSION_SECRET"];
});

after(() => {
  if (originalSecret === undefined) {
    delete process.env["SESSION_SECRET"];
  } else {
    process.env["SESSION_SECRET"] = originalSecret;
  }
});

beforeEach(() => {
  process.env["SESSION_SECRET"] = SECRET;
});

function parseToken(url: string): { orderPath: string; token: string } {
  const u = new URL(url);
  const segs = u.pathname.split("/");
  const orderPath = decodeURIComponent(segs[segs.length - 1] ?? "");
  return {
    orderPath,
    token: u.searchParams.get("t") ?? "",
  };
}

function signWith(orderId: string, expiresAt: number, secret: string): string {
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`order-view:${orderId}.${expiresAt}`)
    .digest("base64url");
  return `${expiresAt}.${sig}`;
}

describe("mintOrderViewToken", () => {
  it("throws when SESSION_SECRET is not set", () => {
    delete process.env["SESSION_SECRET"];
    assert.throws(() => mintOrderViewToken(ORDER_ID), /SESSION_SECRET/);
  });

  it("sets the token expiry roughly 90 days into the future", () => {
    const before = Date.now();
    const token = mintOrderViewToken(ORDER_ID);
    const after = Date.now();
    const exp = Number(token.split(".")[0]);
    assert.ok(exp >= before + NINETY_DAYS_MS);
    assert.ok(exp <= after + NINETY_DAYS_MS);
  });

  it("produces a token in the form `<expiry>.<base64url-sig>`", () => {
    const token = mintOrderViewToken(ORDER_ID);
    assert.match(token, /^\d+\.[A-Za-z0-9_-]+$/);
  });

  it("produces distinct tokens on repeated calls (expiry advances)", async () => {
    const a = mintOrderViewToken(ORDER_ID);
    await new Promise((r) => setTimeout(r, 5));
    const b = mintOrderViewToken(ORDER_ID);
    assert.notEqual(a, b);
  });
});

describe("buildOrderViewUrl", () => {
  it("produces a URL pointing at /orders/<id> with a `t` query token", () => {
    const url = buildOrderViewUrl(STOREFRONT, ORDER_ID);
    const parsed = new URL(url);
    assert.equal(parsed.origin, STOREFRONT);
    assert.equal(parsed.pathname, `/orders/${ORDER_ID}`);
    const token = parsed.searchParams.get("t");
    assert.ok(token, "t query param should be present");
    assert.match(token!, /^\d+\.[A-Za-z0-9_-]+$/);
  });

  it("strips trailing slashes from the storefront base URL", () => {
    const url = buildOrderViewUrl(`${STOREFRONT}///`, ORDER_ID);
    const parsed = new URL(url);
    assert.equal(parsed.origin, STOREFRONT);
    assert.equal(parsed.pathname, `/orders/${ORDER_ID}`);
  });

  it("URL-encodes order ids that contain reserved characters", () => {
    const tricky = "order/with spaces&weird=chars";
    const url = buildOrderViewUrl(STOREFRONT, tricky);
    const { orderPath } = parseToken(url);
    assert.equal(orderPath, tricky);
  });
});

describe("verifyOrderViewToken", () => {
  it("accepts a freshly minted token", () => {
    const token = mintOrderViewToken(ORDER_ID);
    assert.equal(verifyOrderViewToken(ORDER_ID, token), true);
  });

  it("accepts a token round-tripped through buildOrderViewUrl", () => {
    const url = buildOrderViewUrl(STOREFRONT, ORDER_ID);
    const { orderPath, token } = parseToken(url);
    assert.equal(orderPath, ORDER_ID);
    assert.equal(verifyOrderViewToken(orderPath, token), true);
  });

  it("rejects an expired token", () => {
    const expired = signWith(ORDER_ID, Date.now() - 1000, SECRET);
    assert.equal(verifyOrderViewToken(ORDER_ID, expired), false);
  });

  it("rejects a token signed with a different secret (secret rotation invalidates links)", () => {
    const exp = Date.now() + NINETY_DAYS_MS;
    const foreign = signWith(ORDER_ID, exp, OTHER_SECRET);
    assert.equal(verifyOrderViewToken(ORDER_ID, foreign), false);
  });

  it("rejects a token when the order id is tampered with", () => {
    const token = mintOrderViewToken(ORDER_ID);
    assert.equal(verifyOrderViewToken("order_evil_999", token), false);
  });

  it("rejects a token when the embedded expiry is tampered with", () => {
    const token = mintOrderViewToken(ORDER_ID);
    const dot = token.indexOf(".");
    const exp = Number(token.slice(0, dot));
    const sig = token.slice(dot + 1);
    const tampered = `${exp + 1000}.${sig}`;
    assert.equal(verifyOrderViewToken(ORDER_ID, tampered), false);
  });

  it("rejects a token with no dot separator", () => {
    assert.equal(verifyOrderViewToken(ORDER_ID, "no-dot-here"), false);
  });

  it("rejects a token that starts with a dot (empty expiry segment)", () => {
    assert.equal(verifyOrderViewToken(ORDER_ID, ".somesig"), false);
  });

  it("rejects a token whose expiry segment is non-numeric", () => {
    const exp = Date.now() + NINETY_DAYS_MS;
    const sig = crypto
      .createHmac("sha256", SECRET)
      .update(`order-view:${ORDER_ID}.${exp}`)
      .digest("base64url");
    assert.equal(verifyOrderViewToken(ORDER_ID, `notanumber.${sig}`), false);
  });

  it("rejects a token with an empty signature segment", () => {
    const exp = Date.now() + NINETY_DAYS_MS;
    assert.equal(verifyOrderViewToken(ORDER_ID, `${exp}.`), false);
  });

  it("rejects a signature of the right length but wrong bytes (timing-safe path)", () => {
    const exp = Date.now() + NINETY_DAYS_MS;
    const real = crypto
      .createHmac("sha256", SECRET)
      .update(`order-view:${ORDER_ID}.${exp}`)
      .digest("base64url");
    const forged = "A".repeat(real.length);
    assert.notEqual(forged, real);
    assert.equal(verifyOrderViewToken(ORDER_ID, `${exp}.${forged}`), false);
  });

  it("rejects an empty token", () => {
    assert.equal(verifyOrderViewToken(ORDER_ID, ""), false);
  });

  it("throws when SESSION_SECRET is missing during verification of an otherwise-valid token", () => {
    const token = mintOrderViewToken(ORDER_ID);
    delete process.env["SESSION_SECRET"];
    assert.throws(() => verifyOrderViewToken(ORDER_ID, token), /SESSION_SECRET/);
  });
});
