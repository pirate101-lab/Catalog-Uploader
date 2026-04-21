#!/usr/bin/env node
// CI wrapper around check-featured-bucket.mjs (Task #9).
//
// The underlying regression check requires a running API server. To make
// the check usable from a non-interactive validation pipeline, this
// wrapper boots the built API server on an ephemeral port, waits for
// /api/healthz to come up, runs the check against it, and tears the
// server back down — propagating the check's exit code.
//
// Expects ./dist/index.mjs to already be built (the pnpm script wires
// `build` in front of this).

import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiServerDir = resolve(__dirname, "..");
const serverEntry = resolve(apiServerDir, "dist/index.mjs");
const checkScript = resolve(__dirname, "check-featured-bucket.mjs");

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 200;

async function pickFreePort() {
  return await new Promise((resolvePort, rejectPort) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", rejectPort);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolvePort(port));
      } else {
        srv.close(() => rejectPort(new Error("Could not pick a free port")));
      }
    });
  });
}

async function waitForReady(baseUrl, deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/healthz`);
      if (res.ok) return;
    } catch {
      // not yet listening
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  throw new Error(`API server did not become ready within ${READY_TIMEOUT_MS}ms`);
}

function runCheck(baseUrl) {
  return new Promise((resolveCode) => {
    const child = spawn(process.execPath, [checkScript], {
      stdio: "inherit",
      env: { ...process.env, API_URL: baseUrl },
    });
    child.on("exit", (code, signal) => {
      resolveCode(typeof code === "number" ? code : signal ? 1 : 0);
    });
  });
}

const port = await pickFreePort();
const baseUrl = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ["--enable-source-maps", serverEntry], {
  cwd: apiServerDir,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
});

let serverExited = false;
const serverDone = once(server, "exit").then(() => {
  serverExited = true;
});

let exitCode = 1;
try {
  await Promise.race([
    waitForReady(baseUrl, Date.now() + READY_TIMEOUT_MS),
    serverDone.then(() => {
      throw new Error("API server exited before becoming ready");
    }),
  ]);
  exitCode = await runCheck(baseUrl);
} catch (err) {
  console.error(`FAIL ci-check-featured-bucket: ${err instanceof Error ? err.message : String(err)}`);
  exitCode = 1;
} finally {
  if (!serverExited) {
    server.kill("SIGTERM");
    const killTimer = setTimeout(() => server.kill("SIGKILL"), 5_000);
    await serverDone.catch(() => {});
    clearTimeout(killTimer);
  }
}

process.exit(exitCode);
