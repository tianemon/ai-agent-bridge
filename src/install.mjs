/**
 * 把 MCP 注册写进"本机确实装了"的那几个宿主。
 *
 * 不做的事：
 *   - 不假设用户装了哪些客户端（只处理探测到的，其余一律跳过并说明）
 *   - 不预装、不全局安装（npx 直接跑也行）
 *
 * 做的事：幂等（内容相同就跳过）、先备份、可 --dry-run。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { HOSTS, detectHosts, registered, NAME, LEGACY } from "./hosts.mjs";

const TOML_HEADER = "[mcp_servers.pickup]";

/** 尽量别把 MCP 命令钉在"某个工具自带的 node"上：那套运行时可能被换掉或升级掉 */
const MANAGED_NODE = /[\\/]\.workbuddy[\\/]|[\\/]_npx[\\/]|[\\/]node_modules[\\/]/;
const FALLBACK_NODES = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];

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

/** MCP 命令一律写绝对路径：不依赖 PATH，也不依赖这个包有没有发到 npm */
function commandFor() {
  const script = fs.realpathSync(new URL("../bin/pickup.mjs", import.meta.url).pathname);
  return { command: resolveNode(), args: [script, "mcp"] };
}

/** 从 TOML 里摘掉一个段落：标题行到下一个顶层表头之前 */
function dropTomlSection(text, header) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === header);
  if (start < 0) return text;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
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
    return { ok: false, msg: `${file} 不是合法 JSON（${e.message}），未改动` };
  }
  cfg.mcpServers = cfg.mcpServers || {};
  const dropped = LEGACY.filter((k) => cfg.mcpServers[k]);
  for (const k of dropped) delete cfg.mcpServers[k];
  if (!dropped.length && JSON.stringify(cfg.mcpServers[NAME]) === JSON.stringify(entry)) {
    return { ok: true, msg: `已是当前配置，跳过（${file}）` };
  }
  cfg.mcpServers[NAME] = entry;
  if (dryRun) return { ok: true, msg: `将写入 ${file}` };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bak = backup(file);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  return {
    ok: true,
    msg: `已写入 ${file}${bak ? `（备份 ${path.basename(bak)}）` : ""}${dropped.length ? `，并移除旧名 ${dropped.join(", ")}` : ""}`,
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
    return { ok: false, msg: `${file} 不存在（Codex 未安装？），跳过` };
  }
  const stale = text.includes(block) ? !LEGACY.some((k) => text.includes(`[mcp_servers.${k.replace(/-/g, "_")}]`)) : false;
  if (stale) return { ok: true, msg: `已是当前配置，跳过（${file}）` };

  // 先把同名/旧名段落都摘掉，再统一追加
  let cleaned = text;
  let removed = false;
  for (const h of [TOML_HEADER, ...LEGACY.map((k) => `[mcp_servers.${k.replace(/-/g, "_")}]`)]) {
    const before = cleaned;
    cleaned = dropTomlSection(cleaned, h);
    if (cleaned !== before) removed = true;
  }
  const lines = cleaned.split("\n");
  const start = lines.findIndex((l) => l.trim() === TOML_HEADER);
  let next = text;
  if (start >= 0) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\[/.test(lines[i])) {
        end = i;
        break;
      }
    }
    next = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  }
  if (dryRun) return { ok: true, msg: `将写入 ${file}${removed ? "（替换原有段落）" : ""}` };

  const bak = backup(file);
  fs.writeFileSync(file, `${next.trimEnd()}\n\n${block}\n`);
  return {
    ok: true,
    msg: `已写入 ${file}${bak ? `（备份 ${path.basename(bak)}）` : ""}${removed ? "，替换了原有段落" : ""}`,
  };
}

/* ── Claude Code：走官方 CLI，别手改它的配置 ── */
function applyClaude({ dryRun }) {
  const reg = registered("claude");
  if (reg === null) return { ok: false, msg: "找不到 claude CLI，跳过" };
  if (reg) return { ok: true, msg: "已注册（如需改成别的寻址方式先 claude mcp remove）" };
  if (dryRun) return { ok: true, msg: "将执行 claude mcp add --scope user pickup …" };

  const { command, args } = commandFor();
  try {
    execFileSync("claude", ["mcp", "add", "--scope", "user", NAME, command, ...args], {
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, msg: "已注册（scope=user）" };
  } catch (e) {
    return { ok: false, msg: `注册失败：${String(e.stderr || e.message).split("\n")[0]}` };
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

  const { command, args } = commandFor();
  const out = [
    `pickup 安装${dryRun ? "（dry-run，不写任何文件）" : ""}`,
    `  MCP 命令  ${command} ${args.join(" ")}`,
    `  探测到    ${detected.length ? detected.map((h) => HOSTS[h].label).join("、") : "（没有已安装的宿主）"}`,
    "",
  ];

  for (const h of chosen) {
    const r = APPLY[h]({ dryRun });
    out.push(`  ${HOSTS[h].label.padEnd(12)} ${r.ok ? "✓" : "✗"} ${r.msg}`);
  }
  for (const h of skipped) {
    const why = detected.includes(h) ? "本次未指定" : "未检测到本机安装";
    out.push(`  ${HOSTS[h].label.padEnd(12)} – 跳过（${why}）`);
  }
  if (unknown.length) out.push(`  ${unknown.join(", ")}  未知宿主，未处理`);

  out.push("");
  out.push(
    chosen.length
      ? "下一步：新开一个会话（或重连连接器）后 MCP 才会加载；WorkBuddy 可能还要在连接器页点一次 Trust。"
      : "没有任何可写的目标。装了哪个客户端就在哪个里手动加一条 MCP：命令 `npx -y @tianemon/agent-session-bridge mcp`。"
  );
  return out.join("\n");
}
