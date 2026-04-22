import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { buildResumeUrl, verifyResumeToken } from "./paystackResume.ts";

const SECRET = "sk_test_primary_secret";
const OTHER_SECRET = "sk_test_rotated_secret";
const ORDER_ID = "order_abc_123";
const ORIGIN = "https://shop.example.com";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function parseToken(url: string): { orderParam: string; token: string } {
  const u = new URL(url);
  return {
    orderParam: u.searchParams.get("order") ?? "",
    token: u.searchParams.get("token") ?? "",
  };
}

function mintToken(
  orderId: string,
  expiresAt: number,
  secret: string,
): string {
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}.${expiresAt}`)
    .digest("base64url");
  return `${expiresAt}.${sig}`;
}

describe("buildResumeUrl", () => {
  it("produces a URL pointing at the resume endpoint with order and token params", () => {
    const url = buildResumeUrl(ORIGIN, ORDER_ID, SECRET);
    const parsed = new URL(url);
    assert.equal(parsed.origin, ORIGIN);
    assert.equal(parsed.pathname, "/api/checkout/paystack/resume");
    assert.equal(parsed.searchParams.get("order"), ORDER_ID);
    const token = parsed.searchParams.get("token");
    assert.ok(token, "token query param should be present");
    assert.match(token!, /^\d+\.[A-Za-z0-9_-]+$/);
  });

  it("URL-encodes order ids that contain reserved characters", () => {
    const tricky = "order/with spaces&weird=chars";
    const url = buildResumeUrl(ORIGIN, tricky, SECRET);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("order"), tricky);
  });

  it("sets the token expiry roughly 7 days into the future", () => {
    const before = Date.now();
    const url = buildResumeUrl(ORIGIN, ORDER_ID, SECRET);
    const after = Date.now();
    const { token } = parseToken(url);
    const exp = Number(token.split(".")[0]);
    assert.ok(exp >= before + SEVEN_DAYS_MS);
    assert.ok(exp <= after + SEVEN_DAYS_MS);
  });

  it("produces distinct tokens on repeated calls (expiry advances each call)", async () => {
    const a = buildResumeUrl(ORIGIN, ORDER_ID, SECRET);
    await new Promise((r) => setTimeout(r, 5));
    const b = buildResumeUrl(ORIGIN, ORDER_ID, SECRET);
    assert.notEqual(parseToken(a).token, parseToken(b).token);
  });
});

describe("verifyResumeToken", () => {
  it("accepts a freshly minted token", () => {
    const { token } = parseToken(buildResumeUrl(ORIGIN, ORDER_ID, SECRET));
    assert.equal(verifyResumeToken(ORDER_ID, token, SECRET), true);
  });

  it("rejects an expired token", () => {
    const expired = mintToken(ORDER_ID, Date.now() - 1000, SECRET);
    assert.equal(verifyResumeToken(ORDER_ID, expired, SECRET), false);
  });

  it("rejects a token signed with a different secret (secret rotation invalidates links)", () => {
    const { token } = parseToken(buildResumeUrl(ORIGIN, ORDER_ID, OTHER_SECRET));
    assert.equal(verifyResumeToken(ORDER_ID, token, SECRET), false);
  });

  it("rejects a token when the order id is tampered with", () => {
    const { token } = parseToken(buildResumeUrl(ORIGIN, ORDER_ID, SECRET));
    assert.equal(verifyResumeToken("order_evil_999", token, SECRET), false);
  });

  it("rejects a token when the embedded expiry is tampered with", () => {
    const { token } = parseToken(buildResumeUrl(ORIGIN, ORDER_ID, SECRET));
    const dot = token.indexOf(".");
    const exp = Number(token.slice(0, dot));
    const sig = token.slice(dot + 1);
    const tampered = `${exp + 1000}.${sig}`;
    assert.equal(verifyResumeToken(ORDER_ID, tampered, SECRET), false);
  });

  it("rejects a token with no dot separator", () => {
    assert.equal(verifyResumeToken(ORDER_ID, "no-dot-here", SECRET), false);
  });

  it("rejects a token whose expiry segment is non-numeric", () => {
    const validExp = Date.now() + SEVEN_DAYS_MS;
    const sig = crypto
      .createHmac("sha256", SECRET)
      .update(`${ORDER_ID}.${validExp}`)
      .digest("base64url");
    assert.equal(
      verifyResumeToken(ORDER_ID, `notanumber.${sig}`, SECRET),
      false,
    );
  });

  it("rejects a token that starts with a dot (empty expiry segment)", () => {
    assert.equal(verifyResumeToken(ORDER_ID, ".somesig", SECRET), false);
  });

  it("rejects a token with an empty signature segment", () => {
    const exp = Date.now() + SEVEN_DAYS_MS;
    assert.equal(verifyResumeToken(ORDER_ID, `${exp}.`, SECRET), false);
  });

  it("rejects a signature of the right length but wrong bytes (timing-safe path)", () => {
    const exp = Date.now() + SEVEN_DAYS_MS;
    const real = crypto
      .createHmac("sha256", SECRET)
      .update(`${ORDER_ID}.${exp}`)
      .digest("base64url");
    const forged = "A".repeat(real.length);
    assert.notEqual(forged, real);
    assert.equal(verifyResumeToken(ORDER_ID, `${exp}.${forged}`, SECRET), false);
  });

  it("rejects an empty token", () => {
    assert.equal(verifyResumeToken(ORDER_ID, "", SECRET), false);
  });

  it("round-trips through buildResumeUrl -> URL parse -> verifyResumeToken", () => {
    const url = buildResumeUrl(ORIGIN, ORDER_ID, SECRET);
    const { orderParam, token } = parseToken(url);
    assert.equal(orderParam, ORDER_ID);
    assert.equal(verifyResumeToken(orderParam, token, SECRET), true);
  });
});
