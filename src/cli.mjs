/**
 * CLI：一次性执行，打印结果就退出。
 *
 *   aab latest --agent codex --level 1
 *   aab latest --session 01a16729 --turns 40-41
 *   aab list --since 24h
 *   aab grep "关键词" --agent codex
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { AGENTS, AGENT_LABEL, isAgent, latestSession, recentSessions, findSession } from "./registry.mjs";
import { resolveInputs } from "./known.mjs";
import { loadSession } from "./session.mjs";
import { render } from "./ladder.mjs";
import { grepSessions } from "./grep.mjs";
import { install } from "./install.mjs";
import { doctor } from "./doctor.mjs";
import { prompt } from "./prompt.mjs";
import { rule } from "./rule.mjs";
import { VERSION } from "./version.mjs";
import { t as tr, isZh } from "./i18n.mjs";

/* ── 参数 ── */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

const asPath = (p) => (p && p !== "true" ? path.resolve(p) : "");

function repoRoot(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || dir;
  } catch {
    return dir;
  }
}

const PROJECT_MARKERS = [".git", "package.json", ".easymint", "AGENTS.md", "CLAUDE.md", "pyproject.toml", "Cargo.toml"];

function looksLikeProject(dir) {
  try {
    return PROJECT_MARKERS.some((n) => fs.existsSync(path.join(dir, n)));
  } catch {
    return false;
  }
}

const SELF_DIR = path.resolve(new URL("..", import.meta.url).pathname);
const HOME_DIR = path.resolve(os.homedir());

/** 没显式给 project 时：cwd 像个项目就用它（归到 git 根），否则不限定。
 *  home 与工具自身目录永远不算项目——home 下常有 ~/.easymint、~/.claude 这类配置目录，
 *  误判会把作用域锁死在 home，导致"什么都找不到"。 */
function defaultProject(raw) {
  const given = asPath(raw);
  if (given) return repoRoot(given);
  const cwd = path.resolve(process.cwd());
  if (cwd === SELF_DIR || cwd === HOME_DIR) return "";
  return looksLikeProject(cwd) ? repoRoot(cwd) : "";
}

/**
 * 作用域三档：
 *   auto      本项目优先，找不到退全机并注明
 *   project   只在本项目，找不到就报错（不回退）
 *   global    全机
 */
function resolveScope({ agent, project, scope }) {
  if (scope === "global" || !project) return { project: "", note: "" };
  if (latestSession({ agent, project })) return { project, note: "" };
  if (scope === "project") return { project, note: "", empty: true };
  const global = latestSession({ agent });
  return {
    project: "",
    note: global ? tr("cli.fallback", { agent: AGENT_LABEL[agent] || agent, cwd: global.cwd }) : "",
  };
}

/** 未知工具直接拒绝，绝不静默降级成 "全部" */
const agentGuard = (a) =>
  a && a !== "auto" && !isAgent(a) ? tr("cli.badAgent", { a, list: AGENTS.join(" | ") }) : "";

const warningsOf = (w) => (w.length ? tr("cli.ignored", { list: w.join(tr("warn.sep")) }) + "\n\n" : "");

/* ── 动作 ── */
export async function actLatest(o) {
  const input = resolveInputs(o.known, o);
  const bad = agentGuard(input.agent);
  if (bad) return bad;
  const scope = o.scope || "auto";
  const project = defaultProject(input.project);
  const { project: useProject, note, empty } = resolveScope({ agent: input.agent, project, scope });
  if (empty) return tr("cli.scopeEmpty", { agent: AGENT_LABEL[input.agent] || "auto" });

  const s = input.session
    ? findSession({ id: input.session, agent: input.agent, project: useProject })
    : latestSession({ agent: input.agent, project: useProject, since: input.since });

  if (!s) {
    if (input.session) return tr("cli.noSession", { id: input.session });
    return input.agent === "auto"
      ? tr("cli.noneAny")
      : tr("cli.noneAgent", { agent: AGENT_LABEL[input.agent] || input.agent });
  }
  const loaded = await loadSession(s);
  return (
    warningsOf(input.warnings) +
    (note ? note + "\n\n" : "") +
    render(loaded, { level: o.level, maxChars: o["max-chars"], turns: input.turns })
  );
}

export async function actRead(o) {
  const input = resolveInputs(o.known, o);
  const bad = agentGuard(input.agent);
  if (bad) return bad;
  const project = defaultProject(input.project);
  const s = input.session
    ? findSession({ id: input.session, agent: input.agent, project })
    : latestSession({ agent: input.agent, project });
  if (!s)
    return input.session
      ? tr("cli.noSession", { id: input.session })
      : input.agent === "auto"
        ? tr("cli.noneAny")
        : tr("cli.noneAgent", { agent: AGENT_LABEL[input.agent] || input.agent });
  const loaded = await loadSession(s);
  return warningsOf(input.warnings) + render(loaded, { level: o.level, maxChars: o["max-chars"], turns: input.turns });
}

export function actList(o) {
  const input = resolveInputs(o.known, o);
  const bad = agentGuard(input.agent);
  if (bad) return bad;
  const scope = o.scope || "auto";
  const project = defaultProject(input.project);
  const { project: useProject, empty } = resolveScope({ agent: input.agent, project, scope });
  if (empty) return tr("cli.scopeEmpty", { agent: AGENT_LABEL[input.agent] || "auto" });

  const limit = Number.parseInt(o.limit, 10);
  const rows = recentSessions({
    agent: input.agent,
    project: useProject,
    since: input.since,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 15,
  });
  if (!rows.length) {
    return warningsOf(input.warnings) + (input.since ? tr("cli.noneRange") : tr("cli.noneAny"));
  }

  const head = input.since ? tr("cli.listHead", { n: rows.length, after: new Date(input.since).toLocaleString() }) + "\n" : "";
  // 解析不了的 since/turns 必须说出来：静默忽略会让 --since 退化成"全都要"，用户以为筛过了
  return (
    warningsOf(input.warnings) +
    head +
    rows
      .map((s) => {
        const d = new Date(s.mtimeMs);
        const p = (n) => String(n).padStart(2, "0");
        const t = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
        const mb = (s.files.reduce((a, f) => a + f.size, 0) / 1e6).toFixed(1);
        const proj = (s.cwd || "?").split("/").pop();
        // 多段（续跑）必须在第一层就看得见：这决定"手读会不会漏"
        const segs = s.files.length > 1 ? tr("list.segs", { n: s.files.length }) : "";
        // 标题放最后一列：ids 认不出是哪个会话，标题才是人真正在看的
        const title = s.title ? String(s.title).slice(0, 60) : "";
        return `${t}  ${String(AGENT_LABEL[s.agent]).padEnd(11)} ${proj.padEnd(14).slice(0, 14)} ${String(s.id).slice(0, 8)}  ${mb.padStart(5)}MB${segs}${title ? "  " + title : ""}`;
      })
      .join("\n")
  );
}

export async function actGrep(o) {
  const q = String(o._[0] || o._[1] || "").trim();
  if (!q || q === "true") return tr("cli.grepUsage");
  const input = resolveInputs(o.known, o);
  const bad = agentGuard(input.agent);
  if (bad) return bad;
  const project = defaultProject(input.project);
  const scope = o.scope || "auto";
  const { project: useProject } = resolveScope({ agent: input.agent, project, scope });
  const limit = Number.parseInt(o.limit, 10);
  return (
    warningsOf(input.warnings) +
    (await grepSessions({
      query: q,
      agent: input.agent,
      project: useProject,
      since: input.since,
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 20) : 8,
    }))
  );
}

const HELP_ZH = `aab —— 从另一个 AI 编码工具的会话接着干，只给够用的那一层

用法：
  aab latest   从最新一条结论开始（默认 level=1，不够再加）
      --agent codex|claude|workbuddy|codebuddy|easymint|auto   默认 auto（所有来源里最新的）
      --level 1..4                         1=结论 2=最近3轮 3=需求+结论 4=命令/文件/git
      --session <id 前缀>                   直接锚定某次会话
      --turns 12-14 | 12 | last:5 | from:30 | around:40±2   直接要某几轮（跳过阶梯）
      --since 24h | 2026-10-23              只要这段时间内有活动的
      --project <路径>                      默认当前目录（会归到 git 根）
      --scope auto|project|global           默认 auto：本项目优先，找不到退全机并注明
      --max-chars N                         单次输出上限
      --known '<json>'                      调用方已知的信息（见下）

  aab list     [--limit 15] [--since 24h] [--agent ...] [--scope ...]
  aab read     [--session <id>] [--turns 12-14] [--level N]
  aab grep     "关键词" [--agent ...] [--since ...] [--limit 8]
  aab mcp      stdio MCP server
  aab install  [--agent workbuddy,codex,claude] [--dry-run]
                 只给本机确实装了的客户端注册 MCP；不给 --agent 就自动探测
  aab doctor                                                 诊断：能读到谁、哪个客户端还没挂上
  aab agents                                                 列出能读哪些工具的会话
  aab prompt                                                 打印一段可直接粘给任意 agent 的安装指令
  aab rule                                                   打印一段常驻规则，粘进项目 CLAUDE.md / AGENTS.md
                                                              （不粘也能用，但"查看 xx 会话"会时灵时不灵）
  aab version

--known 可传 JSON，让工具不用猜：
  aab latest --known '{"agent":"codex","project":"/path/to/repo","session":"01a16729","turns":"last:5"}'
  显式参数优先于 --known 里的同名字段。

输出语言：AAB_LANG=zh|en 可强制指定，否则跟随 LC_ALL / LANG（默认 en）。
会话正文永远逐字保留，只翻译周围的标签。`;

const HELP_EN = `aab — pick up where another AI coding tool left off, with only as much context as you need.

Usage:
  aab latest   start from the newest conclusion (level=1 by default; raise it if needed)
      --agent codex|claude|workbuddy|codebuddy|easymint|auto   default: auto (newest across all)
      --level 1..4                      1=conclusion 2=last 3 turns 3=requirement+conclusion 4=commands/files/git
      --session <id prefix>             anchor to one specific session
      --turns 12-14 | 12 | last:5 | from:30 | around:40±2   exact slice (skips the ladder)
      --since 24h | 2026-10-23          only sessions active in this window
      --project <path>                  default: cwd (resolved to the git root)
      --scope auto|project|global       default auto: this project first, else whole machine (noted)
      --max-chars N                     cap the output length
      --known '<json>'                  what the caller already knows (see below)

  aab list     [--limit 15] [--since 24h] [--agent ...] [--scope ...]
  aab read     [--session <id>] [--turns 12-14] [--level N]
  aab grep     "keyword" [--agent ...] [--since ...] [--limit 8]
  aab mcp      stdio MCP server
  aab install  [--agent workbuddy,codex,claude] [--dry-run]
                 register MCP only with clients actually installed here; no --agent = auto-detect
  aab doctor                                                 diagnose: what is readable, which host is missing
  aab agents                                                 list which tools can be read
  aab prompt                                                 print an install instruction an agent can follow
  aab rule                                                   print a standing rule to paste into CLAUDE.md / AGENTS.md
                                                             (optional, but without it "read the xx session" is hit-or-miss)
  aab version

--known takes JSON so the tool does not have to guess:
  aab latest --known '{"agent":"codex","project":"/path/to/repo","session":"01a16729","turns":"last:5"}'
  Explicit flags win over same-named fields in --known.

Output language: AAB_LANG=zh|en overrides; otherwise LC_ALL / LANG (English by default).
Conversation text is never translated — only the surrounding labels.`;

const helpText = () => (isZh() ? HELP_ZH : HELP_EN);

/* ── 入口 ── */
export async function runCli(argv) {
  const [cmd = "latest", ...rest] = argv;
  const o = parseArgs(rest);

  switch (cmd) {
    case "latest":
      return actLatest(o);
    case "read":
      return actRead(o);
    case "list":
      return actList(o);
    case "grep":
      return actGrep(o);
    case "agents":
      return AGENTS.map((a) => `${a}  ${AGENT_LABEL[a]}`).join("\n");
    case "install": {
      const raw = String(o.agent && o.agent !== "true" ? o.agent : "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      return install({
        targets: raw.length ? raw : undefined,
        dryRun: o["dry-run"] === "true" || o["dry-run"] === true,
      });
    }
    case "doctor":
      return doctor();
    case "prompt":
      return prompt();
    case "rule":
      // 规则本体走 stdout（可直接复制）；"粘到哪个文件"是元信息，走 stderr，免得被一起粘进去
      process.stderr.write(tr("rule.hint") + "\n");
      return rule();
    case "version":
    case "--version":
    case "-v":
      return `aab ${VERSION}`;
    case "help":
    case "--help":
    case "-h":
      return helpText();
    default:
      return tr("cli.unknownCmd", { cmd }) + "\n\n" + helpText();
  }
}
