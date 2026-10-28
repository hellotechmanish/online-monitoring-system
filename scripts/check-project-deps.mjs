#!/usr/bin/env node
/**
 * DERMS project dependency audit (read-only).
 * Run from the DERMS project root:
 *   node scripts/check-project-deps.mjs
 * Compatible with Windows, Linux and macOS.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const results = [];
let failures = 0;
let warnings = 0;

function report(status, label, detail = "") {
  console.log(`[${status}] ${label}${detail ? ` — ${detail}` : ""}`);
  results.push({ status, label, detail });
  if (status === "FAIL") failures++;
  if (status === "WARN") warnings++;
}
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }

function run(cmd, args = []) {
  const isWin = process.platform === "win32";
  // npm is a .cmd shim on Windows. shell:true lets Windows execute it.
  const executable = isWin && ["npm", "npx"].includes(cmd) ? `${cmd}.cmd` : cmd;
  return spawnSync(executable, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
    shell: isWin && ["npm.cmd", "npx.cmd"].includes(executable),
    env: process.env,
  });
}
function firstLine(s) { return (s || "").trim().split(/\r?\n/)[0] || ""; }

console.log("\n========================================");
console.log(" DERMS — PROJECT DEPENDENCY AUDIT");
console.log("========================================");
console.log(`OS: ${os.platform()} ${os.release()}`);
console.log(`Architecture: ${os.arch()}`);
console.log(`Project root: ${ROOT}\n`);

const node = run("node", ["--version"]);
report(node.status === 0 ? "PASS" : "FAIL", "Node.js", firstLine(node.stdout) || firstLine(node.stderr) || "Not executable");

const npm = run("npm", ["--version"]);
report(npm.status === 0 ? "PASS" : "FAIL", "npm CLI", firstLine(npm.stdout) || firstLine(npm.stderr) || "Not executable");

for (const p of ["package.json", "package-lock.json", "node_modules"]) {
  report(exists(p) ? "PASS" : "FAIL", p, exists(p) ? "Found" : "Missing");
}

if (!exists("package.json")) {
  report("FAIL", "Project dependency audit", "Run this script from the DERMS project root");
} else {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  } catch (e) {
    report("FAIL", "package.json parse", e.message);
  }

  if (pkg) {
    const declared = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.optionalDependencies || {}),
    };
    const names = Object.keys(declared);
    report(names.length ? "PASS" : "FAIL", "Declared npm dependencies", `${names.length} direct packages`);

    if (exists("package-lock.json")) {
      try {
        const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
        const lockRoot = lock.packages?.[""];
        if (!lockRoot) {
          report("WARN", "Lockfile format", "No packages[''] entry; npm may regenerate lock metadata");
        } else {
          const lockDeps = {
            ...(lockRoot.dependencies || {}),
            ...(lockRoot.devDependencies || {}),
            ...(lockRoot.optionalDependencies || {}),
          };
          const missingFromLock = names.filter(n => !lockDeps[n]);
          report(
            missingFromLock.length ? "WARN" : "PASS",
            "package.json vs package-lock.json",
            missingFromLock.length
              ? `Not represented in lock root: ${missingFromLock.join(", ")}`
              : "Direct dependency declarations appear in lockfile"
          );
        }
      } catch (e) {
        report("FAIL", "package-lock.json parse", e.message);
      }
    }

    if (exists("node_modules")) {
      const missing = [];
      const invalid = [];
      for (const name of names) {
        const file = path.join(ROOT, "node_modules", name, "package.json");
        if (!fs.existsSync(file)) {
          // Some package names are scoped: node_modules/@scope/name.
          missing.push(name);
          continue;
        }
        try {
          const installed = JSON.parse(fs.readFileSync(file, "utf8"));
          const wanted = declared[name];
          if (wanted && installed.version !== wanted && !/^[~^*]|^(>=|>|<=|<|latest|npm:|file:|https?:)/.test(wanted)) {
            invalid.push(`${name}: expected ${wanted}, found ${installed.version}`);
          }
        } catch {
          invalid.push(`${name}: installed package.json unreadable`);
        }
      }
      report(
        missing.length ? "FAIL" : "PASS",
        "Direct package files",
        missing.length ? `Missing: ${missing.join(", ")}` : `${names.length} declared packages have package.json files`
      );
      if (invalid.length) {
        report("WARN", "Pinned version differences", invalid.join("; "));
      } else {
        report("PASS", "Pinned version differences", "No obvious exact-version mismatches detected");
      }

      if (npm.status === 0) {
        const ls = run("npm", ["ls", "--depth=0", "--offline"]);
        report(
          ls.status === 0 ? "PASS" : "FAIL",
          "npm ls --depth=0 --offline",
          ls.status === 0 ? "Dependency tree is valid at top level" : "npm reports missing/invalid/extraneous packages or another npm error"
        );
        if (ls.status !== 0) {
          console.log("\n--- npm ls diagnostic output ---");
          console.log((ls.stdout || "") + (ls.stderr || ""));
          console.log("--- end npm diagnostic output ---\n");
        }
      } else {
        report("WARN", "npm dependency tree", "Skipped because npm CLI could not run");
      }
    } else {
      report("FAIL", "Direct package files", "node_modules is missing; cannot inspect installed packages");
    }
  }
}

// Cache is helpful for offline reinstall, but is not proof all packages are cached.
if (npm.status === 0) {
  const cache = run("npm", ["config", "get", "cache"]);
  const cachePath = firstLine(cache.stdout);
  if (cache.status === 0 && cachePath && fs.existsSync(cachePath)) {
    report("PASS", "npm cache directory", cachePath);
    const verify = run("npm", ["cache", "verify"]);
    report(
      verify.status === 0 ? "PASS" : "WARN",
      "npm cache verify",
      verify.status === 0 ? "Cache integrity check completed; package completeness is not guaranteed" : firstLine(verify.stderr) || "Verification failed"
    );
  } else {
    report("WARN", "npm cache directory", "Could not locate npm cache");
  }
}

if (exists("package.json")) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    for (const name of ["dev", "build", "start", "start:realtime", "typecheck", "test", "mqtt:local-broker"]) {
      report(pkg.scripts?.[name] ? "PASS" : "WARN", `npm script: ${name}`, pkg.scripts?.[name] || "Not declared");
    }
  } catch {}
}

report(exists(".next/BUILD_ID") ? "PASS" : "INFO", "Next.js production build", exists(".next/BUILD_ID") ? "Build ID found" : "No build artifact found (required only for production start)");
console.log("\n========================================");
console.log(" PROJECT AUDIT SUMMARY");
console.log("========================================");
console.log(`PASS: ${results.filter(r => r.status === "PASS").length}`);
console.log(`WARN: ${warnings}`);
console.log(`FAIL: ${failures}`);
console.log("Read-only audit: no packages were installed or modified.");
console.log("A PASS does not prove every dependency can be reinstalled offline.");
console.log("========================================\n");
if (failures) process.exitCode = 1;
