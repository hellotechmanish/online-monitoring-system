#!/usr/bin/env node
/**
 * DERMS external/system dependency audit (read-only).
 * Run from any directory:
 *   node check-system-deps.mjs
 * Checks runtimes, executable availability and common local service ports.
 */
import os from "node:os";
import net from "node:net";
import { spawnSync } from "node:child_process";

const results = [];
let failures = 0;
let warnings = 0;

function report(status, label, detail = "") {
  console.log(`[${status}] ${label}${detail ? ` — ${detail}` : ""}`);
  results.push({ status, label, detail });
  if (status === "FAIL") failures++;
  if (status === "WARN") warnings++;
}
function run(cmd, args = []) {
  const isWin = process.platform === "win32";
  const executable = isWin && ["npm", "npx"].includes(cmd) ? `${cmd}.cmd` : cmd;
  return spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
    shell: isWin && ["npm.cmd", "npx.cmd"].includes(executable),
    env: process.env,
  });
}
function firstLine(s) { return (s || "").trim().split(/\r?\n/)[0] || ""; }
function commandVersion(label, cmd, args = ["--version"], required = false) {
  const r = run(cmd, args);
  const detail = firstLine(r.stdout) || firstLine(r.stderr);
  report(r.status === 0 ? "PASS" : (required ? "FAIL" : "WARN"), label, detail || "Executable not found or command failed");
}
function portOpen(host, port, timeout = 1200) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = value => {
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
function parseUri(value, fallbackPort) {
  try {
    const u = new URL(value);
    return {
      host: u.hostname.replace(/^\[|\]$/g, ""),
      port: Number(u.port || fallbackPort),
      protocol: u.protocol,
    };
  } catch {
    return null;
  }
}

console.log("\n========================================");
console.log(" DERMS — SYSTEM / EXTERNAL DEPENDENCY AUDIT");
console.log("========================================");
console.log(`OS: ${os.platform()} ${os.release()}`);
console.log(`Architecture: ${os.arch()}\n`);

commandVersion("Node.js runtime", "node", ["--version"], true);
commandVersion("npm CLI", "npm", ["--version"], true);
commandVersion("MongoDB Server (mongod)", "mongod", ["--version"], false);
commandVersion("MongoDB Shell (mongosh)", "mongosh", ["--version"], false);
commandVersion("MongoDB Database Tools (mongodump)", "mongodump", ["--version"], false);

// Python is optional for deployments that use a Python sensor publisher/poller.
const py = process.platform === "win32"
  ? run("py", ["--version"])
  : run("python3", ["--version"]);
const pythonFound = py.status === 0;
report(pythonFound ? "PASS" : "INFO", "Python runtime (optional)", firstLine(py.stdout) || firstLine(py.stderr) || "Not found; only needed if your deployment uses a Python poller");

// MongoDB default local port.
const mongoOpen = await portOpen("127.0.0.1", 27017);
report(mongoOpen ? "PASS" : "WARN", "MongoDB TCP port 27017", mongoOpen ? "A service is listening; authentication/query not tested" : "No local listener detected");

// MQTT commonly uses 1883 (plain MQTT) and 8883 (TLS MQTT).
const mqttOpen = await portOpen("127.0.0.1", 1883);
report(mqttOpen ? "PASS" : "WARN", "MQTT TCP port 1883", mqttOpen ? "A service is listening; MQTT protocol/auth not tested" : "No local listener detected");
const mqttTlsOpen = await portOpen("127.0.0.1", 8883);
report(mqttTlsOpen ? "PASS" : "INFO", "MQTT TLS port 8883 (optional)", mqttTlsOpen ? "A service is listening" : "No local listener detected");

// Show service manager hints without assuming service names are identical on every OS.
if (process.platform === "linux") {
  const systemctl = run("systemctl", ["is-active", "mongod"]);
  report(
    systemctl.status === 0 && firstLine(systemctl.stdout) === "active" ? "PASS" : "INFO",
    "Linux systemd service: mongod",
    firstLine(systemctl.stdout) || firstLine(systemctl.stderr) || "systemctl unavailable; service status not confirmed"
  );
} else if (process.platform === "win32") {
  const ps = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-Service -Name MongoDB -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status"]);
  const state = firstLine(ps.stdout);
  report(
    state.toLowerCase() === "running" ? "PASS" : "INFO",
    "Windows service: MongoDB",
    state || "Service name MongoDB not found or status unavailable; MongoDB may be running another way"
  );
}

console.log("\n========================================");
console.log(" SYSTEM AUDIT SUMMARY");
console.log("========================================");
console.log(`PASS: ${results.filter(r => r.status === "PASS").length}`);
console.log(`WARN: ${warnings}`);
console.log(`FAIL: ${failures}`);
console.log("This script does not install, start, stop or change services.");
console.log("Open ports do not prove the database/broker accepts valid requests.");
console.log("========================================\n");
if (failures) process.exitCode = 1;
