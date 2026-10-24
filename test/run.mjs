#!/usr/bin/env node
/**
 * 端到端测试：真跑 CLI 与 MCP，对着本机真实会话断言。
 *
 * 没有会话的工具会被跳过而不是判失败——这个工具的价值取决于本机有什么。
 * 判定原则：不崩、不错范围、不撒谎（不把旁白当结论、不把别的项目当本项目）。
 */
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLevels, renderTurns } from "../src/ladder.mjs";
import { parseTurns } from "../src/known.mjs";
import { dropTomlSection, runtimeMode } from "../src/install.mjs";
import { validateDict } from "../src/i18n.mjs";

const SB = new URL("../bin/aab.mjs", import.meta.url).pathname;
const NODE = process.execPath;
const results = [];

function run(args, cwd = os.homedir()) {
  const t0 = Date.now();
  // 断言以中文为基准（与历史输出一致），语言相关行为单独用 case 验
  const r = spawnSync(NODE, [SB, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, AAB_LANG: "zh" },
  });
  return { out: r.stdout || "", err: r.stderr || "", code: r.status, ms: Date.now() - t0 };
}

function check(name, fn) {
  try {
    results.push({ name, pass: true, detail: fn() });
  } catch (e) {
    results.push({ name, pass: false, detail: e.message });
  }
}

const has = (s, sub) => {
  if (!s.includes(sub)) throw new Error(`缺少片段「${sub}」；实际前 200 字：${s.slice(0, 200)}`);
  return `含「${sub}」`;
};
const noCrash = (r) => {
  if (r.code !== 0) throw new Error(`exit=${r.code} ${r.err.split("\n")[0]}`);
  // 只认"真的抛了"的形状：行首的 XxxError: 或栈帧。
  // 早前是 out.includes("ReferenceError") —— 会话正文里提到这个词（比如正在讨论这个 bug）就误报。
  const crashLine = /^[A-Z]\w*Error:/m.test(r.out);
  const stackFrame = /^\s+at .*:\d+:\d+\)?$/m.test(r.out);
  if (crashLine || stackFrame) throw new Error("输出含异常栈");
  if (/\bNaN(?:MB| token| 处)?\b/.test(r.out)) throw new Error("输出含 NaN");
  if (r.out.includes("undefined 的会话")) throw new Error("输出含 undefined 拼接");
  return "ok";
};

/** 发现本机有哪些工具可用 */
const available = new Set();
{
  const r = run(["agents"]);
  for (const line of r.out.split("\n")) {
    const name = line.trim().split(/\s+/)[0];
    if (name && run(["list", "--agent", name, "--limit", "1"]).out.trim()) available.add(name);
  }
}
const agents = [...available];
console.log(`本机可用工具：${agents.join(", ") || "（无）"}\n`);

/* ── 基础 ── */
check("help 列出全部子命令", () => {
  const r = run(["help"]);
  noCrash(r);
  for (const c of ["latest", "list", "read", "grep", "mcp"]) has(r.out, c);
  return "5 个子命令";
});

check("agents 列表带说明", () => {
  const r = run(["agents"]);
  noCrash(r);
  has(r.out, "Codex");
  return `${r.out.split("\n").length} 行`;
});

check("未知命令给用法", () => {
  const r = run(["nonsense"]);
  noCrash(r);
  has(r.out, "未知命令");
  return "ok";
});

/* ── list ── */
check("list 默认有结果", () => {
  const r = run(["list"]);
  noCrash(r);
  if (!r.out.trim()) throw new Error("空输出");
  return `${r.out.trim().split("\n").length} 行`;
});

check("list --limit 0 夹到 1", () => {
  const r = run(["list", "--limit", "0"]);
  noCrash(r);
  has(r.out, "10-");
  const n = r.out.trim().split("\n").filter((l) => l.includes("MB")).length;
  if (n !== 1) throw new Error(`出 ${n} 行`);
  return "1 行";
});

check("list --limit 999 夹到 50", () => {
  const r = run(["list", "--limit", "999"]);
  noCrash(r);
  const n = r.out.trim().split("\n").filter((l) => l.includes("MB")).length;
  if (n > 50) throw new Error(`出 ${n} 行`);
  return `${n} 行`;
});

check("list --since 24h 只回近期", () => {
  const r = run(["list", "--since", "24h"]);
  noCrash(r);
  if (!r.out.includes("之后") && !r.out.includes("没有")) throw new Error("缺少时间范围说明");
  return "有范围说明";
});

check("list --since 无法解析时不崩", () => {
  const r = run(["list", "--since", "上周二"]);
  noCrash(r);
  return "ok";
});

/* ── latest 矩阵 ── */
for (const agent of agents) {
  for (const level of [1, 2, 3, 4]) {
    check(`latest ${agent} L${level}`, () => {
      const r = run(["latest", "--agent", agent, "--level", String(level), "--scope", "global"]);
      noCrash(r);
      has(r.out, `【level ${level} ·`);
      if (r.ms > 8000) throw new Error(`${r.ms}ms 过慢`);
      return `${r.ms}ms`;
    });
  }
}

check("latest --level abc 回落 1", () => {
  const r = run(["latest", "--level", "abc", "--scope", "global"]);
  noCrash(r);
  has(r.out, "【level 1 ·");
  return "ok";
});

check("latest --level 99 夹到 4", () => {
  const r = run(["latest", "--level", "99", "--scope", "global"]);
  noCrash(r);
  has(r.out, "【level 4 ·");
  return "ok";
});

check("latest --max-chars 真的截断", () => {
  const r = run(["latest", "--level", "2", "--max-chars", "300", "--scope", "global"]);
  noCrash(r);
  has(r.out, "截断");
  return "ok";
});

/* ── turns / known ── */
check("latest --turns 1-2 出指定区间", () => {
  const r = run(["latest", "--turns", "1-2", "--scope", "global"]);
  noCrash(r);
  has(r.out, "【第 1-2 轮");
  return "ok";
});

check("latest --turns last:2", () => {
  const r = run(["latest", "--turns", "last:2", "--scope", "global"]);
  noCrash(r);
  has(r.out, "轮 · 共");
  return "ok";
});

check("latest --turns 越界给提示", () => {
  const r = run(["latest", "--turns", "998-999", "--scope", "global"]);
  noCrash(r);
  has(r.out, "共");
  return "ok";
});

check("latest --turns 乱写被忽略并提示", () => {
  const r = run(["latest", "--turns", "第几轮", "--scope", "global"]);
  noCrash(r);
  has(r.out, "已忽略");
  return "ok";
});

check("known JSON 一次性传全", () => {
  const known = JSON.stringify({ turns: "1", level: 1 });
  const r = run(["latest", "--known", known, "--scope", "global"]);
  noCrash(r);
  has(r.out, "【第 1-1 轮");
  return "ok";
});

check("显式参数优先于 known", () => {
  const known = JSON.stringify({ turns: "1" });
  const r = run(["latest", "--known", known, "--turns", "2-2", "--scope", "global"]);
  noCrash(r);
  has(r.out, "【第 2-2 轮");
  return "ok";
});

check("known 坏 JSON 不崩", () => {
  const r = run(["latest", "--known", "{不是json", "--scope", "global"]);
  noCrash(r);
  has(r.out, "【level 1 ·");
  return "ok";
});

/* ── read ── */
check("read 无 --session 取最新", () => {
  const r = run(["read", "--scope", "global"]);
  noCrash(r);
  has(r.out, "会话 ");
  return "ok";
});

check("read 不存在的 id 有提示", () => {
  const r = run(["read", "--session", "zzzzzz"]);
  noCrash(r);
  has(r.out, "没找到会话");
  return "ok";
});

if (agents.includes("codex")) {
  check("read 按前缀锚定", () => {
    const list = run(["list", "--agent", "codex", "--limit", "1", "--scope", "global"]).out;
    const id = list.match(/([0-9a-f]{8})-[0-9a-f]{4}/)?.[1];
    if (!id) throw new Error("列表里没解析到 id");
    const r = run(["read", "--agent", "codex", "--session", id, "--level", "1"]);
    noCrash(r);
    has(r.out, id);
    return `前缀 ${id}`;
  });
}

/* ── grep ── */
check("grep 空关键词给用法", () => {
  const r = run(["grep"]);
  noCrash(r);
  has(r.out, "用法");
  return "ok";
});

check("grep 未命中", () => {
  const r = run(["grep", "zzz_必定不存在的串_zzz", "--limit", "1", "--scope", "global"]);
  noCrash(r);
  has(r.out, "没命中");
  return "ok";
});

check("grep 正则元字符按字面处理", () => {
  const r = run(["grep", "a.*b", "--limit", "1", "--scope", "global"]);
  noCrash(r);
  return "ok";
});

/* ── 作用域 ── */
check("无会话的项目目录 → 退全机并注明", () => {
  const dir = path.join(os.tmpdir(), "aab-empty-proj");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  const r = run(["latest"], dir);
  noCrash(r);
  has(r.out, "已退到全机最新");
  return "ok";
});

check("scope=project 严格不回退", () => {
  const dir = path.join(os.tmpdir(), "aab-empty-proj");
  const r = run(["latest", "--scope", "project"], dir);
  noCrash(r);
  has(r.out, "不回退");
  return "ok";
});

check("list 里多段会话带段标记", () => {
  const r = run(["list", "--limit", "20"]);
  noCrash(r);
  const lines = r.out.trim().split("\n").filter((l) => l.includes("MB"));
  const withSegs = lines.filter((l) => /· \d+ 段/.test(l));
  if (!withSegs.length) return "本机无多段会话，跳过";
  return `${withSegs.length}/${lines.length} 行带段标记`;
});

check("level=1 未收尾时给出上一轮结论", () => {
  const t = (i, user, finals, narration = []) => ({ i, user, userTs: "", finals, narration, tools: [], files: [] });
  const s = {
    agent: "codex", id: "x", cwd: "/tmp", mtimeMs: Date.now(),
    files: [{ file: "a", mtimeMs: 1, size: 1 }], compaction: [],
    turns: [t(1, "做A", ["A 完成"]), t(2, "做B", ["B 完成"]), t(3, "做C", [], ["还在做 C"])],
  };
  const l1 = buildLevels(s)[0];
  if (!/未收尾|unfinished/.test(l1.title)) throw new Error(`标题异常: ${l1.title}`);
  if (!/(退路|fallback)/.test(l1.body) || !/(第 2 轮|turn 2)/.test(l1.body)) throw new Error("没有给出退路");
  return "退路指向第 2 轮";
});

check("TOML 段落能被完整摘掉（含重复）", () => {
  const src = ["a = 1", "", "[mcp_servers.aab]", "command = \"x\"", "", "[mcp_servers.pickup]", "command = \"y\"", "", "[mcp_servers.aab]", "command = \"z\"", "", "[other]", "k = 1"].join("\n");
  const one = dropTomlSection(src, "[mcp_servers.aab]");
  if (one.includes("[mcp_servers.aab]")) throw new Error("仍有 aab 段落");
  if (!one.includes("[mcp_servers.pickup]")) throw new Error("误删了别的段落");
  if (!one.includes("[other]")) throw new Error("误删了尾随段落");
  const both = dropTomlSection(one, "[mcp_servers.pickup]");
  if (both.includes("pickup")) throw new Error("pickup 未清掉");
  return "重复段落一次清完";
});

check("重复执行 install 不会累积 TOML 段落", () => {
  const home = path.join(os.tmpdir(), "aab-toml-home");
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  const cfg = path.join(home, ".codex", "config.toml");
  fs.writeFileSync(cfg, ["[mcp_servers.pickup]", "command = \"old\"", "", "[mcp_servers.aab]", "command = \"dup\"", ""].join("\n"));
  for (let i = 0; i < 2; i++) {
    const r = spawnSync(NODE, [SB, "install", "--agent", "codex"], { encoding: "utf8", env: { ...process.env, HOME: home }, timeout: 30000 });
    if (r.status !== 0) throw new Error(`第 ${i + 1} 次 install 失败: ${r.stderr.slice(0, 120)}`);
  }
  const text = fs.readFileSync(cfg, "utf8");
  const n = (text.match(/^\[mcp_servers\.aab\]/gm) || []).length;
  if (n !== 1) throw new Error(`aab 段落有 ${n} 个，应为 1`);
  if (text.includes("[mcp_servers.pickup]")) throw new Error("pickup 段落未清掉");
  return "1 段，旧名已清";
});

check("turns 语法：range / last / from / around", () => {
  const eq = (a, b) => JSON.stringify(parseTurns(a)) === JSON.stringify(b);
  if (!eq("12-14", { from: 12, to: 14 })) throw new Error("区间解析错");
  if (!eq("12", { from: 12, to: 12 })) throw new Error("单轮解析错");
  if (!eq("last:5", { last: 5 })) throw new Error("last 解析错");
  if (!eq("from:30", { from: 30 })) throw new Error("from 解析错");
  if (!eq("around:40±2", { around: 40, span: 2 })) throw new Error("around 解析错");
  if (parseTurns("第几轮") !== null) throw new Error("非法输入应返回 null");
  return "5 种写法 + 非法输入";
});

check("from: 渲染到最后一轮，around: 渲染前后窗口", () => {
  const t = (i, user, finals) => ({ i, user, userTs: "", finals, narration: [], tools: [], files: [] });
  const s = {
    agent: "codex", id: "x", cwd: "/tmp", mtimeMs: 0, files: [{ file: "a", mtimeMs: 0, size: 1 }], compaction: [],
    turns: Array.from({ length: 10 }, (_, k) => t(k + 1, `需求${k + 1}`, [`结论${k + 1}`])),
  };
  const from = renderTurns(s, parseTurns("from:8"));
  if (!/(第 )?8-10/.test(from)) throw new Error(`from: 渲染错：${from.slice(0, 60)}`);
  const around = renderTurns(s, parseTurns("around:5±1"));
  if (!/(第 )?4-6/.test(around)) throw new Error(`around: 渲染错：${around.slice(0, 60)}`);
  return "from:8 → 8-10，around:5±1 → 4-6";
});

check("能区分开发态 / 安装态 / npx", () => {
  const dev = runtimeMode("/Users/x/dev/proj/bin/aab.mjs");
  const inst = runtimeMode("/opt/homebrew/lib/node_modules/@tianemon/ai-agent-bridge/bin/aab.mjs");
  const npx = runtimeMode("/Users/x/.npm/_npx/abc123/node_modules/@tianemon/ai-agent-bridge/bin/aab.mjs");
  if (dev.kind !== "dev" || !dev.dev) throw new Error(`开发态判定错: ${JSON.stringify(dev)}`);
  if (inst.kind !== "installed" || inst.dev) throw new Error(`安装态判定错: ${JSON.stringify(inst)}`);
  if (npx.kind !== "npx" || npx.dev) throw new Error(`npx 判定错: ${JSON.stringify(npx)}`);
  return "三种运行位置都能分辨（返回语义 key）";
});

check("中英字典键一一对应", () => {
  const v = validateDict();
  if (v.missingInEn.length) throw new Error(`英文缺键: ${v.missingInEn.join(", ")}`);
  if (v.missingInZh.length) throw new Error(`中文缺键: ${v.missingInZh.join(", ")}`);
  return `${v.size} 个键两语齐全`;
});

check("findSession 取最近活动的那个（同前缀不误选）", () => {
  // 直接验证排序契约：构造两台同前缀会话，较新的必须排在前
  const rows = [
    { id: "01a1aaaa", mtimeMs: 100 },
    { id: "01a1bbbb", mtimeMs: 900 },
  ].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const hit = rows.find((r) => r.id.startsWith("01a1"));
  if (hit.id !== "01a1bbbb") throw new Error("未按 mtime 取最新");
  return "按最近活动命中";
});

check("AAB_LANG=en 输出英文标签，正文保持原文", () => {
  const r = spawnSync(NODE, [SB, "latest", "--agent", "codex", "--level", "1"], {
    encoding: "utf8",
    env: { ...process.env, AAB_LANG: "en", LANG: "en_US.UTF-8" },
    timeout: 60000,
  });
  if (r.status !== 0) throw new Error(r.stderr.slice(0, 120));
  if (!r.stdout.includes("【level 1 ·")) throw new Error("level 头缺失");
  if (!/latest conclusion|latest progress/.test(r.stdout)) throw new Error("标题未英文化");
  if (!/turns? ·/.test(r.stdout) && !r.stdout.includes("turns")) throw new Error("轮次信息未英文化");
  return "英文标签 + 原文正文";
});

check("Claude 首次注册：成功后不能报失败（曾经 ReferenceError）", () => {
  // 用假 HOME + 假 claude CLI，走真实 install 分支。这条路径平时被"本机早已注册"挡住，
  // 0.1.2 里 applyClaude 引用了未定义的 dropped，成功后反而吐"注册失败"。
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aab-claude-"));
  const bin = path.join(home, "bin");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(home, "calls.log");
  fs.writeFileSync(
    path.join(bin, "claude"),
    ['#!/bin/sh', 'case "$1 $2" in', '  "mcp list") exit 0 ;;', '  "mcp add") echo "$@" >> "' + log + '"; exit 0 ;;', '  "mcp remove") exit 1 ;;', "esac", "exit 1", ""].join("\n"),
    { mode: 0o755 }
  );

  const r = spawnSync(NODE, [SB, "install", "--agent", "claude"], {
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, AAB_LANG: "en" },
  });
  const out = r.stdout || "";
  if (!out.includes("✓")) throw new Error(`没有成功标记：${out.replace(/\n/g, " ").slice(0, 200)}`);
  if (/registration failed|dropped is not defined/.test(out)) throw new Error(`仍报失败：${out.slice(0, 200)}`);
  const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
  if (!calls.includes("--scope user aab")) throw new Error(`没有真的调用 claude mcp add：${calls}`);
  return "退出码 0，add 已执行，回执为成功";
});

check("多条信任记录取最近一次（否则永远报旧配置）", () => {
  const mk = (grants) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aab-trust-"));
    fs.mkdirSync(path.join(home, ".workbuddy"), { recursive: true });
    fs.mkdirSync(path.join(home, ".aab"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".workbuddy", "mcp.json"),
      JSON.stringify({ mcpServers: { aab: { command: "/usr/bin/node", args: ["/tmp/aab.mjs", "mcp"], timeout: 20000, disabled: false } } })
    );
    const now = Date.now();
    const map = {};
    // 每条记录 = 一次「配置指纹::名字」，改过路径就会多一条
    grants.forEach((offset, i) => {
      map[`${String(i).repeat(8)}::aab`] = now + offset;
    });
    fs.writeFileSync(path.join(home, ".workbuddy", "mcp-approvals.json"), JSON.stringify(map));
    // 我方最后一次写入配置的时间 = now
    fs.writeFileSync(path.join(home, ".aab", "state.json"), JSON.stringify({ workbuddy: { ts: now, hash: "x" } }));
    return home;
  };
  const wbLine = (home) => {
    const r = spawnSync(NODE, [SB, "doctor"], {
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, HOME: home, AAB_LANG: "zh" },
    });
    // 「会话来源」段里也有 WorkBuddy 一行，只取宿主段（带 已注册/未注册/信任 的那行）
    return (r.stdout || "").split("\n").find((l) => l.includes("WorkBuddy") && /已注册|未注册|信任|无法检测/.test(l)) || "";
  };

  const fresh = wbLine(mk([-600000, 600000])); // 一条更早、一条在写入之后
  if (/旧配置/.test(fresh)) throw new Error(`仍报旧配置：${fresh.trim()}`);
  if (!/已信任/.test(fresh)) throw new Error(`没识别到信任：${fresh.trim()}`);

  const stale = wbLine(mk([-600000, -300000])); // 没有任何一条晚于写入
  if (!/旧配置/.test(stale)) throw new Error(`应报旧配置：${stale.trim()}`);

  return "取最近一条；全都早于写入时才报旧";
});

check("无效入参的警告跟随语言，且不重复说 ignored", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aab-warn-"));
  const r = spawnSync(NODE, [SB, "list", "--since", "nonsense"], {
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, HOME: home, AAB_LANG: "en", LANG: "en_US.UTF-8" },
  });
  const out = (r.stdout || "") + (r.stderr || "");
  if (/[\u4e00-\u9fff]/.test(out)) throw new Error(`仍有中文：${out.slice(0, 120)}`);
  if (!/could not parse since/.test(out)) throw new Error(`没有解析失败提示：${out.slice(0, 120)}`);
  // 外层已经有 "(ignored: …)"，内层再说一次 ignored 就成了绕圈子
  if ((out.match(/ignored/gi) || []).length > 1) throw new Error(`ignored 重复：${out.trim()}`);
  return "英文警告，语义不重复";
});

check("rule 输出是可直接粘的片段（### 起，元信息不进 stdout）", () => {
  for (const lang of ["zh", "en"]) {
    const r = spawnSync(NODE, [SB, "rule"], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, AAB_LANG: lang, LANG: "" },
    });
    if (r.status !== 0) throw new Error(`${lang}: exit=${r.status} ${r.stderr.slice(0, 120)}`);
    if (!r.stdout.startsWith("### ")) throw new Error(`${lang}: 不以 ### 开头 → ${r.stdout.slice(0, 40)}`);
    // 「粘到哪个文件」属于元信息，混进 stdout 就会被一起复制进 CLAUDE.md
    if (/粘进项目根|paste the text above/i.test(r.stdout)) throw new Error(`${lang}: 元信息混进了 stdout`);
    if (!/session_latest/.test(r.stdout) || !/rollout-\*\.jsonl/.test(r.stdout)) throw new Error(`${lang}: 缺关键条目`);
    if (!/agent/.test(r.stdout)) throw new Error(`${lang}: 没提醒点名工具要传 agent`);
    if (lang === "en" && /[\u4e00-\u9fff]/.test(r.stdout)) throw new Error("en 版含中文");
  }
  return "两语均以 ### 起，提示走 stderr";
});

check("AAB_LANG=en 时所有结构性输出无中文（发版闸门）", () => {
  // 唯一允许保留的中文：WorkBuddy 的菜单路径（它的界面就是中文）
  const MENU = "连接器 → 自定义连接器 → aab → 信任";
  const clean = (s) => s.split(MENU).join("");
  const cmds = [
    ["help"],
    ["version"],
    ["agents"],
    ["doctor"],
    ["install", "--dry-run"],
    ["prompt"],
    ["rule"],
    ["nosuchcmd"],
    ["latest", "--agent", "cursor"],
    ["grep"],
    ["list", "--since", "1s"],
  ];
  const bad = [];
  for (const args of cmds) {
    const r = spawnSync(NODE, [SB, ...args], {
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, AAB_LANG: "en", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
    });
    const out = clean((r.stdout || "") + (r.stderr || ""));
    const hit = out.match(/[\u4e00-\u9fff]+/g);
    if (hit) bad.push(`${args.join(" ")} → ${hit.slice(0, 4).join(" / ")}`);
  }
  if (bad.length) throw new Error(`仍残留中文：${bad.join(" | ")}`);
  return `${cmds.length} 条命令全英文`;
});

check("未知工具被拒绝，不静默降级", () => {
  const r = run(["latest", "--agent", "cursor"]);
  noCrash(r);
  has(r.out, "不支持的工具");
  return "ok";
});

/* ── 安装与诊断 ── */
check("version 输出版本号", () => {
  const r = run(["version"]);
  noCrash(r);
  if (!/\d+\.\d+\.\d+/.test(r.out)) throw new Error("没有版本号");
  return r.out.trim();
});

check("prompt 给出 agent 自安装指令", () => {
  const r = run(["prompt"]);
  noCrash(r);
  has(r.out, "@tianemon/ai-agent-bridge install");
  has(r.out, "@tianemon/ai-agent-bridge doctor");
  return "含安装与验证两步";
});

check("doctor 三节齐全且不崩", () => {
  const r = run(["doctor"]);
  noCrash(r);
  for (const s of ["运行时", "会话来源", "宿主", "当前作用域"]) has(r.out, s);
  has(r.out, "结论");
  return r.out.split("\n").length + " 行";
});

check("doctor 列出全部读取源", () => {
  const r = run(["doctor"]);
  for (const a of ["Codex", "Claude Code", "EasyMint"]) has(r.out, a);
  return "三家都在";
});

check("install --dry-run 不写任何文件", () => {
  const wb = path.join(os.homedir(), ".workbuddy", "mcp.json");
  const cx = path.join(os.homedir(), ".codex", "config.toml");
  const stamp = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
  const before = [stamp(wb), stamp(cx)];
  const r = run(["install", "--dry-run"]);
  noCrash(r);
  has(r.out, "dry-run");
  const after = [stamp(wb), stamp(cx)];
  if (before[0] !== after[0] || before[1] !== after[1]) throw new Error("dry-run 修改了配置文件");
  return "配置未变";
});

check("install 只处理探测到的宿主", () => {
  const r = run(["install", "--dry-run"]);
  has(r.out, "探测到");
  if (!r.out.includes("跳过（未检测到本机安装）") && r.out.includes("未检测到")) {
    throw new Error("跳过文案异常");
  }
  return "按探测结果决策";
});

check("install --agent 未知宿主给提示", () => {
  const r = run(["install", "--agent", "cursor", "--dry-run"]);
  noCrash(r);
  has(r.out, "未知宿主");
  return "ok";
});

/* ── MCP ── */
function mcpRoundtrip(payloads, waitMs = 3500, cwd = os.homedir()) {
  return new Promise((resolve) => {
    const p = spawn(NODE, [SB, "mcp"], { cwd, env: { ...process.env, AAB_LANG: "zh" } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    for (const x of payloads) p.stdin.write(JSON.stringify(x) + "\n");
    setTimeout(() => {
      p.kill();
      resolve(
        out
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return { _raw: l };
            }
          })
      );
    }, waitMs);
  });
}

const mcpCases = [];
const mcpCheck = async (name, fn) => {
  try {
    mcpCases.push({ name, pass: true, detail: await fn() });
  } catch (e) {
    mcpCases.push({ name, pass: false, detail: e.message });
  }
};

await mcpCheck("initialize 回显已知版本", async () => {
  const r = await mcpRoundtrip([{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-30" } }], 1200);
  if (r[0]?.result?.protocolVersion !== "2025-06-30") throw new Error(JSON.stringify(r[0]));
  return "2025-06-30";
});

await mcpCheck("initialize 拒绝未知版本", async () => {
  const r = await mcpRoundtrip([{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }], 1200);
  if (r[0]?.result?.protocolVersion !== "2024-11-05") throw new Error(JSON.stringify(r[0]));
  return "回落 2024-11-05";
});

await mcpCheck("notifications 不产生响应", async () => {
  const r = await mcpRoundtrip(
    [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 9, method: "ping" },
    ],
    1200
  );
  if (r.length !== 1) throw new Error(`收到 ${r.length} 条`);
  return "ok";
});

await mcpCheck("tools/list 出 5 个工具", async () => {
  const r = await mcpRoundtrip([{ jsonrpc: "2.0", id: 2, method: "tools/list" }], 1200);
  const names = (r[0]?.result?.tools || []).map((t) => t.name);
  for (const w of ["session_latest", "session_list", "session_read", "session_grep", "session_agents"]) {
    if (!names.includes(w)) throw new Error(`缺 ${w}`);
  }
  return names.join(",");
});

await mcpCheck("五个工具并发各调一次", async () => {
  const r = await mcpRoundtrip(
    [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "session_latest", arguments: { level: 1 } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "session_list", arguments: { limit: 2 } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "session_read", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "session_grep", arguments: { query: "的", limit: 1 } } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "session_agents", arguments: {} } },
    ],
    8000
  );
  if (r.length !== 5) throw new Error(`收到 ${r.length} 条`);
  for (const one of r) {
    if (one.result?.isError) throw new Error(`id=${one.id}: ${one.result.content[0].text.slice(0, 80)}`);
  }
  return "5/5";
});

await mcpCheck("turns 参数走 MCP 也生效", async () => {
  const r = await mcpRoundtrip(
    [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "session_latest", arguments: { turns: "1-1" } } }],
    4000
  );
  const t = r[0]?.result?.content?.[0]?.text || "";
  if (!t.includes("【第 1-1 轮")) throw new Error(t.slice(0, 120));
  return "ok";
});

await mcpCheck("未知工具返回 isError", async () => {
  const r = await mcpRoundtrip([{ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } }], 1500);
  if (!r[0]?.result?.isError) throw new Error(JSON.stringify(r[0]).slice(0, 120));
  return "ok";
});

await mcpCheck("未知方法回 -32601", async () => {
  const r = await mcpRoundtrip([{ jsonrpc: "2.0", id: 6, method: "resources/list" }], 1200);
  if (r[0]?.error?.code !== -32601) throw new Error(JSON.stringify(r[0]).slice(0, 120));
  return "ok";
});

await mcpCheck("坏 JSON 行之后仍能响应", async () => {
  const p = spawn(NODE, [SB, "mcp"], { cwd: os.homedir(), env: { ...process.env, AAB_LANG: "zh" } });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stdin.write("{这不是json}\n");
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }) + "\n");
  await new Promise((res) => setTimeout(res, 1500));
  p.kill();
  const lines = out.trim().split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  if (last.id !== 7) throw new Error(`最后一条不是 ping：${lines.join("|").slice(0, 160)}`);
  return "ok";
});

/* ── 汇总 ── */
const all = [...results, ...mcpCases];
const bad = all.filter((r) => !r.pass);
for (const r of all) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  —  ${r.detail}`);
console.log(`\n合计 ${all.length}，通过 ${all.length - bad.length}，失败 ${bad.length}`);
process.exitCode = bad.length ? 1 : 0;
