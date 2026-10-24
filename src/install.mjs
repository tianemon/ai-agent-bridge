/**
 * 把 MCP 注册写进"本机确实装了"的那几个宿主。
 *
 * 不做的事：
 *   - 不假设用户装了哪些客户端（只处理探测到的，其余一律跳过并说明）
 *   - 不预装、不全局安装（npx 直接跑也行）
 *
 * 做的事：幂等（内容相同就跳过）、先备份、可 --dry-run。
 * 所有可见文案走 i18n（默认英文，AAB_LANG=zh 切中文）。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { HOSTS, detectHosts, registered, approvalState, recordEntry, NAME, LEGACY } from "./hosts.mjs";
import { t as tr } from "./i18n.mjs";

const TOML_HEADER = `[mcp_servers.${NAME}]`;

/** 尽量别把 MCP 命令钉在"某个工具自带的 node"上：那套运行时可能被换掉或升级掉 */
const MANAGED_NODE = /[\\/]\.workbuddy[\\/]|[\\/]_npx[\\/]|[\\/]node_modules[\\/]/;
const FALLBACK_NODES = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];

/** 这份代码是从哪儿跑的：决定配置里写什么，也决定"这是开发态还是正式安装" */
export function runtimeMode(script) {
  // 只返回语义 key；显示文案交给 i18n，逻辑不依赖任何一国的字符串
  if (/[\\/]_npx[\\/]/.test(script)) return { kind: "npx", dev: false };
  if (/[\\/]node_modules[\\/]/.test(script)) return { kind: "installed", dev: false };
  return { kind: "dev", dev: true };
}

export function resolveNode() {
  if (!MANAGED_NODE.test(process.execPath)) return process.execPath;
  for (const c of FALLBACK_NODES) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      /* 试下一个 */
    }
  }
  return process.execPath;
}

const PKG = "@tianemon/ai-agent-bridge";

/**
 * 配置里写什么命令，取决于"现在这份代码在哪里被运行"：
 *   npm i -g / 本地 checkout  → 写那份代码的绝对路径（稳定，改代码即生效）
 *   npx 缓存（~/.npm/_npx/…）  → 缓存会被清掉，绝不能钉在里面，改用 npx 解析
 */
function commandFor() {
  const script = fs.realpathSync(new URL("../bin/aab.mjs", import.meta.url).pathname);
  if (/[\\/]_npx[\\/]/.test(script)) {
    return { command: "npx", args: ["-y", PKG, "mcp"], note: tr("install.note.npx") };
  }
  return { command: resolveNode(), args: [script, "mcp"], note: "" };
}

/** 从 TOML 里摘掉一个段落：标题行到下一个顶层表头之前。
 *  循环删到没有为止——同一段落可能因为历史写入残留多份（实测出现过重复）。 */
export function dropTomlSection(text, header) {
  let out = text;
  for (;;) {
    const lines = out.split("\n");
    const start = lines.findIndex((l) => l.trim() === header);
    if (start < 0) return out;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\[/.test(lines[i])) {
        end = i;
        break;
      }
    }
    out = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  }
}

function backup(file) {
  if (!fs.existsSync(file)) return "";
  const dst = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  fs.copyFileSync(file, dst);
  return dst;
}

/* ── WorkBuddy：JSON merge ── */
function applyWorkbuddy({ dryRun }) {
  const file = HOSTS.workbuddy.config;
  const { command, args } = commandFor();
  const entry = { command, args, timeout: 20000, disabled: false };

  let cfg;
  try {
    cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { mcpServers: {} };
  } catch (e) {
    return { ok: false, msg: tr("install.m.notJson", { file, err: e.message }) };
  }
  cfg.mcpServers = cfg.mcpServers || {};
  const dropped = LEGACY.filter((k) => cfg.mcpServers[k]);
  for (const k of dropped) delete cfg.mcpServers[k];
  if (!dropped.length && JSON.stringify(cfg.mcpServers[NAME]) === JSON.stringify(entry)) {
    recordEntry("workbuddy", entry); // 即使跳过写入也要记时间，doctor 才判断得出信任是否早于配置
    return { ok: true, msg: tr("install.m.current", { file }) };
  }
  cfg.mcpServers[NAME] = entry;
  if (dryRun) return { ok: true, msg: tr("install.m.plan", { file, replaced: "" }) };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bak = backup(file);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  recordEntry("workbuddy", entry);
  return {
    ok: true,
    msg: tr("install.m.done", {
      file,
      bak: bak ? tr("install.m.bak", { name: path.basename(bak) }) : "",
      legacy: dropped.length ? tr("install.m.legacy", { names: dropped.join(", ") }) : "",
      replaced: "",
    }),
  };
}

/* ── Codex：TOML 段落 upsert ── */
function applyCodex({ dryRun }) {
  const file = HOSTS.codex.config;
  const { command, args } = commandFor();
  const block = [
    TOML_HEADER,
    `command = ${JSON.stringify(command)}`,
    `args = [${args.map((a) => JSON.stringify(a)).join(", ")}]`,
    "startup_timeout_sec = 20",
  ].join("\n");

  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: false, msg: tr("install.m.codexMissing", { file }) };
  }
  const stale = text.includes(block) ? !LEGACY.some((k) => text.includes(`[mcp_servers.${k.replace(/-/g, "_")}]`)) : false;
  if (stale) return { ok: true, msg: tr("install.m.current", { file }) };

  // 先把同名/旧名段落都摘掉，再统一追加
  let cleaned = text;
  let removed = false;
  for (const h of [TOML_HEADER, ...LEGACY.map((k) => `[mcp_servers.${k.replace(/-/g, "_")}]`)]) {
    const before = cleaned;
    cleaned = dropTomlSection(cleaned, h);
    if (cleaned !== before) removed = true;
  }
  // 注意：这里必须基于 cleaned（已摘掉同名/旧名段落），
  // 早前写成 next = text 导致每跑一次就多追加一段（实测出现过三段重复）
  const next = cleaned;
  if (dryRun) {
    return { ok: true, msg: tr("install.m.plan", { file, replaced: removed ? tr("install.m.replaced") : "" }) };
  }

  const bak = backup(file);
  fs.writeFileSync(file, `${next.trimEnd()}\n\n${block}\n`);
  return {
    ok: true,
    msg: tr("install.m.done", {
      file,
      bak: bak ? tr("install.m.bak", { name: path.basename(bak) }) : "",
      legacy: "",
      replaced: removed ? tr("install.m.replacedAfter") : "",
    }),
  };
}

/* ── Claude Code：走官方 CLI，别手改它的配置 ── */
function applyClaude({ dryRun }) {
  const reg = registered("claude");
  if (reg === null) return { ok: false, msg: tr("install.m.claudeNoCli") };

  // 旧名条目指向已删除的脚本，表现为"连接失败"，留着既占位又误导 → 先摘掉
  const removedLegacy = [];
  if (!dryRun) {
    for (const n of LEGACY) {
      try {
        execFileSync("claude", ["mcp", "remove", n, "--scope", "user"], {
          encoding: "utf8",
          timeout: 15000,
          stdio: ["ignore", "pipe", "ignore"],
        });
        removedLegacy.push(n);
      } catch {
        /* 不存在就算了 */
      }
    }
  }
  const legacyNote = removedLegacy.length ? tr("install.m.legacy", { names: removedLegacy.join(", ") }) : "";

  if (reg) {
    return {
      ok: true,
      msg: legacyNote ? tr("install.m.claudeDone") + legacyNote : tr("install.m.claudeCurrent"),
    };
  }
  if (dryRun) return { ok: true, msg: tr("install.m.claudePlan", { name: NAME }) };

  const { command, args } = commandFor();
  try {
    execFileSync("claude", ["mcp", "add", "--scope", "user", NAME, command, ...args], {
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, msg: tr("install.m.claudeDone") + legacyNote };
  } catch (e) {
    return { ok: false, msg: tr("install.m.claudeFail", { err: String(e.stderr || e.message).split("\n")[0] }) };
  }
}

const APPLY = { workbuddy: applyWorkbuddy, codex: applyCodex, claude: applyClaude };

/**
 * @param {object} o
 * @param {string[]} [o.targets] 显式指定宿主；不给就自动探测
 * @param {boolean} o.dryRun
 */
export function install({ targets, dryRun = false } = {}) {
  const detected = detectHosts();
  const unknown = (targets || []).filter((t) => !HOSTS[t]);
  const chosen = targets?.length ? targets.filter((t) => HOSTS[t]) : detected;
  const skipped = Object.keys(HOSTS).filter((h) => !chosen.includes(h));

  const { command, args, note } = commandFor();
  const out = [
    tr("install.title", { dry: dryRun ? tr("install.dry") : "" }),
    tr("install.mcpCmd", { cmd: `${command} ${args.join(" ")}${note}` }),
    tr("install.detected", {
      list: detected.length
        ? detected.map((h) => HOSTS[h].label).join(tr("list.sep"))
        : tr("install.noneDetected"),
    }),
    "",
  ];

  for (const h of chosen) {
    const r = APPLY[h]({ dryRun });
    out.push(`  ${HOSTS[h].label.padEnd(12)} ${r.ok ? "✓" : "✗"} ${r.msg}`);
  }
  for (const h of skipped) {
    const why = detected.includes(h) ? tr("install.skip.chosen") : tr("install.skip.installed");
    out.push(tr("install.skipRow", { label: HOSTS[h].label.padEnd(12), why }));
  }
  if (unknown.length) out.push(tr("install.unknown", { list: unknown.join(tr("list.sep")) }));

  out.push("");
  if (!chosen.length) {
    out.push(tr("install.noTargets"));
    return out.join("\n");
  }

  // WorkBuddy 有一道人工闸，宿主自己不会弹提示，只能靠我们把它说清楚
  const wb = chosen.includes("workbuddy") ? approvalState("workbuddy") : null;
  if (wb && !wb.approved) {
    out.push(tr("install.wbWarn"));
    out.push(tr("install.wbPath"));
    out.push(tr("install.wbWhy"));
  }
  const rm = runtimeMode(fs.realpathSync(new URL("../bin/aab.mjs", import.meta.url).pathname));
  if (rm.dev) {
    out.push(tr("install.devHint"));
    out.push(tr("install.devHint2"));
  }
  out.push(tr("install.next"));
  return out.join("\n");
}
