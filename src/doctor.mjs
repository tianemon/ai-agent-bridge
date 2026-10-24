/**
 * 诊断：为什么读不到某家的会话 / 为什么某个客户端里找不到我。
 * 只读，不改任何配置。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AGENTS, AGENT_LABEL, getAgent, indexAll } from "./registry.mjs";
import { HOSTS, detectHosts, registered, approvalState, NAME } from "./hosts.mjs";
import { resolveNode, runtimeMode } from "./install.mjs";

const existsDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const ago = (ms) => {
  if (!ms) return "无";
  const h = Math.round((Date.now() - ms) / 3600000);
  if (h >= 24) return `${Math.round(h / 24)} 天前`;
  return h >= 1 ? `${h} 小时前` : "刚刚";
};

function tryRun(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** 已注册但脚本路径不存在 → 是坏配置（挪过目录/卸载过），不是"已就绪" */
function staleEntry(host) {
  const scriptOf = (entry) => (Array.isArray(entry?.args) ? entry.args.find((a) => /aab\.mjs$/.test(a)) : "");
  try {
    if (host === "workbuddy") {
      const cfg = JSON.parse(fs.readFileSync(HOSTS.workbuddy.config, "utf8"));
      const p = scriptOf(cfg?.mcpServers?.[NAME]);
      return p ? !fs.existsSync(p) : false;
    }
    if (host === "codex") {
      const text = fs.readFileSync(HOSTS.codex.config, "utf8");
      const i = text.indexOf(`[mcp_servers.${NAME}]`);
      if (i < 0) return false;
      const chunk = text.slice(i, i + 500);
      const m = chunk.match(/args\s*=\s*(\[[^\]]*\])/);
      if (!m) return false;
      const p = scriptOf({ args: JSON.parse(m[1]) });
      return p ? !fs.existsSync(p) : false;
    }
  } catch {
    return false;
  }
  return false;
}

export function doctor() {
  const script = fs.realpathSync(new URL("../bin/aab.mjs", import.meta.url).pathname);
  const lines = ["■ 运行时"];
  lines.push(`  node    ${process.version}  ${process.execPath}`);
  const stable = resolveNode();
  if (stable !== process.execPath) lines.push(`          （这是宿主自带的 node；写进配置时会改用 ${stable}）`);
  lines.push(`  script  ${script}`);
  const rm = runtimeMode(script);
  lines.push(`  mode    ${rm.mode}${rm.dev ? "（开发态：配置指向源码，正式使用应装 npm 版）" : "（正式安装）"}`);
  const onPath = tryRun("which", ["aab"]);
  lines.push(`  PATH    ${onPath ? `aab → ${onPath}` : "未装到 PATH（npx / 绝对路径调用不受影响）"}`);
  lines.push("");

  lines.push("■ 会话来源（能读谁的会话）");
  for (const name of AGENTS) {
    let root = "";
    try {
      root = getAgent(name).root();
    } catch {
      /* 环境变量坏了也不该让诊断崩 */
    }
    if (!root || !existsDir(root)) {
      lines.push(`  ${AGENT_LABEL[name].padEnd(12)} ✗ 目录不存在  ${root || "(未知)"}`);
      continue;
    }
    const rows = indexAll(name);
    const latest = rows.reduce((m, r) => Math.max(m, r.mtimeMs || 0), 0);
    lines.push(`  ${AGENT_LABEL[name].padEnd(12)} ✓ ${String(rows.length).padStart(3)} 个会话，最近 ${ago(latest)}`);
    lines.push(`               ${root}`);
  }
  lines.push("");

  lines.push("■ 宿主（哪个客户端挂了 MCP）");
  const detected = detectHosts();
  for (const [name, host] of Object.entries(HOSTS)) {
    if (!detected.includes(name)) {
      lines.push(`  ${host.label.padEnd(12)} – 未安装，不处理`);
      continue;
    }
    const reg = registered(name);
    const bad = reg && staleEntry(name);
    let status;
    if (reg === null) status = "? 无法检测";
    else if (bad) status = "⚠ 已注册但脚本路径不存在";
    else if (!reg) status = "✗ 未注册";
    else status = "✓ 已注册";

    // WorkBuddy 还有一道人工闸：写进配置之后要点一次信任，MCP 才会真的加载
    if (reg && name === "workbuddy") {
      const a = approvalState(name);
      if (!a.approved) {
        status += " · ✗ 未信任 → 连接器 → 自定义连接器 → aab → 信任";
      } else {
        const d = a.ts ? new Date(a.ts) : null;
        const pad = (n) => String(n).padStart(2, "0");
        status += ` · ✓ 已信任${d ? `（${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}）` : ""}`;
      }
    }
    lines.push(`  ${host.label.padEnd(12)} ${status}`);
  }
  lines.push("");

  lines.push("■ 当前作用域");
  lines.push(`  cwd     ${process.cwd()}`);
  lines.push("          （默认按 cwd 所在项目过滤；子目录会归到 git 根；不像项目目录时才全机）");
  lines.push("");

  const missing = detected.filter((h) => registered(h) === false);
  if (missing.length) {
    lines.push(`结论：${missing.map((h) => HOSTS[h].label).join("、")} 已安装但没注册 → 跑 aab install`);
  } else if (!detected.length) {
    lines.push("结论：没检测到任何支持 MCP 的客户端。哪个客户端要用，就在它的设置里加一条 MCP：npx -y @tianemon/ai-agent-bridge mcp");
  } else {
    const wbUntrusted = detected.includes("workbuddy") && registered("workbuddy") && !approvalState("workbuddy").approved;
    lines.push(
      wbUntrusted
        ? "结论：配置都写好了，但 WorkBuddy 还没点信任 → 连接器 → 自定义连接器 → aab → 信任（点完新开会话）"
        : "结论：已安装的客户端都已注册。改完配置需新开会话（WorkBuddy 可能还要点一次 Trust）。"
    );
  }
  return lines.join("\n");
}
