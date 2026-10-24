/**
 * 诊断：为什么读不到某家的会话 / 为什么某个客户端里找不到我。
 * 只读，不改任何配置。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AGENTS, AGENT_LABEL, getAgent, indexAll } from "./registry.mjs";
import { HOSTS, detectHosts, registered, approvalState, trustStale, NAME } from "./hosts.mjs";
import { t as tr } from "./i18n.mjs";
import { resolveNode, runtimeMode } from "./install.mjs";

const existsDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const ago = (ms) => {
  if (!ms) return tr("ago.none");
  const h = Math.round((Date.now() - ms) / 3600000);
  if (h >= 24) return tr("ago.days", { n: Math.round(h / 24) });
  return h >= 1 ? tr("ago.hours", { n: h }) : tr("ago.now");
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
  const lines = [tr("doc.runtime")];
  lines.push(`  node    ${process.version}  ${process.execPath}`);
  const stable = resolveNode();
  if (stable !== process.execPath) lines.push(`          ${tr("doc.node.hint", { node: stable })}`);
  lines.push(`  script  ${script}`);
  const rm = runtimeMode(script);
  const modeLabel = tr({ dev: "doc.mode.dev", installed: "doc.mode.installed", npx: "doc.mode.npx" }[rm.kind]);
  lines.push(`  mode    ${modeLabel}`);
  const onPath = tryRun("which", ["aab"]);
  lines.push(`  PATH    ${onPath ? `aab → ${onPath}` : tr("doc.path.missing")}`);
  lines.push("");

  lines.push(tr("doc.sources"));
  for (const name of AGENTS) {
    let root = "";
    try {
      root = getAgent(name).root();
    } catch {
      /* 环境变量坏了也不该让诊断崩 */
    }
    if (!root || !existsDir(root)) {
      lines.push(`  ${AGENT_LABEL[name].padEnd(12)} ✗ ${tr("doc.missingDir")}  ${root || "(?)"}`);
      continue;
    }
    const rows = indexAll(name);
    const latest = rows.reduce((m, r) => Math.max(m, r.mtimeMs || 0), 0);
    lines.push(`  ${AGENT_LABEL[name].padEnd(12)} ✓ ${tr("doc.sessions", { n: rows.length, ago: ago(latest) })}`);
    lines.push(`               ${root}`);
  }
  lines.push("");

  lines.push(tr("doc.hosts"));
  const detected = detectHosts();
  for (const [name, host] of Object.entries(HOSTS)) {
    if (!detected.includes(name)) {
      lines.push(`  ${host.label.padEnd(12)} – ${tr("doc.st.untrusted")}`);
      continue;
    }
    const reg = registered(name);
    const bad = reg && staleEntry(name);
    let status;
    if (reg === null) status = "? " + tr("doc.st.unknown");
    else if (bad) status = "⚠ " + tr("doc.st.stale");
    else if (!reg) status = "✗ " + tr("doc.st.missing");
    else status = "✓ " + tr("doc.st.registered");

    // WorkBuddy 还有一道人工闸：写进配置之后要点一次信任，MCP 才会真的加载
    if (reg && name === "workbuddy") {
      const a = approvalState(name);
      if (!a.approved) {
        status += " · ✗ " + tr("doc.trust.missing");
      } else if (trustStale("workbuddy")) {
        status += " · " + tr("doc.trust.stale");
      } else {
        const d = a.ts ? new Date(a.ts) : null;
        const pad = (n) => String(n).padStart(2, "0");
        const when = d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
        status += ` · ✓ ${when ? tr("doc.st.trusted", { time: when }) : tr("doc.st.trusted", { time: "?" })}`;
      }
    }
    lines.push(`  ${host.label.padEnd(12)} ${status}`);
  }
  lines.push("");

  lines.push(tr("doc.scope"));
  lines.push(`  cwd     ${process.cwd()}`);
  lines.push("          " + tr("doc.scopeHint"));
  lines.push("");

  const missing = detected.filter((h) => registered(h) === false);
  if (missing.length) {
    lines.push(tr("doc.conclusion") + tr("doc.c.needInstall", { hosts: missing.map((h) => HOSTS[h].label).join(tr("list.sep")) }));
  } else if (!detected.length) {
    lines.push(tr("doc.conclusion") + tr("doc.c.none"));
  } else {
    const wbUntrusted = detected.includes("workbuddy") && registered("workbuddy") && !approvalState("workbuddy").approved;
    lines.push(tr("doc.conclusion") + tr(wbUntrusted ? "doc.c.untrusted" : "doc.c.ok"));
  }
  return lines.join("\n");
}
