import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const userHome = os.homedir();
const configDir = path.join(userHome, ".config", "opencode");
const dataDir = path.join(userHome, ".local", "share", "opencode");
const stateFile = path.join(configDir, "unlimited.json");
const infoFile = path.join(configDir, "unlimited-info.json");
const pluginDir = path.join(configDir, "plugins");
const pluginFolder = path.join(pluginDir, "unlimited-shield");
const pluginFile = path.join(pluginFolder, "index.js");
const pluginEntry = "./plugins/unlimited-shield";
const pluginMarker = path.join(configDir, "unlimited-shield.state.json");
const pidFile = path.join(configDir, "unlimited-bridge.pid");
const watchPidFile = path.join(configDir, "unlimited-watch.pid");
const watchLogFile = path.join(configDir, "unlimited-watch.log");
const logFile = path.join(configDir, "unlimited-bridge.log");
const ipCacheFile = path.join(configDir, "unlimited-ip.json");
const poolCacheFile = path.join(configDir, "unlimited-pool.json");
const rotateGateFile = path.join(configDir, "unlimited-rotate.json");
const authDir = path.join(dataDir, "auth.json");
const localRoot = path.join(userHome, ".local", "share", "opencode-unlimited");
const authSnapshotDir = path.join(localRoot, "auth-snapshot");
const authSnapshot = path.join(authSnapshotDir, "auth.json");
const gateway = "https://opencode.ai/inference/openai/v1/chat/completions";
const traceUrl = "https://cloudflare.com/cdn-cgi/trace";
const defaultModel = "deepseek-v4.1-flash-free";
const defaultBridgePort = 8899;
const slowProxyMs = 3500;
const defaultProxySources = [
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
];
const toolVersion = "1.0.2";
const systemdUnitDir = path.join(userHome, ".config", "systemd", "user");
const systemdUnitFile = path.join(systemdUnitDir, "opencode-unlimited-watch.service");
const systemdUnitName = "opencode-unlimited-watch.service";

const thisMjs = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(thisMjs);
let root = path.dirname(scriptDir);
if (!fs.existsSync(path.join(root, "lib", "proxy-bridge.js"))) root = scriptDir;
const bridgeJs = path.join(root, "lib", "proxy-bridge.js");
const bundledPlugin = path.join(root, "plugins", "unlimited-shield.js");

let infoCache = null;
let REST = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sleepSync = (ms) => {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  try {
    Atomics.wait(buffer, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
  }
};

function writeStep(text) {
  console.log(text);
}
function writeOk(text) {
  console.log("  [+] " + text);
}
function writeWarn(text) {
  console.log("  [!] " + text);
}
function writeBad(text) {
  console.log("  [x] " + text);
}
function writeInfo(text) {
  console.log("      " + text);
}

function newHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function ensureDir(dir) {
  if (!dir) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeTextFile(target, text) {
  const dir = path.dirname(target);
  if (dir) ensureDir(dir);
  fs.writeFileSync(target, text, { encoding: "utf8" });
}

function readTextFile(target) {
  try {
    if (!fs.existsSync(target)) return null;
    return fs.readFileSync(target, { encoding: "utf8" });
  } catch {
    return null;
  }
}

function readJson(target) {
  const raw = readTextFile(target);
  if (!raw) return null;
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function pdf(value, width) {
  return String(value ?? "").padEnd(width);
}
function pdl(value, width) {
  return String(value ?? "").padStart(width);
}

function pathExists(target) {
  try {
    return Boolean(target) && fs.existsSync(target);
  } catch {
    return false;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function utcNowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function formatUtcStamp(date) {
  return date.toISOString().slice(0, 19) + "Z";
}

function formatClock12(date) {
  let hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, "0");
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return hour + ":" + minute + " " + suffix;
}

function formatUtcClock(date) {
  return String(date.getUTCHours()).padStart(2, "0") + ":" + String(date.getUTCMinutes()).padStart(2, "0");
}

function formatYmdHm(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return y + "-" + mo + "-" + d + " " + h + ":" + mi;
}

function formatMonthDay(date) {
  return String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function sameCalendarDay(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function formatWatchStamp(date, now) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (sameCalendarDay(date, now)) {
    return hh + ":" + mm + ":" + String(date.getSeconds()).padStart(2, "0");
  }
  return formatMonthDay(date) + " " + hh + ":" + mm;
}

function includesCI(list, value) {
  const needle = String(value ?? "").toLowerCase();
  return list.some((item) => String(item ?? "").toLowerCase() === needle);
}

function restHas(names) {
  return REST.some((item) => includesCI(names, item));
}

function getRestFlag(names, def) {
  for (let i = 0; i < REST.length - 1; i++) {
    if (includesCI(names, REST[i])) return String(REST[i + 1]);
  }
  return def;
}

function getRestInt(names, def) {
  const parsed = parseInt(getRestFlag(names, ""), 10);
  if (Number.isFinite(parsed)) return parsed;
  return def;
}

function getRestArgs() {
  return REST.filter((item) => item && !String(item).startsWith("-"));
}

function getPathArg() {
  for (const item of REST) {
    if (!item) continue;
    if (item === "-Db" || item === "--db") continue;
    if (String(item).startsWith("-")) continue;
    return item;
  }
  return "";
}

function resolveOpenCode() {
  try {
    const found = execFileSync("which", ["opencode"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (found) return found;
  } catch {}
  const candidates = [
    path.join(userHome, ".opencode", "bin", "opencode"),
    path.join(userHome, ".local", "bin", "opencode"),
    path.join(userHome, ".bun", "bin", "opencode"),
    path.join(userHome, ".npm-global", "bin", "opencode"),
    path.join(userHome, ".nvm", "current", "bin", "opencode"),
  ];
  for (const candidate of candidates) {
    if (pathExists(candidate)) return candidate;
  }
  return "opencode";
}

function getCurl() {
  try {
    return execFileSync("which", ["curl"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function invokeCurl(args) {
  const curl = getCurl();
  if (!curl) return "";
  try {
    return execFileSync(curl, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return "";
  }
}

function invokeNative(file, args) {
  let result;
  try {
    result = spawnSync(file, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    return { code: -1, text: String(error && error.message ? error.message : error) };
  }
  const text = String(result.stdout || "") + String(result.stderr || "");
  if (result.error) return { code: -1, text: String(result.error.message || result.error) };
  return { code: result.status === null ? -1 : result.status, text };
}

function invokeNodeHelper(helper, args) {
  try {
    const result = spawnSync(process.execPath, [helper].concat(args), {
      encoding: "utf8",
      env: Object.assign({}, process.env, { NODE_NO_WARNINGS: "1" }),
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) return "";
    return String(result.stdout || "");
  } catch {
    return "";
  }
}

function getConfig() {
  const cfg = {
    pluginPath: pluginFile,
    model: defaultModel,
    orgId: "",
    proxy: "",
    proxyPool: [],
    proxyIndex: 0,
    proxyListUrl: "",
    bridgePort: defaultBridgePort,
    ipMode: "manual",
    rotateDb: false,
    autoMode: false,
    autoStart: false,
    autoTries: 12,
    autoMinutes: 8,
    reidOnAuto: true,
    lastIp: "",
    lastCountry: "",
    lastBucket: "",
    updatedAt: "",
  };
  const saved = readJson(stateFile);
  if (saved && typeof saved === "object") {
    for (const name of Object.keys(cfg)) {
      if (Object.prototype.hasOwnProperty.call(saved, name) && saved[name] !== null && saved[name] !== undefined) {
        cfg[name] = saved[name];
      }
    }
  }
  return cfg;
}

function saveConfig(cfg) {
  cfg.updatedAt = formatUtcStamp(new Date());
  writeTextFile(stateFile, JSON.stringify(cfg, null, 2));
}

function getOpenCodeInfo(refresh) {
  if (!refresh && infoCache) return infoCache;
  const info = {
    exe: resolveOpenCode(),
    version: "",
    major: 0,
    api: 0,
    baseURL: "https://opencode.ai/inference/openai/v1",
    gateway: gateway,
    orgId: "",
    dbPath: "",
    dataDir: dataDir,
    configDir: configDir,
    freeModels: [],
    freeModel: defaultModel,
    sessionTable: "",
    running: false,
    source: "fallback",
    detectedAt: 0,
  };
  const helper = path.join(root, "lib", "oc-info.js");
  if (!pathExists(helper)) {
    infoCache = info;
    return info;
  }
  const args = ["info"];
  if (refresh) args.push("--refresh");
  const raw = invokeNodeHelper(helper, args);
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed) {
    if (parsed.exe) info.exe = String(parsed.exe);
    if (parsed.version) info.version = String(parsed.version);
    if (parsed.major) info.major = Number(parsed.major);
    if (parsed.api) info.api = Number(parsed.api);
    if (parsed.baseURL) info.baseURL = String(parsed.baseURL);
    if (parsed.gateway) info.gateway = String(parsed.gateway);
    if (parsed.orgId) info.orgId = String(parsed.orgId);
    if (parsed.dbPath) info.dbPath = String(parsed.dbPath);
    if (parsed.dataDir) info.dataDir = String(parsed.dataDir);
    if (parsed.configDir) info.configDir = String(parsed.configDir);
    if (parsed.freeModels) info.freeModels = Array.isArray(parsed.freeModels) ? parsed.freeModels : [parsed.freeModels];
    if (parsed.freeModel) info.freeModel = String(parsed.freeModel);
    if (parsed.service) info.running = Boolean(parsed.service.running);
    if (parsed.schema && parsed.schema.sessionTable) info.sessionTable = String(parsed.schema.sessionTable);
    if (parsed.detectedAt) info.detectedAt = Number(parsed.detectedAt);
    info.source = "detected";
  }
  infoCache = info;
  return info;
}

function getUserAgent() {
  const info = getOpenCodeInfo();
  const version = info.version ? info.version : "latest";
  return "opencode/latest/" + version + "/cli";
}

const fetchTraceScript = [
  "const url = process.env.TRACE_URL;",
  "const proxy = process.env.TRACE_PROXY;",
  "const ms = Number(process.env.TRACE_MS) || 8000;",
  "const ua = process.env.TRACE_UA || 'opencode/latest/latest/cli';",
  "(async () => {",
  "  try {",
  "    const controller = new AbortController();",
  "    const timer = setTimeout(() => controller.abort(), ms);",
  "    const options = { signal: controller.signal, headers: { 'User-Agent': ua } };",
  "    if (proxy) options.proxy = proxy;",
  "    const response = await fetch(url, options);",
  "    const text = await response.text();",
  "    clearTimeout(timer);",
  "    process.stdout.write(text);",
  "  } catch {",
  "    process.exitCode = 0;",
  "  }",
  "})();",
].join("\n");

function fetchTraceSync(proxyUrl, timeoutSec) {
  try {
    const result = spawnSync(process.execPath, ["-e", fetchTraceScript], {
      encoding: "utf8",
      env: Object.assign({}, process.env, {
        NODE_NO_WARNINGS: "1",
        TRACE_URL: traceUrl,
        TRACE_PROXY: proxyUrl || "",
        TRACE_MS: String(timeoutSec * 1000),
        TRACE_UA: getUserAgent(),
      }),
      timeout: (timeoutSec + 5) * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return String(result.stdout || "");
  } catch {
    return "";
  }
}

async function invokeWebRequestRaw(method, url, body, proxyUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const options = {
      method: method,
      signal: controller.signal,
      headers: { "User-Agent": getUserAgent() },
    };
    if (body) {
      options.headers["Content-Type"] = "application/json";
      options.body = body;
    }
    if (proxyUrl) options.proxy = proxyUrl;
    const response = await fetch(url, options);
    const text = await response.text();
    return { status: response.status, body: text };
  } catch (error) {
    return { status: 0, body: String(error && error.message ? error.message : error) };
  } finally {
    clearTimeout(timer);
  }
}

function getEgressTrace(proxyUrl, options) {
  const opts = options || {};
  const force = Boolean(opts.force);
  const timeoutSec = opts.timeoutSec || 8;
  const noFallback = Boolean(opts.noFallback);
  const via = proxyUrl ? String(proxyUrl) : "";
  if (!force) {
    const cache = readJson(ipCacheFile);
    if (cache && cache.ip) {
      const age = utcNowSeconds() - Number(cache.at || 0);
      if (age >= 0 && age < 60 && String(cache.via || "") === via) {
        return {
          ip: String(cache.ip || ""),
          country: String(cache.country || ""),
          warp: String(cache.warp || ""),
          colo: String(cache.colo || ""),
          at: Number(cache.at || 0),
          cached: true,
          ms: 0,
        };
      }
    }
  }
  let text = "";
  let elapsed = 0;
  const curl = getCurl();
  if (curl) {
    const connect = Math.max(2, Math.min(5, timeoutSec - 1));
    const args = ["-s", "--connect-timeout", String(connect), "--max-time", String(timeoutSec)];
    if (proxyUrl) args.push("--proxy", proxyUrl);
    args.push(traceUrl);
    const started = Date.now();
    text = invokeCurl(args);
    elapsed = Date.now() - started;
  }
  if ((!text || text.indexOf("ip=") < 0) && !noFallback) {
    const started = Date.now();
    const fetched = fetchTraceSync(proxyUrl, timeoutSec);
    if (fetched) text = fetched;
    if (!curl) elapsed = Date.now() - started;
  }
  let ip = "";
  let country = "";
  let warp = "";
  let colo = "";
  if (text) {
    for (const line of String(text).split("\n")) {
      const clean = line.trim();
      let match;
      if ((match = /^ip=(.+)$/.exec(clean))) ip = match[1].trim();
      else if ((match = /^loc=(.+)$/.exec(clean))) country = match[1].trim();
      else if ((match = /^warp=(.+)$/.exec(clean))) warp = match[1].trim();
      else if ((match = /^colo=(.+)$/.exec(clean))) colo = match[1].trim();
    }
  }
  const at = utcNowSeconds();
  if (ip) {
    writeTextFile(ipCacheFile, JSON.stringify({ ip: ip, country: country, warp: warp, colo: colo, at: at, via: via }, null, 2));
  }
  return { ip: ip, country: country, warp: warp, colo: colo, at: at, cached: false, ms: elapsed };
}

function invokeProxyHealth(action, extra) {
  const helper = path.join(root, "lib", "proxy-health.js");
  if (!pathExists(helper)) return null;
  const args = [action].concat(extra || []);
  const raw = invokeNodeHelper(helper, args);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setProxyHealth(url, ok, ms, reason) {
  if (!url) return;
  const extra = [url, ok ? "ok" : "fail", String(ms)];
  if (reason) extra.push(reason);
  invokeProxyHealth("record", extra);
}

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function getProxyPool(cfg) {
  const pool = [];
  for (const entry of asArray(cfg.proxyPool)) {
    const url = String(entry || "");
    if (url && /^(socks5h?|http|https):\/\//.test(url)) pool.push(url);
  }
  const cache = readJson(poolCacheFile);
  if (cache && cache.proxies) {
    for (const entry of asArray(cache.proxies)) {
      const url = String(entry || "");
      if (url && /^https?:\/\//.test(url) && !pool.includes(url)) pool.push(url);
    }
  }
  return pool;
}

function getRankedProxyPool(cfg) {
  const pool = getProxyPool(cfg);
  if (!pool.length) return [];
  const ranked = invokeProxyHealth("rank", pool);
  if (ranked && ranked.proxies) return asArray(ranked.proxies);
  return pool;
}

function getProxyHealthReport(cfg) {
  const pool = getProxyPool(cfg);
  if (!pool.length) return null;
  return invokeProxyHealth("rank", pool);
}

function getEgressIp(proxyUrl, options) {
  const trace = getEgressTrace(proxyUrl, options);
  if (trace.ip) return trace.ip;
  return "";
}

function testRouteOk(trace, mode) {
  if (!trace || !trace.ip) return false;
  if (mode === "warp") return trace.warp === "on" || trace.warp === "plus";
  return true;
}

function testRouteFilter(trace, country, prefix) {
  if (!trace || !trace.ip) return false;
  if (country && String(trace.country || "").toUpperCase() !== String(country).toUpperCase()) return false;
  if (prefix && !String(trace.ip || "").startsWith(prefix)) return false;
  return true;
}

function testSameBlock(left, right) {
  if (!left || !right) return false;
  const helper = path.join(root, "lib", "egress.js");
  if (pathExists(helper)) {
    const raw = invokeNodeHelper(helper, ["same", left, right]);
    try {
      const data = JSON.parse(raw);
      if (data && data.same !== null && data.same !== undefined) return Boolean(data.same);
    } catch {}
  }
  return left === right;
}

function resolveProbeModel(cfg, info) {
  let model = String(cfg.model || "");
  if (model.includes("/")) {
    const parts = model.split("/");
    model = parts[parts.length - 1];
  }
  const free = asArray(info.freeModels);
  if (free.length > 0 && !free.includes(model) && info.freeModel) model = String(info.freeModel);
  if (!model) model = defaultModel;
  return model;
}

function getOrgId(cfg) {
  if (cfg.orgId) return cfg.orgId;
  const info = getOpenCodeInfo();
  if (info.orgId) {
    cfg.orgId = info.orgId;
    saveConfig(cfg);
    return info.orgId;
  }
  return "";
}

function testNodeSqlite() {
  const parts = String(process.versions.node || "").split(".");
  if (parts.length < 2) return false;
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major > 22) return true;
  if (major === 22 && minor >= 5) return true;
  return false;
}

function getDatabasePath() {
  const info = getOpenCodeInfo();
  if (info.dbPath && pathExists(info.dbPath)) return info.dbPath;
  const candidates = [path.join(dataDir, "opencode.db"), path.join(dataDir, "opencode.sqlite")];
  for (const candidate of candidates) {
    if (candidate && pathExists(candidate)) return candidate;
  }
  return "";
}

function convertToDbPath(target) {
  let full = target;
  try {
    full = fs.realpathSync(target);
  } catch {}
  return String(full).replace(/\\/g, "/").replace(/\/+$/, "");
}

function invokeDbTool(action, argument) {
  const db = getDatabasePath();
  if (!db) return ["opencode.db not found"];
  if (!testNodeSqlite()) return ["node 22.5+ required"];
  const helper = path.join(root, "lib", "db-tools.js");
  if (!pathExists(helper)) return ["missing helper: " + helper];
  const args = [action, db];
  if (argument) args.push(argument);
  const raw = invokeNodeHelper(helper, args);
  if (!raw) return ["no output from " + helper];
  return raw.split(/\r?\n/).filter((line) => line.trim());
}

function removeStuckErrors(directory) {
  const scope = directory ? convertToDbPath(directory) : "";
  const out = invokeDbTool("clear", scope);
  if (out && out.length) writeInfo(out.join(" "));
}

function getGlobalConfigPath() {
  const jsonc = path.join(configDir, "opencode.jsonc");
  if (pathExists(jsonc)) return jsonc;
  return path.join(configDir, "opencode.json");
}

function readGlobalConfig() {
  const target = getGlobalConfigPath();
  if (!pathExists(target)) return {};
  try {
    const raw = fs.readFileSync(target, { encoding: "utf8" }).replace(/^\uFEFF/, "");
    const cfg = JSON.parse(raw);
    if (cfg) return cfg;
  } catch {
    return null;
  }
  return {};
}

function saveGlobalConfig(cfg) {
  const target = getGlobalConfigPath();
  let value = cfg;
  if (typeof value.plugins === "string" && value.plugins) value = Object.assign({}, value, { plugins: [value.plugins] });
  writeTextFile(target, JSON.stringify(value, null, 2));
}

function getRegisteredPlugins(cfg) {
  if (!cfg) return [];
  const value = cfg.plugins;
  if (value === null || value === undefined) return [];
  const out = [];
  for (const item of asArray(value)) {
    if (typeof item === "string") {
      if (item) out.push(item);
    } else if (item && item.package) {
      out.push(String(item.package));
    }
  }
  return out;
}

function testPluginRegistered() {
  const cfg = readGlobalConfig();
  return getRegisteredPlugins(cfg).includes(pluginEntry);
}

function registerPluginEntry(enabled) {
  const cfg = readGlobalConfig();
  if (!cfg) return false;
  const list = getRegisteredPlugins(cfg).filter((item) => item !== pluginEntry);
  if (enabled) list.push(pluginEntry);
  cfg.plugins = list;
  try {
    saveGlobalConfig(cfg);
  } catch (error) {
    writeWarn("global config not written: " + String(error && error.message ? error.message : error));
    return false;
  }
  return true;
}

function installPlugin() {
  if (!pathExists(bundledPlugin)) {
    writeBad("bundled plugin missing: " + bundledPlugin);
    return false;
  }
  ensureDir(pluginFolder);
  fs.copyFileSync(bundledPlugin, pluginFile);
  if (!registerPluginEntry(true)) return false;
  writeOk("plugin installed and listed in opencode config: " + pluginEntry);
  return true;
}

function getPluginState() {
  const present = pathExists(pluginFile);
  const listed = testPluginRegistered();
  if (present && listed) {
    const marker = readJson(pluginMarker);
    if (marker && marker.loaded === true) return "loaded";
    return "enabled (waiting for a server load)";
  }
  if (present || listed) return "partial";
  return "missing";
}

function setPluginEnabled(enabled) {
  const disabled = pluginFile + ".off";
  if (enabled) {
    if (!pathExists(pluginFile)) {
      if (pathExists(disabled)) {
        ensureDir(pluginFolder);
        fs.renameSync(disabled, pluginFile);
      } else if (pathExists(bundledPlugin)) {
        ensureDir(pluginFolder);
        fs.copyFileSync(bundledPlugin, pluginFile);
      }
    }
    registerPluginEntry(true);
    return;
  }
  registerPluginEntry(false);
  if (pathExists(pluginFile)) fs.renameSync(pluginFile, disabled);
}

function testPluginLive() {
  const marker = readJson(pluginMarker);
  if (marker && marker.loaded === true) return marker;
  const info = getOpenCodeInfo();
  if (!info.exe || !info.running) return null;
  const result = invokeNative(info.exe, ["api", "get", "/api/plugin"]);
  if (result.code !== 0 || !result.text) return null;
  if (!/"id"\s*:\s*"unlimited-shield"/.test(result.text)) return null;
  return {
    plugin: "unlimited-shield",
    loaded: true,
    version: String(info.version),
    hooks: ["model.request", "http.request"],
    at: "live",
  };
}

function setServiceEnv(name, value) {
  const oc = resolveOpenCode();
  try {
    if (!value) spawnSync(oc, ["service", "unset", "env", name], { stdio: "ignore" });
    else spawnSync(oc, ["service", "set", "env", name, value], { stdio: "ignore" });
  } catch {}
}

function restartService() {
  const oc = resolveOpenCode();
  writeInfo("restarting background service");
  const result = spawnSync(oc, ["service", "restart"], { stdio: "ignore" });
  if (result.error) writeWarn("service restart failed");
}

function getBridgePid() {
  const raw = readTextFile(pidFile);
  if (raw && /^\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
  return 0;
}

function startBridge(cfg) {
  const bridgePid = getBridgePid();
  if (bridgePid > 0 && pidAlive(bridgePid)) {
    writeInfo("bridge already running (pid " + bridgePid + ")");
    return true;
  }
  if (!pathExists(bridgeJs)) {
    writeBad("bridge script missing: " + bridgeJs);
    return false;
  }
  let proc;
  try {
    proc = spawn(process.execPath, [bridgeJs, "--listen", "127.0.0.1:" + cfg.bridgePort, "--upstream", cfg.proxy, "--log", logFile], {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();
  } catch (error) {
    writeBad("bridge could not start: " + String(error && error.message ? error.message : error));
    return false;
  }
  writeTextFile(pidFile, String(proc.pid));
  sleepSync(800);
  if (pidAlive(proc.pid)) {
    writeOk("bridge up on 127.0.0.1:" + cfg.bridgePort + " -> " + cfg.proxy);
    return true;
  }
  writeBad("bridge exited, see " + logFile);
  return false;
}

function stopBridge() {
  const bridgePid = getBridgePid();
  if (bridgePid > 0) {
    if (pidAlive(bridgePid)) {
      try {
        process.kill(bridgePid, "SIGTERM");
      } catch {}
      writeOk("bridge stopped");
    }
  }
  try {
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch {}
}

function testUpstream(proxyUrl, timeoutSec) {
  const limit = timeoutSec || 10;
  const curl = getCurl();
  if (!curl) return true;
  const connect = Math.max(2, Math.min(5, limit - 1));
  const out = invokeCurl(["-s", "--connect-timeout", String(connect), "--max-time", String(limit), "--proxy", proxyUrl, traceUrl]);
  if (out && out.indexOf("ip=") >= 0) return true;
  return false;
}

function convertFromProxyText(raw) {
  const found = [];
  if (!raw) return found;
  const pattern = /(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/g;
  let match;
  while ((match = pattern.exec(raw))) {
    const octets = match[1].split(".").map((part) => parseInt(part, 10));
    if (octets.length !== 4) continue;
    if (octets.some((value) => value > 255)) continue;
    const port = parseInt(match[2], 10);
    if (port < 1 || port > 65535) continue;
    const entry = "http://" + match[1] + ":" + port;
    if (!found.includes(entry)) found.push(entry);
  }
  return found;
}

function getProxySources(cfg) {
  const list = [];
  const custom = String(cfg.proxyListUrl || "");
  if (/^https?:\/\//.test(custom)) list.push(custom);
  for (const url of defaultProxySources) {
    if (!list.includes(url)) list.push(url);
  }
  return list;
}

function updateProxyList(cfg, options) {
  const opts = options || {};
  const force = Boolean(opts.force);
  const quiet = Boolean(opts.quiet);
  const now = utcNowSeconds();
  const cache = readJson(poolCacheFile);
  if (!force && cache && cache.at && now - Number(cache.at) < 21600) {
    const cached = asArray(cache.proxies);
    if (cached.length > 0) return cached.length;
  }
  for (const url of getProxySources(cfg)) {
    if (!quiet) writeInfo("proxy list: asking " + url);
    const raw = invokeCurl(["-s", "-L", "--max-time", "20", url]);
    if (!raw || raw.length < 32) continue;
    const found = convertFromProxyText(raw);
    if (!found.length) continue;
    found.sort(() => Math.random() - 0.5);
    const picked = found.slice(0, Math.min(found.length, 200));
    writeTextFile(poolCacheFile, JSON.stringify({ at: now, source: url, proxies: picked }, null, 2));
    if (String(cfg.proxyListUrl || "") !== url) {
      cfg.proxyListUrl = url;
      saveConfig(cfg);
    }
    if (!quiet) writeInfo("proxy list: " + picked.length + " candidates");
    return picked.length;
  }
  if (!quiet) writeWarn("every proxy source came back empty");
  return 0;
}

function stepEgress(cfg, url, avoidIp, country, prefix) {
  if (!url) return null;
  writeInfo("testing: " + url);
  const trace = getEgressTrace(url, { force: true, timeoutSec: 6, noFallback: true });
  const ms = Number(trace.ms) || 0;
  if (!trace.ip) {
    setProxyHealth(url, false, ms, "timeout");
    writeInfo("  no answer in 6s");
    return null;
  }
  if (ms > slowProxyMs) {
    setProxyHealth(url, true, ms, "slow");
    writeInfo("  too slow, " + ms + " ms");
    return null;
  }
  setProxyHealth(url, true, ms, "");
  if (avoidIp && testSameBlock(trace.ip, avoidIp)) {
    writeInfo("  same egress block, " + trace.ip);
    return null;
  }
  if (!testRouteFilter(trace, country, prefix)) {
    writeInfo("  filtered out, " + trace.ip + " " + trace.country);
    return null;
  }
  cfg.proxy = url;
  cfg.ipMode = "proxy";
  saveConfig(cfg);
  if (!applyProxy(cfg, { skipTest: true })) {
    setProxyHealth(url, false, 0, "upstream");
    return null;
  }
  writeInfo("  live, " + ms + " ms");
  return trace;
}

function invokeEgressRotation(cfg, avoidIp, country, prefix, options) {
  const opts = options || {};
  const dry = Boolean(opts.dry);
  const noRestart = Boolean(opts.noRestart);
  const tries = opts.tries || 8;
  if (getProxyPool(cfg).length === 0) updateProxyList(cfg, {});
  const pool = getRankedProxyPool(cfg);
  if (!pool.length) {
    if (cfg.ipMode === "warp") {
      if (dry) {
        writeInfo("would reconnect warp");
        return null;
      }
      const trace = invokeWarpRotate(cfg);
      if (!testRouteOk(trace, "warp")) {
        writeWarn("warp is not carrying the route");
        return null;
      }
      if (avoidIp && testSameBlock(trace.ip, avoidIp)) {
        writeWarn("same egress block: " + trace.ip);
        return null;
      }
      if (!testRouteFilter(trace, country, prefix)) {
        writeWarn("filtered out: " + trace.ip + " " + trace.country);
        return null;
      }
      writeOk("warp reconnected -> " + trace.ip + " " + trace.country);
      return trace;
    }
    if (cfg.proxy) {
      if (dry) {
        writeInfo("would apply: " + cfg.proxy);
        return null;
      }
      if (!applyProxy(cfg, {})) return null;
      restartService();
      sleepSync(600);
      const trace = getEgressTrace(cfg.proxy, { force: true });
      if (!testRouteOk(trace, cfg.ipMode)) {
        writeWarn("route check failed");
        return null;
      }
      if (avoidIp && testSameBlock(trace.ip, avoidIp)) {
        writeWarn("same egress block: " + trace.ip);
        return null;
      }
      if (!testRouteFilter(trace, country, prefix)) {
        writeWarn("filtered out: " + trace.ip + " " + trace.country);
        return null;
      }
      return trace;
    }
    writeInfo("manual mode, no proxy configured");
    writeInfo("change the network yourself, or run: opencode-unlimited on");
    return null;
  }
  if (dry) {
    const next = pool[Number(cfg.proxyIndex || 0) % pool.length];
    writeInfo("would rotate to: " + next + " (" + pool.length + " in the pool)");
    return null;
  }
  const limit = Math.min(pool.length, Math.max(1, tries));
  const start = Number(cfg.proxyIndex || 0);
  for (let i = 0; i < limit; i++) {
    const index = (start + i) % pool.length;
    const trace = stepEgress(cfg, pool[index], avoidIp, country, prefix);
    if (trace) {
      cfg.proxyIndex = (index + 1) % pool.length;
      saveConfig(cfg);
      if (!noRestart) {
        restartService();
        sleepSync(600);
      }
      writeOk("egress via " + cfg.proxy + " -> " + trace.ip + " " + trace.country + "  [" + trace.ms + " ms]");
      return trace;
    }
  }
  writeWarn("no proxy in the pool produced a usable egress block");
  return null;
}

function setProxyEnv(url) {
  const noProxy = "localhost,127.0.0.1,::1";
  for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"]) {
    setServiceEnv(name, url);
  }
  for (const name of ["NO_PROXY", "no_proxy"]) {
    setServiceEnv(name, noProxy);
  }
}

function applyProxy(cfg, options) {
  const opts = options || {};
  if (!cfg.proxy) {
    setProxyEnv("");
    writeOk("service proxy cleared, direct egress");
    return true;
  }
  let url = cfg.proxy;
  let viaBridge = false;
  if (/^socks5h?:\/\//.test(url)) {
    if (!startBridge(cfg)) return false;
    url = "http://127.0.0.1:" + cfg.bridgePort;
    viaBridge = true;
  }
  if (!opts.skipTest && !testUpstream(url, 8)) {
    writeBad("upstream not answering: " + cfg.proxy);
    writeInfo("opencode was not switched, fix the proxy and retry");
    if (viaBridge) stopBridge();
    return false;
  }
  setProxyEnv(url);
  writeOk("service proxy set: " + url);
  return true;
}

function getWarpCli() {
  try {
    return execFileSync("which", ["warp-cli"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function invokeWarpRotate(cfg) {
  const warp = getWarpCli();
  if (!warp) return null;
  spawnSync(warp, ["disconnect"], { stdio: "ignore" });
  sleepSync(2000);
  spawnSync(warp, ["connect"], { stdio: "ignore" });
  sleepSync(4000);
  return getEgressTrace(cfg.proxy, { force: true });
}

function getWatcherPid() {
  const raw = readTextFile(watchPidFile);
  if (!raw) return 0;
  const first = raw.trim().split(/\s+/)[0];
  if (/^\d+$/.test(first)) return parseInt(first, 10);
  return 0;
}

function startWatcherDaemon() {
  const watchPid = getWatcherPid();
  if (watchPid > 0 && pidAlive(watchPid)) {
    writeInfo("watcher already running (pid " + watchPid + ")");
    return true;
  }
  if (!pathExists(thisMjs)) {
    writeWarn("watcher entry not found: " + thisMjs);
    return false;
  }
  const errFile = watchLogFile + ".err";
  let proc;
  try {
    const outFd = fs.openSync(watchLogFile, "a");
    const errFd = fs.openSync(errFile, "a");
    proc = spawn(process.execPath, [thisMjs, "watch", "-follow", "-auto"], {
      detached: true,
      stdio: ["ignore", outFd, errFd],
    });
    proc.unref();
    try {
      fs.closeSync(outFd);
      fs.closeSync(errFd);
    } catch {}
  } catch (error) {
    writeWarn("watcher could not start: " + String(error && error.message ? error.message : error));
    return false;
  }
  sleepSync(900);
  if (pidAlive(proc.pid)) {
    writeTextFile(watchPidFile, String(proc.pid));
    writeOk("watcher running (pid " + proc.pid + "), log " + watchLogFile);
    return true;
  }
  writeWarn("watcher exited at once, read " + errFile);
  return false;
}

function stopWatcherDaemon() {
  const watchPid = getWatcherPid();
  if (watchPid > 0) {
    if (pidAlive(watchPid)) {
      try {
        process.kill(watchPid, "SIGTERM");
      } catch {}
      writeOk("watcher stopped");
    }
  }
  try {
    if (fs.existsSync(watchPidFile)) fs.unlinkSync(watchPidFile);
  } catch {}
}

function getAutoStartState() {
  return pathExists(systemdUnitFile) ? "installed" : "absent";
}

function installAutoStart() {
  try {
    ensureDir(systemdUnitDir);
    const unit = [
      "[Unit]",
      "Description=opencode-unlimited free-limit watcher",
      "After=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      "ExecStart=" + process.execPath + " " + thisMjs + " watch -follow -auto",
      "Restart=on-failure",
      "RestartSec=5",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n");
    writeTextFile(systemdUnitFile, unit);
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    const result = spawnSync("systemctl", ["--user", "enable", systemdUnitName], { stdio: "ignore" });
    if (result.error || result.status !== 0) {
      writeWarn("systemctl could not enable the watcher unit");
      return false;
    }
    writeOk("autostart: systemd user unit opencode-unlimited-watch at login");
    return true;
  } catch (error) {
    writeWarn("autostart was not installed: " + String(error && error.message ? error.message : error));
    return false;
  }
}

function removeAutoStart() {
  let removed = false;
  try {
    const result = spawnSync("systemctl", ["--user", "disable", systemdUnitName], { stdio: "ignore" });
    if (!result.error && result.status === 0) removed = true;
  } catch {}
  try {
    if (fs.existsSync(systemdUnitFile)) {
      fs.unlinkSync(systemdUnitFile);
      removed = true;
    }
  } catch {}
  if (removed) writeOk("autostart unit removed");
}

function installSlashCommand() {
  const cli = thisMjs;
  const tail = "\n\nAnswer with one short line about what the output above reported. No more.";
  const cmdRoot = path.join(configDir, "commands");
  try {
    if (fs.existsSync(path.join(cmdRoot, "opencode-unlimited.md"))) fs.unlinkSync(path.join(cmdRoot, "opencode-unlimited.md"));
  } catch {}
  try {
    if (fs.existsSync(path.join(cmdRoot, "opencode-unlimited"))) fs.rmSync(path.join(cmdRoot, "opencode-unlimited"), { recursive: true, force: true });
  } catch {}
  const defs = [
    ["opencode-unlimited", "status", "OpenCode free-tier helper - identity, egress block, reset clock"],
    ["opencode-unlimited:reset", "reset", "new device identity, new session ids, clear stuck errors; pass a folder"],
    ["opencode-unlimited:identity", "identity", "show, rotate or restore the virtual device identity"],
    ["opencode-unlimited:block", "block", "egress blocks seen today and which are spent"],
    ["opencode-unlimited:usage", "usage", "daily free bucket state and the reset clock"],
    ["opencode-unlimited:watch", "watch", "read the opencode log for a limit line, zero messages spent"],
    ["opencode-unlimited:hunt", "hunt", "rotate until the probe says the route is open"],
    ["opencode-unlimited:clear", "clear", "strip stored free-limit errors from sessions"],
    ["opencode-unlimited:token", "token", "show or save the local auth.json snapshot"],
    ["opencode-unlimited:on", "on", "full auto: identity, pool, route, watcher, autostart"],
    ["opencode-unlimited:off", "off", "stop the watcher, drop the proxy, keep the files"],
    ["opencode-unlimited:reid", "reid", "mint fresh session ids, keep every message"],
    ["opencode-unlimited:model", "model", "list providers and switch this folder to a free model"],
  ];
  const argNames = [
    "opencode-unlimited:reset",
    "opencode-unlimited:clear",
    "opencode-unlimited:reid",
    "opencode-unlimited:model",
    "opencode-unlimited:watch",
    "opencode-unlimited:hunt",
  ];
  const cfgPath = getGlobalConfigPath();
  let cfg = null;
  if (pathExists(cfgPath)) {
    try {
      const raw = fs.readFileSync(cfgPath, { encoding: "utf8" }).replace(/^\uFEFF/, "");
      cfg = JSON.parse(raw);
    } catch {
      writeWarn("could not parse " + cfgPath + ", slash commands skipped");
      return;
    }
  }
  if (!cfg) cfg = {};
  if (!cfg.commands || typeof cfg.commands !== "object") cfg.commands = {};
  for (const [name, argText, desc] of defs) {
    let args = argText;
    if (argNames.includes(name)) args = args + ' "$ARGUMENTS"';
    const template = "!node " + JSON.stringify(cli) + " " + args + tail;
    cfg.commands[name] = { description: desc, template: template };
  }
  writeTextFile(cfgPath, JSON.stringify(cfg, null, 2));
  writeOk("slash commands: " + defs.map((item) => item[0]).join(", "));
}

function getStaleInstalls() {
  const entries = [];
  let resolvedRoot = root;
  try {
    resolvedRoot = fs.realpathSync(root);
  } catch {}
  resolvedRoot = String(resolvedRoot).replace(/\/+$/, "");
  const value = String(process.env.PATH || "");
  for (const entry of value.split(":")) {
    const clean = entry.trim().replace(/\/+$/, "");
    if (!clean) continue;
    if (clean.toLowerCase() === resolvedRoot.toLowerCase()) continue;
    if (clean.toLowerCase() === path.join(resolvedRoot, "bin").toLowerCase()) continue;
    const script = path.join(clean, "opencode-unlimited.ps1");
    const base = path.basename(clean).toLowerCase();
    const parent = path.basename(path.dirname(clean));
    const isOurDir = base === "bin" && /unlimited/i.test(parent);
    if (!pathExists(script) && !isOurDir) continue;
    if (!entries.includes(clean)) entries.push(clean);
  }
  return entries;
}

function removeStaleInstalls() {
  const stale = getStaleInstalls();
  if (!stale.length) return;
  writeWarn("stale path entries: " + stale.join(", "));
  writeInfo("remove them from your shell profile so an old copy cannot answer");
}

function cmdInstall() {
  writeStep("==> installing opencode-unlimited");
  installSlashCommand();
  const cfg = getConfig();
  const org = getOrgId(cfg);
  if (org) writeOk("org id discovered: " + org);
  else writeWarn("org id not discovered yet, run opencode once and retry");
  saveConfig(cfg);
  removeStaleInstalls();
  const binDir = scriptDir;
  const parts = String(process.env.PATH || "")
    .split(":")
    .map((item) => item.replace(/\/+$/, ""));
  if (!parts.includes(binDir.replace(/\/+$/, ""))) {
    writeInfo('add to PATH: export PATH="' + binDir + ':$PATH"');
    writeInfo("open a new terminal to pick it up");
  } else {
    writeInfo("already on PATH: " + binDir);
  }
  if (pathExists(pluginFile)) {
    writeWarn("the shield plugin is installed");
    writeInfo("check it with: opencode-unlimited plugin");
  } else {
    writeOk("shield plugin not installed (run 'opencode-unlimited on' when you want it)");
  }
  writeStep("");
  writeOk("done. try: opencode-unlimited usage");
}

function cmdVerify(fix) {
  writeStep("==> checking session integrity");
  const apply = Boolean(fix) || restHas(["-fix", "--fix"]);
  const out = invokeDbTool("verify", apply ? "fix" : "");
  let found = false;
  for (const line of out) {
    const text = String(line).trim();
    if (!text) continue;
    if (/^no problems/.test(text)) writeOk(text);
    else if (/fixed [1-9]/.test(text)) writeOk(text);
    else if (/^(opencode\.db|node 22|node not|missing helper|schema)/.test(text)) {
      writeBad(text);
      found = true;
    } else {
      writeWarn(text);
      found = true;
    }
  }
  if (!apply && found) writeInfo("run with -fix to repair the listed items");
}

function cmdClear() {
  writeStep("==> clearing stored limit errors");
  const target = getPathArg();
  if (target) {
    writeInfo("scope: " + target);
    removeStuckErrors(target);
  } else {
    writeInfo("scope: every session");
    removeStuckErrors();
  }
  writeInfo("the banner comes from stored error rows, not from the server");
  writeInfo("opencode re-reads session state as it goes, no restart needed");
  writeInfo("if a new prompt still fails, your egress ip is still on the spent bucket");
}

function getMidnightUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
}

function cmdReset() {
  const dry = restHas(["-Dry", "--dry"]);
  const keepIds = restHas(["-KeepIds", "--keep-ids"]);
  writeStep(dry ? "==> reset (dry run, nothing is written)" : "==> reset");
  const cfg = getConfig();
  const target = getPathArg();
  const hunt = restHas(["-Hunt", "--hunt"]);
  const traceBefore = getEgressTrace(cfg.proxy, { force: true });
  const ipBefore = traceBefore.ip;
  let beforeText = ipBefore ? ipBefore : "unknown";
  if (traceBefore.country) beforeText = beforeText + "  " + traceBefore.country;
  writeInfo("egress ip before: " + beforeText);

  writeStep("");
  writeStep("[1/6] device identity");
  const idHelper = path.join(root, "lib", "identity.js");
  let identity = null;
  if (pathExists(idHelper)) {
    const raw = invokeNodeHelper(idHelper, [dry ? "show" : "rotate"]);
    try {
      identity = JSON.parse(raw);
    } catch {
      identity = null;
    }
  }
  if (identity && identity.deviceId) {
    if (dry) writeInfo("current id: " + identity.deviceId);
    else writeOk("device id : " + identity.deviceId);
    writeInfo("generation: " + identity.generation + "   fingerprint: " + identity.fingerprint);
    writeInfo("local only, the registry and the real machine guid are untouched");
  } else {
    writeWarn("device identity skipped");
  }

  writeStep("");
  writeStep("[2/6] stored limit errors");
  if (dry) {
    writeInfo("skipped in a dry run");
  } else {
    removeStuckErrors(target);
  }

  writeStep("");
  writeStep("[3/6] session ids");
  if (keepIds) {
    writeInfo("skipped, -KeepIds was passed");
  } else if (!target) {
    writeInfo("skipped, name a folder to re-id its sessions");
    writeInfo('opencode-unlimited reset "/path/to/project"');
  } else if (!testNodeSqlite()) {
    writeWarn("node 22.5+ required, session ids left alone");
  } else {
    showReidBatch(invokeReidPath(target, { dry: dry }));
  }

  writeStep("");
  writeStep("[4/6] egress route");
  if (hunt) {
    if (dry) writeInfo("would hunt for a route that is not already spent");
    else invokeHunt(cfg, 4, 8, "", "", {});
  } else {
    invokeEgressRotation(cfg, ipBefore, "", "", { dry: dry });
  }

  writeStep("");
  writeStep("[5/6] egress block");
  sleepSync(1000);
  const traceAfter = getEgressTrace(cfg.proxy, { force: true });
  const ipAfter = traceAfter.ip;
  if (dry) {
    writeInfo("ip now: " + (ipAfter ? ipAfter : "unknown") + ", nothing recorded");
  } else {
    cfg.lastIp = ipAfter;
    cfg.lastCountry = traceAfter.country;
    saveConfig(cfg);
    const egressHelper = path.join(root, "lib", "egress.js");
    if (pathExists(egressHelper) && ipAfter) {
      process.env.UNLIMITED_EGRESS_IP = ipAfter;
      if (traceAfter.country) process.env.UNLIMITED_EGRESS_COUNTRY = traceAfter.country;
      invokeNodeHelper(egressHelper, ["record", "0", "0"]);
      delete process.env.UNLIMITED_EGRESS_IP;
      delete process.env.UNLIMITED_EGRESS_COUNTRY;
    }
    if (!ipAfter) {
      writeWarn("egress ip unknown");
    } else if (ipBefore && testSameBlock(ipAfter, ipBefore)) {
      writeWarn("same egress block: " + ipAfter + " " + traceAfter.country);
      writeInfo("the meter follows the egress block, not the project, the session or the device");
      writeInfo("if a refusal was logged today, this block stays spent until 00:00 UTC");
      writeInfo("change the connection, or switch model to leave the meter behind");
    } else {
      writeOk("new egress block: " + ipAfter + " " + traceAfter.country);
    }
  }

  writeStep("");
  writeStep("[6/6] database");
  if (dry) {
    writeInfo("skipped in a dry run");
  } else {
    cmdVerify(true);
    writeInfo("sessions and messages untouched");
  }

  writeStep("");
  const midnight = getMidnightUtc();
  if (dry) writeOk("dry run complete, nothing was written");
  else writeOk("reset complete");
  writeInfo("quota resets at " + formatClock12(midnight) + " local, " + formatUtcClock(midnight) + " UTC");
  writeInfo("switch model to skip the meter: opencode-unlimited model provider/model");
}

function invokeHunt(cfg, tries, minutes, country, prefix, options) {
  const opts = options || {};
  let maxTries = tries;
  let maxMinutes = minutes;
  if (maxTries <= 0) maxTries = 6;
  if (maxMinutes <= 0) maxMinutes = 10;
  const started = Date.now();
  let avoid = getEgressIp(cfg.proxy, { force: true });
  let same = 0;
  let burned = 0;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    if ((Date.now() - started) / 60000 > maxMinutes) {
      writeWarn("hunt: time is up");
      return null;
    }
    writeInfo("[" + attempt + "/" + maxTries + "] rotating");
    const trace = invokeEgressRotation(cfg, avoid, country, prefix, { noRestart: opts.noRestart, tries: maxTries });
    if (!trace) {
      writeWarn("  no route matched");
      sleepSync(2000);
      continue;
    }
    if (avoid && testSameBlock(trace.ip, avoid)) {
      same += 1;
      writeWarn("  same block as before (" + same + "/3)");
      if (same >= 3) {
        writeBad("  the rotation keeps returning the same block");
        return null;
      }
      sleepSync(2000);
      continue;
    }
    same = 0;
    avoid = trace.ip;
    if (opts.noProbe) return trace;
    const app = invokeAppProbe("");
    if (app.ok) {
      addEgressRecord(200, 0, trace.country);
      writeOk("  route accepted: " + trace.ip + " " + trace.country);
      return trace;
    }
    if (app.blocked) {
      burned += 1;
      addEgressRecord(429, 0, trace.country);
      writeWarn("  block already spent (" + burned + " burned)");
      if (burned >= 4) {
        writeBad("  too many burned blocks, stopping");
        return null;
      }
      continue;
    }
    writeWarn("  probe unconfirmed: " + app.reason);
    return trace;
  }
  writeBad("hunt: no usable route found");
  return null;
}

function testRotateGate() {
  const now = utcNowSeconds();
  const state = readJson(rotateGateFile);
  const keep = [];
  if (state && state.stamps) {
    for (const stamp of asArray(state.stamps)) {
      if (now - Number(stamp) < 1800) keep.push(Number(stamp));
    }
  }
  if (keep.length >= 5) return false;
  keep.push(now);
  writeTextFile(rotateGateFile, JSON.stringify({ stamps: keep }, null, 2));
  return true;
}

function cmdHunt() {
  const cfg = getConfig();
  const tries = getRestInt(["-Tries", "--tries", "-n"], 6);
  const minutes = getRestInt(["-Minutes", "--minutes", "-m"], 10);
  const country = getRestFlag(["-Country", "--country"], "").toUpperCase();
  const prefix = getRestFlag(["-Prefix", "--prefix"], "");
  const noProbe = restHas(["-NoProbe", "--no-probe"]);
  const noRestart = restHas(["-NoRestart", "--no-restart"]);
  writeStep("==> route hunt");
  writeInfo("tries   : " + tries);
  writeInfo("minutes : " + minutes);
  if (country) writeInfo("country : " + country);
  if (prefix) writeInfo("prefix  : " + prefix);
  if (noProbe) writeInfo("probe   : off, the route is taken on trust");
  if (noRestart) writeInfo("restart : off, the service keeps its current process");
  writeStep("");
  const trace = invokeHunt(cfg, tries, minutes, country, prefix, { noProbe: noProbe, noRestart: noRestart });
  writeStep("");
  if (trace) {
    writeOk("live route: " + trace.ip + " " + trace.country);
    writeInfo("send the prompt again, the meter is on the new block");
  } else {
    writeBad("no usable route found");
    writeInfo("add proxies: opencode-unlimited proxy pool add socks5://host:port");
    writeInfo("or point at a list: opencode-unlimited proxy pool fetch <url>");
  }
}

async function cmdWatch() {
  const follow = restHas(["-Follow", "--follow", "-f"]);
  const auto = restHas(["-Auto", "--auto"]);
  const all = restHas(["-All", "--all"]);
  const helper = path.join(root, "lib", "log-watch.js");
  if (!pathExists(helper)) {
    writeBad("missing helper: " + helper);
    return;
  }
  writeStep("==> free limit watcher");
  let scanArgs = ["scan"];
  if (all) scanArgs.push("--reset");
  let first = true;
  while (true) {
    let scan = null;
    try {
      scan = JSON.parse(invokeNodeHelper(helper, scanArgs));
    } catch {
      scan = null;
    }
    if (!scan || !scan.file) {
      writeBad("no opencode log found, start opencode once");
      return;
    }
    if (first) {
      writeInfo("log    : " + scan.file);
      writeInfo("offset : " + scan.from + " -> " + scan.offset);
      first = false;
      scanArgs = ["scan"];
    }
    let events = asArray(scan.events);
    if (!events.length && !follow) {
      writeOk("no free-limit line in the new part of the log");
      writeInfo("pass -all to rescan the whole file, -follow to keep tailing");
    }
    if (events.length > 6) {
      writeInfo("older events hidden: " + (events.length - 6));
      events = events.slice(events.length - 6);
    }
    let rotateSeen = 0;
    let handled = false;
    const now = new Date();
    for (const event of events) {
      const local = event.at ? new Date(event.at) : new Date();
      const when = formatWatchStamp(local, now);
      const label = event.message ? event.message : "error";
      const reasonText = event.reason ? "  [" + event.reason + "]" : "";
      if (event.kind === "rotate") {
        rotateSeen += 1;
        writeBad("limit at " + when + "   " + label + reasonText + "  run=" + event.run);
        if (!auto) continue;
        if (!testRotateGate()) {
          writeWarn("rotation gate: 5 moves per 30 minutes, holding");
          continue;
        }
        const cfg = getConfig();
        const trace = invokeHunt(cfg, 4, 8, "", "", {});
        if (trace) {
          writeOk("route live: " + trace.ip + " " + trace.country);
          writeInfo("send the prompt again, the new block is in place");
          handled = true;
          if (follow) return;
        } else {
          writeWarn("no usable route yet, still watching");
        }
      } else {
        writeWarn("rate limit at " + when + "   " + label + reasonText + "  run=" + event.run);
        writeInfo("that is a throttle, not the daily bucket: wait and retry");
      }
    }
    if (rotateSeen > 0 && !auto && !handled) {
      writeInfo("next: opencode-unlimited hunt");
      writeInfo("or let the watcher drive: opencode-unlimited watch -follow -auto");
    }
    if (!follow) return;
    await sleep(2000);
  }
}

function cmdToken() {
  const sub = REST.length >= 1 ? String(REST[0]).toLowerCase() : "status";
  if (sub === "save") {
    if (!pathExists(authDir)) {
      writeBad("no auth.json at " + authDir);
      return;
    }
    ensureDir(authSnapshotDir);
    fs.copyFileSync(authDir, authSnapshot);
    const size = fs.statSync(authSnapshot).size;
    writeOk("token snapshot saved, " + size + " bytes");
    writeInfo("path: " + authSnapshot);
    writeInfo("local app data only, nothing synced, the registry is untouched");
    return;
  }
  if (sub === "restore") {
    if (!pathExists(authSnapshot)) {
      writeBad("no snapshot yet, run: opencode-unlimited token save");
      return;
    }
    const force = restHas(["-Force", "--force"]);
    if (pathExists(authDir) && !force) {
      writeWarn("auth.json is already there, pass -Force to overwrite it");
      return;
    }
    fs.copyFileSync(authSnapshot, authDir);
    writeOk("auth.json restored, no login needed");
    writeInfo("restart opencode so it reads the file");
    return;
  }
  if (sub === "drop") {
    try {
      if (fs.existsSync(authSnapshot)) fs.unlinkSync(authSnapshot);
    } catch {}
    writeOk("token snapshot removed");
    return;
  }
  let live = "missing";
  if (pathExists(authDir)) {
    const item = fs.statSync(authDir);
    live = String(item.size) + " bytes, " + formatYmdHm(item.mtime);
  }
  let snap = "missing";
  if (pathExists(authSnapshot)) {
    const item = fs.statSync(authSnapshot);
    snap = String(item.size) + " bytes, " + formatYmdHm(item.mtime);
  }
  writeInfo("auth.json : " + live);
  writeInfo("snapshot  : " + snap);
  writeInfo("path      : " + authSnapshot);
  writeInfo("save keeps a local copy, restore puts it back after the app drops it");
}

function getOpenCodeExe() {
  const info = getOpenCodeInfo();
  if (info.exe && info.exe !== "opencode" && pathExists(info.exe)) return info.exe;
  return resolveOpenCode();
}

function testLimitOutput(text) {
  if (!text) return false;
  return /FreeUsageLimit|Free usage limit|free messages|free tier/.test(text);
}

function removeProbeSession(oc, sessionId) {
  if (!sessionId) return;
  try {
    spawnSync(oc, ["session", "delete", sessionId], { stdio: "ignore" });
  } catch {}
}

function invokeAppProbe(directory) {
  const oc = getOpenCodeExe();
  if (!oc || oc === "opencode" || !pathExists(oc)) {
    return { ok: false, blocked: false, broken: true, kind: "broken", reason: "opencode binary not found", raw: "", model: "", session: "" };
  }
  const cfg = getConfig();
  const info = getOpenCodeInfo();
  const model = "opencode/" + resolveProbeModel(cfg, info);
  let work = directory;
  let throwaway = false;
  if (!work) {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "unlimited-probe-"));
    throwaway = true;
  }
  let out = "";
  let code = 1;
  try {
    const result = spawnSync(oc, ["run", "--format", "json", "-m", model, "reply with exactly: ok"], {
      cwd: work,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180000,
    });
    out = String(result.stdout || "") + String(result.stderr || "");
    code = result.status === null ? 1 : result.status;
  } catch (error) {
    out = String(error && error.message ? error.message : error);
    code = 1;
  } finally {
    if (throwaway) {
      try {
        fs.rmSync(work, { recursive: true, force: true });
      } catch {}
    }
  }
  let session = "";
  const match = /(ses_[A-Za-z0-9]+)/.exec(out);
  if (match) session = match[1];
  if (session) removeProbeSession(oc, session);
  if (testLimitOutput(out)) {
    return { ok: false, blocked: true, broken: false, kind: "limit", reason: "app refused on free limit", raw: out, model: model, session: session };
  }
  if (code === 0 && /\bok\b/.test(out)) {
    return { ok: true, blocked: false, broken: false, kind: "ok", reason: "app answered", raw: out, model: model, session: session };
  }
  return { ok: false, blocked: false, broken: true, kind: "broken", reason: "app did not answer", raw: out, model: model, session: session };
}

function getVirtualIdentity() {
  const helper = path.join(root, "lib", "identity.js");
  if (!pathExists(helper)) return null;
  const raw = invokeNodeHelper(helper, ["show"]);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cmdIdentity() {
  const helper = path.join(root, "lib", "identity.js");
  if (!pathExists(helper)) {
    writeBad("missing helper: " + helper);
    return;
  }
  let action = "show";
  if (restHas(["rotate", "--rotate"])) action = "rotate";
  if (restHas(["restore", "--restore"])) action = "restore";
  const raw = invokeNodeHelper(helper, [action]);
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!data) {
    writeBad("identity helper returned nothing");
    return;
  }
  if (action === "restore") {
    writeOk("virtual device identity removed");
    writeInfo("state   : " + data.stateFile);
    writeInfo("the real machine guid was never written, nothing to undo there");
    return;
  }
  writeStep("==> device identity");
  if (!data.exists && action === "show") {
    writeWarn("no virtual identity minted yet");
    writeInfo("opencode-unlimited identity rotate");
    return;
  }
  writeInfo("device id  : " + data.deviceId);
  writeInfo("fingerprint: " + data.fingerprint);
  writeInfo("generation : " + data.generation);
  writeInfo("state      : " + data.stateFile);
  writeInfo("value file : " + data.shimFile);
  writeInfo("registry   : not touched");
  if (action === "rotate") writeOk("new device identity minted");
}

function addEgressRecord(status, retryAfter, country) {
  const cfg = getConfig();
  const trace = getEgressTrace(cfg.proxy, { force: true });
  if (!trace.ip) return "";
  const helper = path.join(root, "lib", "egress.js");
  if (!pathExists(helper)) return trace.ip;
  process.env.UNLIMITED_EGRESS_IP = trace.ip;
  if (country) process.env.UNLIMITED_EGRESS_COUNTRY = country;
  else if (trace.country) process.env.UNLIMITED_EGRESS_COUNTRY = trace.country;
  invokeNodeHelper(helper, ["record", String(status), String(retryAfter)]);
  delete process.env.UNLIMITED_EGRESS_IP;
  delete process.env.UNLIMITED_EGRESS_COUNTRY;
  return trace.ip;
}

function cmdBlock() {
  const helper = path.join(root, "lib", "egress.js");
  if (!pathExists(helper)) {
    writeBad("missing helper: " + helper);
    return;
  }
  if (restHas(["clear", "--clear"])) {
    invokeNodeHelper(helper, ["clear"]);
    writeOk("egress ledger cleared for today");
    return;
  }
  if (restHas(["check", "--check"])) {
    const cfg = getConfig();
    const ip = getEgressIp(cfg.proxy, { force: true });
    if (!ip) {
      writeBad("could not read the egress ip");
      return;
    }
    const raw = invokeNodeHelper(helper, ["check", ip]);
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    writeStep("==> " + ip + "  block " + (data ? data.block : "?"));
    if (data && data.spent) {
      writeWarn("SPENT - refused today, dead until 00:00 UTC");
      writeInfo("change the address, or switch model");
    } else {
      writeOk("no refusal recorded today on this block");
    }
    return;
  }
  const raw = invokeNodeHelper(helper, ["show"]);
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!data) {
    writeBad("egress ledger unreadable");
    return;
  }
  writeStep("==> egress blocks seen today (" + data.total + ", spent " + data.spent + ")");
  writeInfo("the meter keys on the block, an ipv4 address or an ipv6 /64");
  for (const row of asArray(data.blocks)) {
    const state = row.spent ? "SPENT" : "open ";
    const where = row.country ? "  " + pdf(row.country, 2) : "    ";
    writeInfo(pdf(row.block, 24) + " " + state + where + "  open=" + row.open + " refused=" + row.refused + "  last=" + row.lastStatus);
  }
  const minutes = Math.floor(Number(data.secondsToReset || 0) / 60);
  writeStep("");
  writeInfo("reset at 00:00 UTC, in " + minutes + " minutes");
}

function cmdUsage() {
  const cfg = getConfig();
  const deep = restHas(["-check", "--check", "-live", "--live"]);
  writeStep("==> free tier check");
  const trace = getEgressTrace(cfg.proxy, { force: true });
  const ip = trace.ip;
  writeInfo("egress ip : " + (ip ? ip : "unknown"));
  if (trace.country) writeInfo("country   : " + trace.country);
  if (trace.warp) writeInfo("warp      : " + trace.warp);
  cfg.lastIp = ip;
  cfg.lastCountry = trace.country;
  saveConfig(cfg);

  const helper = path.join(root, "lib", "egress.js");
  let row = null;
  let ledger = null;
  if (pathExists(helper) && ip) {
    let raw = invokeNodeHelper(helper, ["check", ip]);
    try {
      row = JSON.parse(raw);
    } catch {
      row = null;
    }
    if (row && !row.known) row = null;
    raw = invokeNodeHelper(helper, ["show"]);
    try {
      ledger = JSON.parse(raw);
    } catch {
      ledger = null;
    }
  }

  if (row) {
    writeInfo("block     : " + row.block);
    if (row.spent) {
      writeWarn("SPENT - a refusal was recorded today (HTTP " + row.lastStatus + ")");
      writeInfo("the meter is per egress block, every session on this address shares it");
      writeInfo("change the address, or switch model, or wait for the reset");
    } else {
      writeOk("no refusal recorded today on this block");
      if (row.open > 0) writeInfo(row.open + " answered requests seen today");
    }
  } else {
    writeInfo("block     : " + (ip ? ip : "unknown"));
    writeWarn("nothing recorded today on this block");
    writeInfo("a refusal gets logged here the next time the app reports one");
  }

  if (deep) {
    writeStep("");
    writeStep("app check");
    writeInfo("this opens a throwaway session, then deletes it");
    const app = invokeAppProbe("");
    if (app.ok) {
      addEgressRecord(200, 0, trace.country);
      writeOk("OPEN - the app answered on this connection");
    } else if (app.blocked) {
      addEgressRecord(429, 0, trace.country);
      writeBad("BLOCKED - the app itself was refused on this connection");
    } else {
      writeWarn("unconfirmed - " + app.reason);
    }
    if (app.session) writeInfo("probe session removed: " + app.session);
  }

  if (ledger) {
    writeStep("");
    writeInfo("blocks today: " + ledger.total + "   spent " + ledger.spent);
  }

  const midnight = getMidnightUtc();
  const wait = Math.floor((midnight.getTime() - Date.now()) / 60000);
  writeStep("");
  writeInfo("reset : " + formatClock12(midnight) + " local   in " + wait + " minutes");
  writeInfo("zero-cost detection: opencode-unlimited watch");
  writeInfo("skip the meter entirely: opencode-unlimited model");
}

function invokeReidPath(target, options) {
  const opts = options || {};
  const db = getDatabasePath();
  if (!db) return null;
  const helper = path.join(root, "lib", "session-reid.js");
  if (!pathExists(helper)) return null;
  const cmdArgs = [db, "reid-all", target];
  if (opts.dry) cmdArgs.push("--dry");
  const raw = invokeNodeHelper(helper, cmdArgs);
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!data) {
    const text = raw
      .split("\n")
      .filter((line) => line.trim())
      .slice(0, 2)
      .join(" ");
    return { error: text };
  }
  return data;
}

function showReidBatch(data) {
  if (!data) {
    writeBad("no result");
    return;
  }
  if (data.error) {
    writeBad(String(data.error));
    return;
  }
  if (data.dryRun) {
    let sum = 0;
    for (const row of asArray(data.results)) sum += Number(row.bytes || 0);
    const mb = Math.round((sum / 1048576) * 10) / 10;
    writeStep("==> would re-id " + data.selected + " of " + data.total + " sessions, " + mb + " MB");
    for (const row of asArray(data.results).slice(0, 15)) {
      writeInfo(row.oldId + "  messages=" + row.messages + " refs=" + row.refs);
    }
    if (Number(data.total) > 15) writeInfo("... and " + (Number(data.total) - 15) + " more");
    writeInfo("nothing was written, drop -Dry to run it");
    return;
  }
  for (const row of asArray(data.results)) {
    writeOk(row.oldId + "  ->  " + row.newId + "  (" + row.messages + " messages, " + row.moved + " rows moved)");
  }
  for (const row of asArray(data.failed)) {
    if (row) writeBad(row.oldId + "  " + row.error);
  }
  writeInfo("total   : " + data.total + " sessions in that folder");
  writeInfo("reid    : " + data.reid + "   failed: " + asArray(data.failed).length);
  writeInfo("moved   : " + data.rows + " rows, " + data.messages + " messages kept");
  writeInfo("no rows were deleted, the old ids are gone from the table");
}

function cmdReid() {
  if (!testNodeSqlite()) {
    writeBad("node 22.5+ required");
    return;
  }
  const dry = restHas(["-Dry", "--dry"]);
  const target = getPathArg();
  if (!target) {
    writeStep("==> mint a fresh session id");
    writeBad("name a session id or a folder");
    writeInfo("opencode-unlimited reid ses_abc123...");
    writeInfo('opencode-unlimited reid "/path/to/project" -Dry');
    return;
  }

  if (String(target).startsWith("ses_")) {
    if (dry) writeInfo("dry run is for folders, a single id is one transaction");
    writeStep("==> minting a fresh session id");
    const db = getDatabasePath();
    if (!db) {
      writeBad("opencode.db not found");
      return;
    }
    const helper = path.join(root, "lib", "session-reid.js");
    if (!pathExists(helper)) {
      writeBad("missing helper: " + helper);
      return;
    }
    const raw = invokeNodeHelper(helper, [db, "reid", target]);
    let result = null;
    try {
      result = JSON.parse(raw);
    } catch {
      result = null;
    }
    if (!result || !result.newId || result.error) {
      writeBad("reid failed");
      const reason = result && result.error ? String(result.error) : raw.split("\n").filter((line) => line.trim()).slice(0, 2).join(" ");
      writeInfo(reason);
      return;
    }
    writeOk("old id : " + result.oldId);
    writeOk("new id : " + result.newId);
    writeInfo("table  : " + result.sessionTable);
    writeInfo("messages: " + result.messages + "   rows moved: " + result.moved);
    if (result.sequence !== null && result.sequence !== undefined) writeInfo("sequence: " + result.sequence + " (counter kept ahead of the messages)");
    for (const item of asArray(result.touched)) {
      if (item) writeInfo("moved  : " + item);
    }
    writeInfo("open the new id in the app, the messages are all there");
    writeInfo("reid does not refill the quota, it only breaks a fork chain");
    return;
  }

  writeStep("==> re-id every session in " + target);
  showReidBatch(invokeReidPath(target, { dry: dry }));
  writeInfo("reid does not refill the quota, it only breaks a fork chain");
}

function testModelSpec(value) {
  if (!value) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  if (/^ses_/.test(value)) return false;
  if (!value.includes("/")) return false;
  if (pathExists(value)) return false;
  return true;
}

function writeModelLine(model) {
  if (!model) return "unset";
  const provider = String(model.providerID || "");
  const id = String(model.id || "");
  const variant = String(model.variant || "");
  if (!provider) return JSON.stringify(model);
  let text = provider + "/" + id;
  if (variant) text = text + "#" + variant;
  return text;
}

function cmdModel() {
  const db = getDatabasePath();
  if (!db) {
    writeBad("opencode.db not found");
    return;
  }
  if (!testNodeSqlite()) {
    writeBad("node 22.5+ required");
    return;
  }
  const helper = path.join(root, "lib", "model-switch.js");
  if (!pathExists(helper)) {
    writeBad("missing helper: " + helper);
    return;
  }

  const items = getRestArgs();
  let target = "";
  let spec = "";

  if (items.length === 0) {
    const raw = invokeNodeHelper(helper, [db, "list"]);
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    if (!data || !data.providers) {
      writeBad("could not read the model registry");
      writeInfo("run opencode once so the cache fills, then try again");
      return;
    }
    const providers = asArray(data.providers);
    writeStep("==> providers with credentials (" + providers.length + ")");
    writeInfo("registry: " + data.registry);
    writeInfo("free means the provider bills nothing for that model");
    for (const provider of providers) {
      const models = asArray(provider.models);
      const free = models.filter((model) => model.free);
      writeStep("");
      writeStep("  " + provider.providerID + "  models=" + models.length + "  free=" + free.length);
      for (const model of free.slice(0, 12)) {
        let ctx = "";
        if (Number(model.context || 0) > 0) ctx = "  ctx " + Math.round(Number(model.context) / 1000) + "k";
        writeInfo("    " + provider.providerID + "/" + model.id + ctx);
      }
      if (free.length === 0) {
        for (const model of models.slice(0, 4)) {
          writeInfo("    " + provider.providerID + "/" + model.id);
        }
      }
    }
    writeStep("");
    writeInfo("switch a session: opencode-unlimited model <session-id|folder> provider/model");
    return;
  }

  if (items.length === 1) {
    if (testModelSpec(items[0])) {
      spec = items[0];
      target = process.cwd();
    } else {
      target = items[0];
    }
  } else {
    target = items[0];
    spec = items[1];
  }

  if (!spec) {
    const raw = invokeNodeHelper(helper, [db, "get", target]);
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    if (!data || !data.sessions) {
      writeBad("could not read the model for that target");
      if (data && data.error) writeInfo(String(data.error));
      return;
    }
    const sessions = asArray(data.sessions);
    writeStep("==> current model (" + sessions.length + " sessions)");
    for (const row of sessions) {
      writeInfo(row.id + "  " + writeModelLine(row.model));
    }
    return;
  }

  const raw = invokeNodeHelper(helper, [db, "set", target, spec]);
  let result = null;
  try {
    result = JSON.parse(raw);
  } catch {
    result = null;
  }
  if (!result || result.error) {
    writeBad("switch failed");
    if (result && result.error) writeInfo(String(result.error));
    return;
  }

  writeStep("==> model switched");
  writeInfo("target : " + result.kind + " " + (result.directory ? result.directory : ""));
  writeInfo("model  : " + result.spec);
  for (const row of asArray(result.changed)) {
    writeOk(row.id + "  " + writeModelLine(row.before) + " -> " + writeModelLine(row.after));
  }
  writeInfo("sessions changed: " + asArray(result.changed).length);
  writeStep("");
  if (result.applied && result.applied.providerID === "opencode") {
    writeWarn("opencode models are metered per egress address, this keeps the daily wall");
  } else {
    writeOk("this pipe is not metered by the opencode free wall");
  }
  writeInfo("restart the app so the session picks up the new model");
}

function cmdSessions() {
  const db = getDatabasePath();
  if (!db) {
    writeBad("opencode.db not found");
    return;
  }
  if (!testNodeSqlite()) {
    writeBad("node 22.5+ required");
    return;
  }
  const helper = path.join(root, "lib", "session-reid.js");
  if (!pathExists(helper)) {
    writeBad("missing helper: " + helper);
    return;
  }
  const target = getPathArg();
  const cmdArgs = [db, "list"];
  if (target) cmdArgs.push(target);
  const raw = invokeNodeHelper(helper, cmdArgs);
  let rows = [];
  try {
    rows = asArray(JSON.parse(raw));
  } catch {
    rows = [];
  }
  if (rows.length === 0) {
    writeWarn("no sessions found");
    return;
  }
  let schema = "";
  const info = getOpenCodeInfo();
  if (info.sessionTable) schema = info.sessionTable;
  writeStep("==> sessions (" + rows.length + ")" + (schema ? ", table " + schema : ""));
  writeInfo("size is the replayed history, the thing a free turn has to pay for");
  for (const row of rows) {
    let title = String(row.title || "");
    if (!title) title = "(untitled)";
    if (title.length > 40) title = title.slice(0, 40);
    let when = "";
    if (Number(row.updated || 0) > 0) when = formatMonthDayTime(new Date(Number(row.updated)));
    const mb = Math.round((Number(row.bytes || 0) / 1048576) * 10) / 10;
    const size = pdl(mb.toFixed(1), 7) + " MB";
    writeInfo(row.id + "  " + pdf(when, 12) + "  " + size + "  " + title);
  }
}

function formatMonthDayTime(date) {
  const month = date.getMonth() + 1;
  return month + "/" + date.getDate() + " " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

function cmdStatus() {
  const cfg = getConfig();
  const info = getOpenCodeInfo();
  writeStep("==> opencode-unlimited status");
  writeStep("");
  writeStep("runtime");
  let versionText = info.version ? "v" + info.version : "not detected";
  if (info.api) versionText += "  (api v" + info.api + ")";
  writeInfo("opencode   : " + versionText);
  writeInfo("binary     : " + info.exe);
  writeInfo("service    : " + (info.running ? "running" : "not running (start the app once)"));
  writeInfo("gateway    : " + info.gateway);
  writeInfo("database   : " + (info.dbPath ? info.dbPath : "not found"));
  writeInfo("session t. : " + (info.sessionTable ? info.sessionTable : "unknown"));
  if (asArray(info.freeModels).length > 0) {
    writeInfo("free models: " + asArray(info.freeModels).length + " listed, default " + info.freeModel);
  }
  writeStep("");
  writeStep("identity");
  const vid = getVirtualIdentity();
  if (vid && vid.exists) {
    writeInfo("device id  : " + vid.deviceId);
    writeInfo("fingerprint: " + vid.fingerprint + "   generation " + vid.generation);
    writeInfo("registry   : not touched, this id lives in a local file");
  } else {
    writeWarn("no virtual identity yet, run: opencode-unlimited identity rotate");
  }
  writeStep("");
  writeStep("plugin");
  writeInfo("state      : " + getPluginState());
  writeInfo("path       : " + pluginFile);
  writeInfo("config     : " + (testPluginRegistered() ? pluginEntry + " listed" : "not listed, so opencode never loads it"));
  const live = testPluginLive();
  if (live) {
    writeInfo("loaded     : opencode " + live.version + ", hooks " + asArray(live.hooks).join(", ") + ", at " + live.at);
  }
  writeStep("");
  writeStep("automation");
  const watchPid = getWatcherPid();
  const watchLive = watchPid > 0 && pidAlive(watchPid);
  writeInfo("mode       : " + (cfg.autoMode ? "on" : "off"));
  writeInfo("watcher    : " + (watchLive ? "running (pid " + watchPid + ")" : "stopped"));
  writeInfo("autostart  : " + getAutoStartState());
  const health = getProxyHealthReport(cfg);
  if (health) {
    writeInfo("pool health: " + health.usable + " usable, " + health.held + " parked of " + health.total);
  } else {
    writeInfo("pool health: no pool yet");
  }
  writeStep("");
  writeStep("network");
  const trace = getEgressTrace(cfg.proxy, {});
  let ipText = trace.ip ? trace.ip : "unknown";
  if (trace.country) ipText = ipText + "  " + trace.country;
  if (trace.warp) ipText = ipText + "  warp=" + trace.warp;
  writeInfo("egress ip  : " + ipText);
  writeInfo("ipMode     : " + cfg.ipMode);
  writeInfo("upstream   : " + (cfg.proxy ? cfg.proxy : "none (manual)"));
  if (cfg.proxyListUrl) writeInfo("list url   : " + cfg.proxyListUrl);
  const bridgePid = getBridgePid();
  if (bridgePid > 0 && pidAlive(bridgePid)) {
    writeInfo("bridge     : running (pid " + bridgePid + ", port " + cfg.bridgePort + ")");
  } else {
    writeInfo("bridge     : stopped");
  }
  const warp = getWarpCli();
  writeInfo("warp-cli   : " + (warp ? warp : "not installed (optional)"));
  writeStep("");
  writeStep("egress ledger");
  const helper = path.join(root, "lib", "egress.js");
  if (pathExists(helper)) {
    const raw = invokeNodeHelper(helper, ["show"]);
    let ledger = null;
    try {
      ledger = JSON.parse(raw);
    } catch {
      ledger = null;
    }
    if (ledger) {
      writeInfo("today       : " + ledger.day + "   blocks seen " + ledger.total + "   spent " + ledger.spent);
      const minutes = Math.floor(Number(ledger.secondsToReset || 0) / 60);
      writeInfo("next reset  : 00:00 UTC, in " + minutes + " minutes");
    } else {
      writeWarn("ledger unreadable");
    }
  } else {
    writeWarn("egress helper missing");
  }
  writeInfo("details     : opencode-unlimited usage");
}

function selectFreeModel(cfg) {
  const info = getOpenCodeInfo();
  const free = asArray(info.freeModels);
  const current = String(cfg.model || "");
  if (current && (free.length === 0 || free.includes(current))) return current;
  let pick = String(info.freeModel || "");
  if (!pick && free.length > 0) pick = String(free[0]);
  if (!pick) pick = defaultModel;
  if (pick !== current) {
    cfg.model = pick;
    saveConfig(cfg);
  }
  return pick;
}

function invokeAutoSetup(cfg, options) {
  const opts = options || {};
  const total = 7;
  writeStep("[1/" + total + "] prerequisites");
  writeOk("node " + String(process.version || "").trim());
  const oc = resolveOpenCode();
  writeInfo("opencode : " + oc);
  const dbPath = getDatabasePath();
  writeInfo("database : " + (dbPath ? dbPath : "not found, the app has not run yet"));

  writeStep("");
  writeStep("[2/" + total + "] device identity");
  const idHelper = path.join(root, "lib", "identity.js");
  if (!pathExists(idHelper)) {
    writeWarn("identity helper missing");
  } else {
    const action = opts.keepId ? "show" : "rotate";
    const raw = invokeNodeHelper(idHelper, [action]);
    let ident = null;
    try {
      ident = JSON.parse(raw);
    } catch {
      ident = null;
    }
    if (ident && ident.deviceId) {
      const tag = opts.keepId ? "kept" : "fresh";
      writeOk("device id : " + ident.deviceId + "  (" + tag + ")");
      writeInfo("generation: " + ident.generation + "   fingerprint: " + ident.fingerprint);
      writeInfo("local file only, the registry and the real machine id are untouched");
    } else {
      writeWarn("identity left as it was");
    }
  }

  writeStep("");
  writeStep("[3/" + total + "] model");
  const model = selectFreeModel(cfg);
  writeOk("free model: " + model);

  writeStep("");
  writeStep("[4/" + total + "] proxy pool");
  let pool = getProxyPool(cfg);
  if (pool.length === 0) {
    writeInfo("pool is empty, pulling a public list");
    updateProxyList(cfg, {});
    pool = getProxyPool(cfg);
  }
  if (pool.length > 0) {
    const report = getProxyHealthReport(cfg);
    let tail = "";
    if (report) tail = ", " + report.usable + " usable, " + report.held + " parked";
    writeOk(String(pool.length) + " candidates" + tail);
  } else {
    writeWarn("no proxy list came back, the machine keeps its own route");
  }

  writeStep("");
  writeStep("[5/" + total + "] egress route");
  if (opts.keepRoute) {
    const trace = getEgressTrace(cfg.proxy, { force: true });
    if (trace.ip) writeInfo("left alone, egress " + trace.ip + " " + trace.country);
    else writeWarn("route unknown");
  } else if (pool.length === 0) {
    writeInfo("no pool to rotate through, nothing to change");
  } else {
    let tries = Number(cfg.autoTries);
    let minutes = Number(cfg.autoMinutes);
    if (!(tries > 0)) tries = 12;
    if (!(minutes > 0)) minutes = 8;
    writeInfo("hunting: " + tries + " tries, " + minutes + " minute cap" + (opts.noProbe ? ", probe off" : ", each route probed"));
    const trace = invokeHunt(cfg, tries, minutes, "", "", { noProbe: opts.noProbe });
    if (trace) {
      writeOk("route live: " + trace.ip + " " + trace.country + "  [" + trace.ms + " ms]");
    } else {
      writeWarn("nothing in the pool worked, rolling back to direct");
      cfg.proxy = "";
      cfg.ipMode = "manual";
      saveConfig(cfg);
      applyProxy(cfg, {});
      restartService();
    }
  }

  writeStep("");
  writeStep("[6/" + total + "] sessions");
  const here = process.cwd();
  writeInfo("clearing stored free-limit errors in every session, not just this folder");
  removeStuckErrors();
  if (opts.noReid || !cfg.reidOnAuto) {
    writeInfo("reid skipped");
  } else if (!testNodeSqlite()) {
    writeWarn("node 22.5+ required for reid, sessions left alone");
  } else {
    showReidBatch(invokeReidPath(here, {}));
  }

  writeStep("");
  writeStep("[7/" + total + "] watcher and plugin");
  if (!installPlugin()) writeWarn("plugin not installed, everything else still runs");
  setPluginEnabled(true);
  sleepSync(1200);
  const live = testPluginLive();
  if (live) {
    writeOk("plugin loaded in opencode " + live.version + ", hooks " + asArray(live.hooks).join(", "));
  } else {
    writeInfo("plugin is installed and listed, opencode picks it up on the next file save or app start");
  }
  if (opts.noStart) {
    writeInfo("watcher skipped, -NoStart was passed");
  } else {
    cfg.autoMode = true;
    saveConfig(cfg);
    startWatcherDaemon();
    if (installAutoStart()) cfg.autoStart = true;
    saveConfig(cfg);
  }
  return true;
}

function cmdOn() {
  const cfg = getConfig();
  writeStep("==> opencode-unlimited on");
  writeInfo("one pass: identity, model, pool, verified route, sessions, watcher");
  writeInfo("after that the watcher keeps it moving by itself");
  writeStep("");
  const ok = invokeAutoSetup(cfg, {
    keepId: restHas(["-KeepId", "--keep-id"]),
    noReid: restHas(["-NoReid", "--no-reid"]),
    noProbe: restHas(["-NoProbe", "--no-probe"]),
    noStart: restHas(["-NoStart", "--no-start"]),
    keepRoute: restHas(["-KeepRoute", "--keep-route"]),
  });
  writeStep("");
  if (!ok) {
    writeBad("setup stopped early, see the notes above");
    return;
  }
  const trace = getEgressTrace(cfg.proxy, {});
  let ipText = trace.ip ? trace.ip : "unknown";
  if (trace.country) ipText = ipText + "  " + trace.country;
  const watcherText = restHas(["-NoStart", "--no-start"]) ? "watcher off" : "watcher on";
  writeOk("ready. egress " + ipText + ", " + watcherText + ", autostart " + (cfg.autoStart ? "installed" : "off"));
  writeInfo("state: opencode-unlimited status");
  writeInfo("stop : opencode-unlimited off");
}

function cmdOff() {
  const cfg = getConfig();
  writeStep("==> opencode-unlimited off");
  stopWatcherDaemon();
  removeAutoStart();
  stopBridge();
  cfg.autoMode = false;
  cfg.autoStart = false;
  cfg.proxy = "";
  cfg.ipMode = "manual";
  saveConfig(cfg);
  setPluginEnabled(false);
  applyProxy(cfg, {});
  restartService();
  writeStep("");
  writeOk("watcher stopped, autostart gone, egress direct again");
  writeInfo("sessions, messages and the identity file were not touched");
}

function showProxyPool(cfg) {
  const pool = getProxyPool(cfg);
  const cache = readJson(poolCacheFile);
  if (!pool.length) {
    writeInfo("pool: empty");
    writeInfo("opencode-unlimited proxy pool add socks5://host:port");
    writeInfo("opencode-unlimited proxy pool fetch https://example.com/list.txt");
    return;
  }
  const active = Number(cfg.proxyIndex || 0);
  writeInfo("pool: " + pool.length + " entries, active #" + (active + 1));
  const shown = Math.min(pool.length, 20);
  for (let i = 0; i < shown; i++) {
    const mark = i === active ? "->" : "  ";
    writeInfo("  " + mark + " " + (i + 1) + ". " + pool[i]);
  }
  if (pool.length > shown) writeInfo("  .. " + (pool.length - shown) + " more, use: proxy stats");
  if (cache && cache.proxies) writeInfo("list cache: " + asArray(cache.proxies).length + " from " + cache.source);
  if (cfg.proxyListUrl) writeInfo("list url  : " + cfg.proxyListUrl);
}

function showProxyStats(cfg) {
  const report = getProxyHealthReport(cfg);
  if (!report) {
    writeInfo("pool: empty");
    writeInfo("opencode-unlimited proxy pool fetch");
    return;
  }
  writeInfo("pool    : " + report.total + " entries, " + report.usable + " usable, " + report.held + " parked");
  let index = 0;
  for (const row of asArray(report.detail).slice(0, 40)) {
    index++;
    let state;
    if (row.quarantined) state = "park";
    else if (Number(row.ms) > slowProxyMs) state = "slow";
    else if (Number(row.ms) > 0) state = "ok  ";
    else state = "new ";
    const msText = Number(row.ms) > 0 ? pdl(row.ms, 5) + " ms" : "    ---";
    const failText = pdl(row.fail, 2);
    writeInfo("  " + pdl(index, 2) + ". " + state + " " + msText + "  fail=" + failText + "  " + row.url);
  }
}

function testProxyBatch(cfg, top) {
  const pool = getRankedProxyPool(cfg);
  if (!pool.length) {
    writeBad("pool is empty, run: opencode-unlimited proxy pool fetch");
    return;
  }
  const want = top > 0 ? top : 20;
  const limit = Math.min(pool.length, want);
  writeInfo("probing " + limit + " of " + pool.length + " proxies, 6s each");
  let usable = 0;
  for (let i = 0; i < limit; i++) {
    const url = pool[i];
    const trace = getEgressTrace(url, { force: true, timeoutSec: 6, noFallback: true });
    const ms = Number(trace.ms) || 0;
    if (trace.ip) {
      setProxyHealth(url, true, ms, "");
      const mark = ms > slowProxyMs ? "slow" : "ok  ";
      if (ms <= slowProxyMs) usable++;
      writeInfo("  " + mark + " " + pdl(ms, 5) + " ms  " + pdf(trace.ip, 15) + " " + pdf(trace.country, 2) + "  " + url);
    } else {
      setProxyHealth(url, false, 0, "timeout");
      writeInfo("  dead     ---  " + url);
    }
  }
  writeStep("");
  if (usable > 0) writeOk(usable + " usable of " + limit + " probed");
  else writeBad("0 usable of " + limit + " probed");
}

function cmdProxy() {
  const cfg = getConfig();
  const sub = REST.length >= 1 ? String(REST[0]) : "status";
  switch (sub) {
    case "off": {
      stopBridge();
      cfg.proxy = "";
      cfg.ipMode = "manual";
      saveConfig(cfg);
      applyProxy(cfg, {});
      restartService();
      writeInfo("egress is direct again");
      return;
    }
    case "next": {
      const trace = invokeEgressRotation(cfg, "", "", "", {});
      saveConfig(cfg);
      if (trace) writeOk("egress: " + trace.ip + " " + trace.country);
      else writeWarn("no new route, see the notes above");
      return;
    }
    case "pool": {
      const action = REST.length >= 2 ? String(REST[1]) : "show";
      if (action === "add") {
        const urls = REST.slice(2);
        if (!urls.length) {
          writeBad("expected one or more proxy urls");
          return;
        }
        let pool = getProxyPool(cfg);
        let added = 0;
        for (const url of urls) {
          if (!/^(socks5h?|http|https):\/\//.test(url)) {
            writeBad("skipped, not a proxy url: " + url);
            continue;
          }
          if (pool.includes(url)) {
            writeInfo("already in the pool: " + url);
            continue;
          }
          pool.push(url);
          added++;
        }
        cfg.proxyPool = pool;
        saveConfig(cfg);
        writeOk("pool size: " + pool.length + " (+" + added + ")");
        showProxyPool(cfg);
        return;
      }
      if (action === "set") {
        const urls = REST.slice(2).filter((url) => /^(socks5h?|http|https):\/\//.test(url));
        if (!urls.length) {
          writeBad("expected one or more proxy urls");
          return;
        }
        cfg.proxyPool = urls;
        cfg.proxyIndex = 0;
        saveConfig(cfg);
        writeOk("pool replaced, " + urls.length + " entries");
        showProxyPool(cfg);
        return;
      }
      if (action === "clear") {
        cfg.proxyPool = [];
        cfg.proxyIndex = 0;
        cfg.proxyListUrl = "";
        try {
          if (fs.existsSync(poolCacheFile)) fs.unlinkSync(poolCacheFile);
        } catch {}
        saveConfig(cfg);
        writeOk("pool cleared, the current upstream was left alone");
        return;
      }
      if (action === "fetch") {
        const url = REST.length >= 3 ? String(REST[2]) : "";
        if (url && !/^https?:\/\//.test(url)) {
          writeBad("expected an http(s) list url");
          return;
        }
        cfg.proxyListUrl = url;
        saveConfig(cfg);
        const count = updateProxyList(cfg, { force: true });
        if (count > 0) writeOk("list cache: " + count + " proxies");
        showProxyPool(cfg);
        return;
      }
      if (action === "refresh") {
        if (!cfg.proxyListUrl) {
          writeBad("no list url yet, run: proxy pool fetch <url>");
          return;
        }
        const count = updateProxyList(cfg, { force: true });
        if (count > 0) writeOk("list cache refreshed: " + count);
        showProxyPool(cfg);
        return;
      }
      showProxyPool(cfg);
      return;
    }
    case "status": {
      const trace = getEgressTrace(cfg.proxy, {});
      let ipText = trace.ip ? trace.ip : "unknown";
      if (trace.country) ipText = ipText + "  " + trace.country;
      writeInfo("upstream : " + (cfg.proxy ? cfg.proxy : "none (manual)"));
      writeInfo("bridge   : 127.0.0.1:" + cfg.bridgePort);
      writeInfo("ip       : " + ipText);
      showProxyPool(cfg);
      return;
    }
    case "stats": {
      showProxyStats(cfg);
      return;
    }
    case "test": {
      testProxyBatch(cfg, getRestInt(["-Top", "--top", "-n"], 20));
      return;
    }
    case "healthreset": {
      invokeProxyHealth("reset", []);
      writeOk("proxy health cleared, every entry is a clean slate again");
      return;
    }
    default: {
      const url = sub === "set" && REST.length >= 2 ? String(REST[1]) : String(REST[0]);
      if (!/^(socks5h?|http|https):\/\//.test(url)) {
        writeBad("expected socks5://host:port or http://host:port");
        return;
      }
      cfg.proxy = url;
      cfg.ipMode = "proxy";
      if (!applyProxy(cfg, {})) {
        cfg.proxy = "";
        cfg.ipMode = "manual";
        saveConfig(cfg);
        writeInfo("state left on manual, nothing was restarted");
        return;
      }
      saveConfig(cfg);
      restartService();
      sleepSync(1000);
      const trace = getEgressTrace(cfg.proxy, { force: true });
      let ipText = trace.ip ? trace.ip : "unknown";
      if (trace.country) ipText = ipText + "  " + trace.country;
      writeInfo("egress via proxy: " + ipText);
      return;
    }
  }
}

function cmdPlugin() {
  const sub = REST.length >= 1 ? String(REST[0]) : "status";
  switch (sub.toLowerCase()) {
    case "install": {
      writeStep("==> installing the shield plugin");
      if (installPlugin()) {
        setPluginEnabled(true);
        writeInfo("opencode reloads config on save, the plugin appears at the next request");
        writeInfo("check it with: opencode-unlimited plugin status");
      }
      return;
    }
    case "off": {
      setPluginEnabled(false);
      try {
        if (fs.existsSync(pluginMarker)) fs.unlinkSync(pluginMarker);
      } catch {}
      writeOk("plugin unlisted from opencode config and parked on disk");
      return;
    }
    case "verify": {
      restartService();
      sleepSync(1500);
      const live = testPluginLive();
      if (live) writeOk("loaded, hooks " + asArray(live.hooks).join(", "));
      else writeWarn("not reported by the server yet, open the app once and check again");
      return;
    }
    default: {
      writeStep("==> shield plugin");
      writeInfo("state  : " + getPluginState());
      writeInfo("path   : " + pluginFile);
      writeInfo("config : " + (testPluginRegistered() ? pluginEntry + " listed" : "not listed"));
      const live = testPluginLive();
      if (live) {
        writeOk("live   : opencode " + live.version + ", hooks " + asArray(live.hooks).join(", "));
        writeInfo("it stamps the virtual project id and session affinity on every model request");
      } else {
        writeInfo("live   : not reported yet");
      }
      return;
    }
  }
}

function cmdWarp() {
  const warp = getWarpCli();
  if (!warp) {
    writeBad("warp-cli not found, install Cloudflare WARP or use: proxy set socks5://host:port");
    return;
  }
  const cfg = getConfig();
  const sub = REST.length >= 1 ? String(REST[0]) : "status";
  switch (sub) {
    case "on": {
      spawnSync(warp, ["mode", "proxy"], { stdio: "ignore" });
      spawnSync(warp, ["proxy", "port", "40000"], { stdio: "ignore" });
      spawnSync(warp, ["connect"], { stdio: "ignore" });
      cfg.proxy = "socks5://127.0.0.1:40000";
      cfg.ipMode = "warp";
      saveConfig(cfg);
      applyProxy(cfg, {});
      restartService();
      writeOk("warp proxy mode on, opencode routed through the bridge");
      return;
    }
    case "off": {
      spawnSync(warp, ["disconnect"], { stdio: "ignore" });
      stopBridge();
      cfg.proxy = "";
      cfg.ipMode = "manual";
      saveConfig(cfg);
      applyProxy(cfg, {});
      restartService();
      writeOk("warp off, direct egress");
      return;
    }
    case "rotate": {
      writeInfo("reconnecting warp, this can change the egress ip");
      const before = getEgressTrace(cfg.proxy, { force: true });
      const after = invokeWarpRotate(cfg);
      if (!testRouteOk(after, "warp")) {
        writeBad("warp is not carrying the route (warp=" + (after ? after.warp : "") + ")");
        writeInfo("check: warp-cli status");
        return;
      }
      if (before.ip && testSameBlock(after.ip, before.ip)) {
        writeWarn("same egress block: " + after.ip + " " + after.country);
        writeInfo("warp does not guarantee a new ip, reconnect again or use a proxy pool");
      } else {
        writeOk("new egress block: " + before.ip + " -> " + after.ip + " " + after.country);
      }
      return;
    }
    default: {
      const result = spawnSync(warp, ["status"], { encoding: "utf8" });
      const text = String((result && result.stdout) || "") + String((result && result.stderr) || "");
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) writeInfo(line);
      }
      return;
    }
  }
}

function cmdRun() {
  if (REST.length === 0) {
    writeBad("usage: opencode-unlimited run <opencode args>");
    return 0;
  }
  const oc = resolveOpenCode();
  let attempt = 1;
  while (attempt <= 3) {
    const result = spawnSync(oc, REST, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const out = String(result.stdout || "") + String(result.stderr || "");
    const code = result.status === null ? 1 : result.status;
    if (testLimitOutput(out)) {
      writeWarn("free limit hit (attempt " + attempt + "/3)");
      addEgressRecord(429, 0, "");
      const idHelper = path.join(root, "lib", "identity.js");
      if (pathExists(idHelper)) invokeNodeHelper(idHelper, ["rotate"]);
      const cfg = getConfig();
      if (cfg.proxy) {
        applyProxy(cfg, {});
        restartService();
      }
      sleepSync(2000);
      attempt++;
      continue;
    }
    console.log(out);
    return code;
  }
  writeBad("still limited after 3 attempts");
  writeInfo("the meter follows the egress block, change the connection and run: opencode-unlimited usage");
  return 1;
}

function cmdDoctor() {
  writeStep("==> opencode-unlimited doctor");
  writeStep("");
  writeInfo("os         : " + os.platform() + " " + os.release());
  writeInfo("node       : " + String(process.version || ""));
  if (testNodeSqlite()) writeOk("sqlite     : node:sqlite available");
  else writeWarn("sqlite     : needs node 22.5+ for -Db features");
  if (getCurl()) writeOk("curl       : found");
  else writeWarn("curl       : missing, using fetch fallback");
  writeInfo("tool       : " + process.execPath);
  const stale = getStaleInstalls();
  if (stale.length) {
    writeWarn("stale copy : " + stale.join(", "));
    writeInfo("this is why an old version can answer instead of this one");
    writeInfo("fix: remove the old path entry");
  } else {
    writeOk("stale copy : none");
  }
  const ocInfo = getOpenCodeInfo();
  writeInfo("opencode   : " + ocInfo.exe);
  if (ocInfo.version) {
    writeOk("version    : v" + ocInfo.version + (ocInfo.api ? " (api v" + ocInfo.api + ")" : ""));
  } else {
    writeWarn("version    : not detected, is opencode on PATH?");
  }
  if (ocInfo.running) writeOk("service    : running");
  else writeWarn("service    : not reachable, start opencode once");
  writeInfo("gateway    : " + ocInfo.gateway);
  writeInfo("database   : " + (ocInfo.dbPath ? ocInfo.dbPath : "not found"));
  writeInfo("session t. : " + (ocInfo.sessionTable ? ocInfo.sessionTable : "unknown"));
  let pluginApi = "";
  if (ocInfo.exe && ocInfo.exe !== "opencode") {
    const result = spawnSync(ocInfo.exe, ["api", "get", "/api/plugin"], { encoding: "utf8" });
    pluginApi = String((result && result.stdout) || "");
  }
  if (/"id"\s*:\s*"unlimited-shield"/.test(pluginApi)) {
    if (/"id"\s*:\s*"unlimited-shield".{0,200}?"status"\s*:\s*"active"/.test(pluginApi)) writeOk("plugin     : loaded and active");
    else writeWarn("plugin     : loaded but not active");
  } else {
    writeWarn("plugin     : not loaded (optional, it does not change the quota)");
  }
  const vid = getVirtualIdentity();
  if (vid && vid.exists) writeOk("identity   : " + vid.deviceId);
  else writeWarn("identity   : missing, run: opencode-unlimited identity rotate");
  const cfg = getConfig();
  writeInfo("upstream   : " + (cfg.proxy ? cfg.proxy : "none (manual)"));
  const trace = getEgressTrace(cfg.proxy, {});
  writeInfo("egress ip  : " + (trace.ip ? trace.ip + (trace.country ? "  " + trace.country : "") : "unknown"));
  const logHelper = path.join(root, "lib", "log-watch.js");
  if (pathExists(logHelper)) {
    const raw = invokeNodeHelper(logHelper, ["path"]);
    let logInfo = null;
    try {
      logInfo = JSON.parse(raw);
    } catch {
      logInfo = null;
    }
    if (logInfo && logInfo.file) writeInfo("log        : " + logInfo.file);
    else writeWarn("log        : not found yet");
  } else {
    writeWarn("log helper : missing");
  }
  if (pathExists(authDir)) {
    if (pathExists(authSnapshot)) writeOk("token      : live, snapshot present");
    else writeInfo("token      : live, no snapshot (opencode-unlimited token save)");
  } else {
    writeWarn("token      : auth.json missing");
  }
}

function cmdUninstall() {
  writeStep("==> uninstalling opencode-unlimited");
  stopBridge();
  setPluginEnabled(false);
  try {
    if (fs.existsSync(pluginFile)) fs.unlinkSync(pluginFile);
  } catch {}
  try {
    if (fs.existsSync(pluginFile + ".off")) fs.unlinkSync(pluginFile + ".off");
  } catch {}
  try {
    if (fs.existsSync(pluginFolder)) fs.rmSync(pluginFolder, { recursive: true, force: true });
  } catch {}
  try {
    if (fs.existsSync(pluginMarker)) fs.unlinkSync(pluginMarker);
  } catch {}
  writeOk("plugin removed");

  const cfgPath = getGlobalConfigPath();
  if (pathExists(cfgPath)) {
    try {
      const raw = fs.readFileSync(cfgPath, { encoding: "utf8" }).replace(/^\uFEFF/, "");
      const cfg = JSON.parse(raw);
      if (cfg.commands && typeof cfg.commands === "object") {
        for (const name of Object.keys(cfg.commands)) {
          if (name.startsWith("opencode-unlimited")) delete cfg.commands[name];
        }
        writeTextFile(cfgPath, JSON.stringify(cfg, null, 2));
        writeOk("slash commands removed");
      }
    } catch {
      writeWarn("config not touched, edit it by hand: " + cfgPath);
    }
  }

  setServiceEnv("HTTPS_PROXY", "");
  setServiceEnv("HTTP_PROXY", "");
  setServiceEnv("ALL_PROXY", "");
  writeOk("service proxy cleared");
  for (const target of [stateFile, infoFile, pidFile, logFile]) {
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch {}
  }
  writeOk("state files removed");
  writeInfo("repo and PATH entry kept, delete manually if you want: " + root);
}

function cmdVersion() {
  const info = getOpenCodeInfo();
  writeStep("opencode-unlimited " + toolVersion);
  writeInfo("opencode   : " + (info.version ? "v" + info.version : "not detected"));
  writeInfo("api        : " + (info.api ? "v" + info.api : "unknown"));
  writeInfo("session t. : " + (info.sessionTable ? info.sessionTable : "unknown"));
  writeInfo("gateway    : " + info.gateway);
}

function cmdHelp() {
  writeStep("opencode-unlimited <command>");
  writeStep("");
  writeInfo("reset [path]         new device id, new session ids, clear errors");
  writeInfo("reset [path] -Dry    show what the session re-id would touch");
  writeInfo("identity [rotate]    show or rotate the virtual device identity");
  writeInfo("identity restore     drop the virtual identity, registry never touched");
  writeInfo("block                egress blocks seen today, and which are spent");
  writeInfo("block check          is the address you are on now still usable");
  writeInfo("usage                free check of the meter and the reset clock");
  writeInfo("watch [-follow]      read the opencode log, zero messages spent");
  writeInfo("watch -follow -auto  rotate the moment a limit line lands");
  writeInfo("hunt                 rotate until the probe says the route is open");
  writeInfo("hunt -Country XX -Prefix a.b.c.   steer the search");
  writeInfo("hunt -NoProbe        rotate without spending a probe message");
  writeInfo("token [save|restore] keep a local copy of auth.json");
  writeInfo("sessions [path]      list sessions and their ids for a folder");
  writeInfo("model                list providers and free models you can switch to");
  writeInfo("model <spec>         switch this folder to provider/model[#variant]");
  writeInfo("model <path> <spec>  switch a session id or a whole folder");
  writeInfo("reid <id|path>       mint fresh session ids, keep every message");
  writeInfo("clear [path]         strip stored free-limit errors");
  writeInfo("verify [-fix]        check sessions decode, no dangling state");
  writeInfo("");
  writeInfo("install              register PATH, install the slash command");
  writeInfo("status               runtime, identity, network, bucket");
  writeInfo("doctor               check node, service, schema, identity");
  writeInfo("version              tool version plus the detected opencode version");
  writeInfo("on | off             full auto: identity, pool, route, watcher, autostart");
  writeInfo("on -KeepId -NoProbe  keep the identity, skip the probe message");
  writeInfo("proxy set <url>      route opencode through socks5:// or http://");
  writeInfo("proxy off            drop the upstream, direct egress");
  writeInfo("proxy status         show the current upstream and the pool");
  writeInfo("proxy stats          per-proxy health, speed and quarantine");
  writeInfo("proxy test [-Top 20] probe the pool and park the dead ones");
  writeInfo("proxy pool add <url> queue proxies for reset to cycle through");
  writeInfo("proxy pool fetch [u] pull a free proxy list into the pool");
  writeInfo("proxy pool refresh   refetch the list now");
  writeInfo("proxy pool clear     empty the pool, upstream left as is");
  writeInfo("proxy next           jump to the next pooled proxy now");
  writeInfo("plugin               is the shield loaded, and where it lives");
  writeInfo("plugin install|off   list or unlist the shield in the opencode config");
  writeInfo("warp on|off|rotate   Cloudflare WARP path (optional)");
  writeInfo("run <args...>        run opencode, rotate on free-limit");
  writeInfo("uninstall            remove plugin, slash commands, state");
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.length >= 1 && argv[0] ? argv[0] : "help";
  REST = argv.slice(1);
  try {
    switch (String(command).toLowerCase()) {
      case "install":
        cmdInstall();
        return 0;
      case "reset":
        cmdReset();
        return 0;
      case "clear":
        cmdClear();
        return 0;
      case "verify":
        cmdVerify(false);
        return 0;
      case "identity":
        cmdIdentity();
        return 0;
      case "block":
        cmdBlock();
        return 0;
      case "usage":
        cmdUsage();
        return 0;
      case "watch":
        await cmdWatch();
        return 0;
      case "hunt":
        cmdHunt();
        return 0;
      case "token":
        cmdToken();
        return 0;
      case "status":
        cmdStatus();
        return 0;
      case "sessions":
        cmdSessions();
        return 0;
      case "model":
        cmdModel();
        return 0;
      case "reid":
        cmdReid();
        return 0;
      case "version":
      case "-v":
      case "--version":
        cmdVersion();
        return 0;
      case "on":
        cmdOn();
        return 0;
      case "off":
        cmdOff();
        return 0;
      case "proxy":
        cmdProxy();
        return 0;
      case "plugin":
        cmdPlugin();
        return 0;
      case "warp":
        cmdWarp();
        return 0;
      case "run":
        return cmdRun();
      case "doctor":
        cmdDoctor();
        return 0;
      case "uninstall":
        cmdUninstall();
        return 0;
      default:
        cmdHelp();
        return 0;
    }
  } catch (error) {
    writeBad(String(error && error.stack ? error.stack : error));
    return 1;
  }
}

main().then((code) => {
  process.exitCode = typeof code === "number" ? code : 0;
});
