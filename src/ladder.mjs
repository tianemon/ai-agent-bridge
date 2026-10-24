/**
 * 输出层：默认只给"最新一条结论"，不够再往上要一层；
 * 调用方若已经知道要哪几轮，就用 turns 直接跳过去。
 *
 * 每层都自带「下一层要花多少 token」，让调用方自己决定停在哪。
 */
import { execFileSync } from "node:child_process";
import { AGENT_LABEL } from "./registry.mjs";

const tok = (s) => Math.ceil([...String(s)].length / 2.2);

const clampInt = (v, min, max, def) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

function clip(s, max) {
  const arr = [...String(s)];
  if (arr.length <= max) return arr.join("");
  const head = Math.floor(max * 0.72);
  const tail = max - head;
  return (
    arr.slice(0, head).join("") +
    `\n…（截断 ${arr.length - max} 字）…\n` +
    arr.slice(arr.length - tail).join("")
  );
}

const oneLine = (s, max = 120) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

function fmtTime(ms) {
  if (!ms) return "?";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function gitSnapshot(cwd, sessionFiles) {
  if (!cwd) return "";
  const run = (args) => {
    try {
      return execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        timeout: 4000,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch {
      return "";
    }
  };
  const log = run(["log", "--oneline", "-5"]);
  const st = run(["status", "--short"]);
  if (!log && !st) return "";
  const lines = [];
  if (log) lines.push("最近提交：", ...log.split("\n").map((l) => "  " + l));
  if (st) {
    const rows = st.split("\n").filter(Boolean);
    // 工作区是"整个仓库此刻的状态"，不一定都是这个会话改的：
    // 用会话里出现过的文件求交集，把归因说清楚，别让人误判上一家改了什么
    const touched = new Set((sessionFiles || []).map((f) => f.replace(/^\.\//, "")));
    const mine = rows.filter((r) => {
      const p = r.slice(3).trim();
      return touched.has(p) || [...touched].some((f) => f.endsWith("/" + p) || p.endsWith("/" + f));
    });
    lines.push(
      `工作区未提交（${rows.length} 项，整个仓库的当前状态）`,
      `  其中与本会话改动文件重合 ${mine.length} 项，其余可能来自其它工具/其它会话`
    );
    const ordered = [...mine, ...rows.filter((r) => !mine.includes(r))];
    lines.push(...ordered.slice(0, 20).map((l) => "  " + l));
    if (rows.length > 20) lines.push(`  …还有 ${rows.length - 20} 项`);
  }
  return lines.join("\n");
}

const finalOf = (t) => (t.finals.length ? t.finals[t.finals.length - 1] : t.narration[t.narration.length - 1] || "");

function header(s) {
  const label = AGENT_LABEL[s.agent] || s.agent;
  const segs = s.files.length > 1 ? ` · 续跑 ${s.files.length} 段` : "";
  const model = s.model ? ` · ${s.model}` : "";
  return [
    `■ ${label} · ${fmtTime(s.mtimeMs)}${segs}${model}`,
    `  会话 ${String(s.id).slice(0, 18)} · 共 ${s.turns.length} 轮需求 · ${s.cwd || "路径未知"}`,
  ].join("\n");
}

/** 阶梯各层，返回 [{level,title,body}] */
export function buildLevels(s) {
  const turns = s.turns;
  const last = turns[turns.length - 1];
  const levels = [];

  // L1 最新结论
  {
    const settled = !!last?.finals.length;
    const body = last
      ? `第 ${last.i} 轮 · 用户问：${oneLine(last.user, 160)}\n\n${
          settled
            ? clip(finalOf(last), 4200)
            : "（该轮没有收尾结论——会话可能中断、仍在运行，或最后一条只是进展旁白）\n\n" +
              clip(finalOf(last) || "（该轮没有任何文本输出）", 4200)
        }`
      : "（这个会话里没有解析到对话内容）";

    // 未收尾时给一条退路：直接附上最近一条有结论的轮次，免得为了看一眼上一轮再调一次 level=2
    let fallback = "";
    if (last && !settled) {
      const prev = [...turns].reverse().find((t) => t.i !== last.i && t.finals.length);
      if (prev) {
        const tail = clip(finalOf(prev), 600);
        fallback = `\n\n── 退路：最近一条结论在第 ${prev.i} 轮（约 +${tok(tail)} token）──\n${tail}`;
      }
    }
    levels.push({ level: 1, title: settled ? "最新一条结论" : "最新进展（未收尾）", body: body + fallback });
  }

  // L2 最近 3 轮
  {
    const pick = turns.slice(-3);
    const body = pick
      .map((t) => {
        const q = clip(oneLine(t.user, 300), 300) || "（无用户输入，可能由应用侧自动发起）";
        const a = clip(finalOf(t) || "（无文本结论）", 900);
        return `── 第 ${t.i} 轮 ──\n问：${q}\n论：${a}`;
      })
      .join("\n\n");
    levels.push({ level: 2, title: `最近 ${pick.length} 轮问答`, body });
  }

  // L3 需求时间线
  {
    const lines = turns.map((t) => {
      const mark = t.i === last?.i ? "▸" : " ";
      return `${mark}${String(t.i).padStart(2, " ")}. ${oneLine(t.user, 110)}`;
    });
    // 一个会话可能被压缩多次（claude 实测单会话最多 11 次），只取最近两条
    const comps = (s.compaction || []).slice(-2);
    const comp = comps.length
      ? "\n\n" +
        comps
          .map(
            (c, i) =>
              `[压缩摘要 ${i + 1}/${comps.length}${
                (s.compaction || []).length > comps.length
                  ? `（会话共被压缩 ${(s.compaction || []).length} 次，此处只取最近 ${comps.length} 次）`
                  : ""
              }]\n` + clip(c, 1600)
          )
          .join("\n\n")
      : "";
    levels.push({ level: 3, title: "全部需求时间线", body: lines.join("\n") + comp });
  }

  // L4 工具 / 文件 / git
  {
    const files = new Map();
    const cmds = [];
    const tools = new Map();
    for (const t of turns) {
      for (const f of t.files) files.set(f, (files.get(f) || 0) + 1);
      for (const x of t.tools) {
        if (x.kind === "cmd") cmds.push(x.target);
        else tools.set(`${x.name}${x.target ? " · " + oneLine(x.target, 60) : ""}`, 1);
      }
    }
    const top = [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    const body = [
      `改动过的文件（整段会话 ${turns.length} 轮累计，共 ${files.size} 个，按出现次数）`,
      ...top.map(([f, n]) => `  ${n}× ${f}`),
      "",
      `命令（${cmds.length} 条，取最后 15 条）`,
      ...cmds.slice(-15).map((c) => "  $ " + oneLine(c, 150)),
      "",
      `工具调用（${tools.size} 种）`,
      ...[...tools.keys()].slice(0, 20).map((k) => "  - " + k),
      "",
      gitSnapshot(s.cwd, [...files.keys()]),
    ].join("\n");
    levels.push({ level: 4, title: "命令 / 文件 / git 状态", body });
  }

  return levels;
}

/** 指定轮次区间：调用方已经知道要看哪几轮时用它，比逐层加码省一轮往返 */
export function renderTurns(s, turns, { maxChars = 9000 } = {}) {
  const total = s.turns.length;
  if (!total) return "（这个会话里没有解析到对话内容）";
  let from;
  let to;
  if (turns.last) {
    from = Math.max(1, total - turns.last + 1);
    to = total;
  } else if (turns.around) {
    const span = turns.span ?? 3;
    from = Math.max(1, turns.around - span);
    to = Math.min(total, turns.around + span);
  } else {
    from = Math.max(1, turns.from);
    // from: 只给起点 → 一直到最后；区间越界则夹到总轮数
    to = Math.min(total, turns.to ?? total);
  }
  if (from > to) {
    return `轮次区间无效：${from}-${to}（会话共 ${total} 轮）`;
  }
  const picked = s.turns.filter((t) => t.i >= from && t.i <= to);
  if (!picked.length) return `会话里没有第 ${from}-${to} 轮（共 ${total} 轮）`;

  const body = picked
    .map(
      (t) =>
        `── 第 ${t.i} 轮 ──\n问：${clip(oneLine(t.user, 600), 600) || "（无用户输入）"}\n论：${clip(
          finalOf(t) || "（该轮无文本结论）",
          1200
        )}`
    )
    .join("\n\n");

  const out = [
    header(s),
    "",
    `【第 ${from}-${to} 轮 · 共 ${total} 轮】`,
    clip(body, maxChars),
    "",
    `（按需指定区间；不给 turns 时走 level 阶梯，从最新结论开始）`,
  ];
  return out.join("\n");
}

/** 拼成最终文本 */
export function render(s, opts = {}) {
  if (opts.turns) return renderTurns(s, opts.turns, opts);

  const levels = buildLevels(s);
  const want = clampInt(opts.level, 1, levels.length, 1);
  const hit = levels[want - 1];
  const budget = clampInt(opts.maxChars, 200, 20000, want === 1 ? 4200 : 9000);
  const body = clip(hit.body, budget);

  const parts = [header(s), "", `【level ${want} · ${hit.title}】`, body];

  if (want < levels.length) {
    parts.push("", "── 信息不够就再要一层（同一会话再调一次，加 level）──");
    for (const n of levels.slice(want)) {
      parts.push(`  level=${n.level}  ${n.title}  ≈ +${tok(clip(n.body, 9000))} token`);
    }
    parts.push(`  当前 level=${want}，全文约 ${tok(body)} token`);
  } else {
    parts.push("", "── 已是最大粒度；再要原文请用 session_grep 指定关键词 ──");
  }
  return parts.join("\n");
}
