// #!/usr/bin/env node

/**
 * DERMS Offline Readiness Checker
 * Compatible with Windows, Linux and macOS.
 * Run from the DERMS project root:
 *   node scripts/check-offline-readiness.mjs
 *
 * Read-only audit: does not install, delete or modify packages.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const results = [];
let errors = 0;
let warnings = 0;

function report(status, name, detail = "") {
  const symbol =
    {
      PASS: "[PASS]",
      FAIL: "[FAIL]",
      WARN: "[WARN]",
      INFO: "[INFO]",
    }[status] || "[INFO]";

  console.log(`${symbol} ${name}${detail ? ` — ${detail}` : ""}`);

  results.push({ status, name, detail });
  if (status === "FAIL") errors++;
  if (status === "WARN") warnings++;
}

function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

function command(cmd, args = []) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
    shell: false,
  });
}

function versionOf(cmd, args = ["--version"]) {
  const r = command(cmd, args);
  return r.status === 0
    ? (r.stdout || r.stderr || "").trim().split(/\r?\n/)[0]
    : null;
}

function checkPort(port, host = "127.0.0.1", timeout = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function readEnv() {
  const files = [".env.local", ".env"];
  const values = {};

  for (const file of files) {
    if (!exists(file)) continue;

    const content = fs.readFileSync(path.join(ROOT, file), "utf8");

    for (const line of content.split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
      );

      if (match && values[match[1]] === undefined) {
        values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
      }
    }
  }

  return values;
}

function majorVersion(version) {
  const match = version?.match(/v?(\d+)\./);
  return match ? Number(match[1]) : null;
}

async function main() {
  console.log("\n========================================");
  console.log(" DERMS — OFFLINE READINESS AUDIT");
  console.log("========================================");
  console.log(`OS: ${os.platform()} ${os.release()}`);
  console.log(`Architecture: ${os.arch()}`);
  console.log(`Project: ${ROOT}\n`);

  // 1. Runtime
  const nodeVersion = versionOf("node");
  const npmVersion = versionOf("npm");

  if (nodeVersion) {
    const major = majorVersion(nodeVersion);
    const minor = Number(nodeVersion.match(/^v?\d+\.(\d+)/)?.[1] ?? 0);

    report(
      major > 18 || (major === 18 && minor >= 18) ? "PASS" : "FAIL",
      "Node.js",
      `${nodeVersion} (minimum 18.18)`,
    );
  } else {
    report("FAIL", "Node.js", "Not found in PATH");
  }

  report(
    npmVersion ? "PASS" : "FAIL",
    "npm",
    npmVersion || "Not found in PATH",
  );

  // 2. Project files
  for (const file of [
    "package.json",
    "package-lock.json",
    "node_modules",
    "src",
    "src/realtime/index.ts",
  ]) {
    report(
      exists(file) ? "PASS" : "FAIL",
      file,
      exists(file) ? "Available" : "Missing",
    );
  }

  if (!exists("package.json")) {
    report("FAIL", "Dependency audit", "package.json missing");
    finish();
    return;
  }

  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );

  // 3. Dependency declarations and installed modules
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  report(
    allDeps["next"] &&
      allDeps["mongoose"] &&
      allDeps["mqtt"] &&
      allDeps["ws"] &&
      allDeps["typescript"] &&
      allDeps["tsx"] &&
      allDeps["concurrently"]
      ? "PASS"
      : "FAIL",
    "Required DERMS dependencies",
    "Next.js, Mongoose, MQTT, WebSocket, TypeScript, TSX, concurrently",
  );

  if (exists("node_modules")) {
    const npmLs = command("npm", ["ls", "--depth=0", "--offline"]);

    report(
      npmLs.status === 0 ? "PASS" : "FAIL",
      "Installed npm dependencies",
      npmLs.status === 0
        ? "Top-level dependency tree is valid"
        : "Missing, invalid or incompatible packages; see npm ls output",
    );

    if (npmLs.status !== 0) {
      console.log((npmLs.stdout || "") + (npmLs.stderr || ""));
    }

    for (const name of [
      "next",
      "react",
      "mongoose",
      "mqtt",
      "ws",
      "typescript",
      "tsx",
      "concurrently",
      "aedes",
      "vitest",
      "recharts",
      "jose",
      "bcryptjs",
      "zod",
    ]) {
      const packageFile = path.join(ROOT, "node_modules", name, "package.json");

      report(
        fs.existsSync(packageFile) ? "PASS" : "FAIL",
        `npm module: ${name}`,
        fs.existsSync(packageFile) ? "Installed" : "Missing",
      );
    }
  } else {
    report("FAIL", "node_modules", "Run npm ci before going offline");
  }

  // 4. Offline npm cache
  const cacheResult = command("npm", ["config", "get", "cache"]);
  const cachePath = cacheResult.status === 0 ? cacheResult.stdout.trim() : "";

  report(
    cachePath && fs.existsSync(cachePath) ? "PASS" : "WARN",
    "npm cache directory",
    cachePath || "Could not locate cache",
  );

  if (cachePath && fs.existsSync(cachePath)) {
    const cacheCheck = command("npm", ["cache", "verify"]);

    report(
      cacheCheck.status === 0 ? "PASS" : "WARN",
      "npm cache integrity",
      cacheCheck.status === 0
        ? "Cache verification completed; this does not prove every package is cached"
        : "Cache verification needs investigation",
    );
  }

  // 5. Build tools and project scripts
  for (const script of [
    "dev",
    "build",
    "start",
    "start:realtime",
    "typecheck",
    "test",
    "mqtt:local-broker",
  ]) {
    report(
      typeof pkg.scripts?.[script] === "string" ? "PASS" : "FAIL",
      `npm script: ${script}`,
      pkg.scripts?.[script] || "Missing from package.json",
    );
  }

  // 6. Environment configuration
  const env = readEnv();

  report(
    exists(".env.local") || exists(".env") ? "PASS" : "WARN",
    "Environment file",
    "Checks .env.local and .env; values are never printed",
  );

  for (const key of [
    "MONGODB_URI",
    "AUTH_SECRET",
    "APP_URL",
    "ADMIN_NAME",
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD",
  ]) {
    const value = process.env[key] ?? env[key];
    const present = typeof value === "string" && value.length > 0;

    report(
      present ? "PASS" : "WARN",
      `Environment variable: ${key}`,
      present ? "Set" : "Not found (may prevent full startup)",
    );
  }

  const authSecret = process.env.AUTH_SECRET ?? env.AUTH_SECRET;
  if (authSecret && authSecret.length < 32) {
    report("FAIL", "AUTH_SECRET length", "Must contain at least 32 characters");
  }

  // 7. MongoDB executables and service ports
  for (const binary of ["mongod", "mongosh", "mongodump"]) {
    const version = versionOf(binary);
    report(version ? "PASS" : "WARN", binary, version || "Not found in PATH");
  }

  const mongoPort = await checkPort(27017);
  report(
    mongoPort ? "PASS" : "WARN",
    "MongoDB port 27017",
    mongoPort
      ? "A TCP service is listening; database authentication not verified"
      : "No TCP listener detected on localhost:27017",
  );

  const mongoUri = process.env.MONGODB_URI ?? env.MONGODB_URI;
  if (mongoUri) {
    const localUri =
      /^mongodb(\+srv)?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/?]|$)/i.test(
        mongoUri,
      );

    report(
      "INFO",
      "MongoDB URI",
      localUri
        ? "Configured for localhost"
        : "Configured; remote/offline availability not verified",
    );
  }

  // 8. MQTT broker
  const mqttUrl = process.env.MQTT_URL ?? env.MQTT_URL;
  const localBroker = await checkPort(1883);

  report(
    localBroker ? "PASS" : "WARN",
    "MQTT port 1883",
    localBroker
      ? "TCP listener available; MQTT authentication not verified"
      : "No local broker detected",
  );

  report(
    exists("scripts/local-broker.ts") && allDeps["aedes"] ? "PASS" : "WARN",
    "Bundled test MQTT broker",
    "Requires scripts/local-broker.ts and installed aedes dependency",
  );

  report(
    mqttUrl ? "PASS" : "WARN",
    "MQTT_URL",
    mqttUrl
      ? "Configured (secret value hidden)"
      : "Live MQTT ingestion may be disabled",
  );

  // 9. Production artifacts
  report(
    exists(".next/BUILD_ID") ? "PASS" : "WARN",
    "Next.js production build",
    exists(".next/BUILD_ID")
      ? "Build artifact detected"
      : "No completed production build detected",
  );

  report(
    exists("node_modules/.bin/next") || exists("node_modules/.bin/next.cmd")
      ? "PASS"
      : "FAIL",
    "Next.js executable",
    "Required for web startup and build",
  );

  function finish() {
    console.log("\n========================================");
    console.log(" AUDIT SUMMARY");
    console.log("========================================");
    console.log(`OS: ${os.platform()}`);
    console.log(`PASS: ${results.filter((r) => r.status === "PASS").length}`);
    console.log(`WARN: ${warnings}`);
    console.log(`FAIL: ${errors}`);
    console.log("\nThis audit does not install or change anything.");
    console.log("A PASS does not guarantee that all services work offline.");
    console.log("========================================\n");
  }

  finish();

  if (errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Audit failed:", error.message);
  process.exitCode = 1;
});
