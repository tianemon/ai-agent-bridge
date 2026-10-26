/**
 * 输出层：默认只给"最新一条结论"，不够再往上要一层；
 * 调用方若已经知道要哪几轮，就用 turns 直接跳过去。
 *
 * 每层都自带「下一层要花多少 token」，让调用方决定停在哪。
 * 文案走 i18n（AAB_LANG / LANG），默认英文。
 */
import { execFileSync } from "node:child_process";
import { AGENT_LABEL } from "./registry.mjs";
import { t as tr } from "./i18n.mjs";

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
    "\n" + tr("common.truncated", { n: arr.length - max }) + "\n" +
    arr.slice(arr.length - tail).join("")
  );
}

const oneLine = (s, max = 120) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/**
 * 把一条结论压成"定成了什么"的一句话。
 * 表格行、粗体星号、链接地址、列表符号都不是结论，先剥掉再取第一句 ——
 * 否则时间线后半截全是 `| 方案 | 说明 |` 这种无效内容。
 */
const decisionLine = (s, max = 44) => {
  const text = String(s || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const one = (text.match(/^.{0,}?[。！？.!?](?=\s|$|[\u4e00-\u9fff])/) || [text.split(/[。！？\n]/)[0]])[0];
  const arr = [...one];
  return arr.length > max ? arr.slice(0, max).join("").trim() + "…" : one;
};

/** 截断必须留痕：路径/命令被切掉尾巴时，加省略号免得被当成完整值 */
const oneLineCut = (s, max) => {
  const t = oneLine(s, max + 1);
  return t.length > max ? t.slice(0, max) + "…" : t;
};

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
  if (log) lines.push(tr("l4.commits"), ...log.split("\n").map((l) => "  " + l));
  if (st) {
    const rows = st.split("\n").filter(Boolean);
    // 工作区是"整个仓库此刻的状态"，不一定都是这个会话改的：
    // 用会话里出现过的文件求交集，把归因说清楚，别让人误判上一家改了什么
    const touched = new Set((sessionFiles || []).map((f) => f.replace(/^\.\//, "")));
    const mine = rows.filter((r) => {
      const p = r.slice(3).trim();
      return touched.has(p) || [...touched].some((f) => f.endsWith("/" + p) || p.endsWith("/" + f));
    });
    lines.push(tr("l4.dirty", { n: rows.length }), tr("l4.dirty.overlap", { n: mine.length }));
    const ordered = [...mine, ...rows.filter((r) => !mine.includes(r))];
    lines.push(...ordered.slice(0, 20).map((l) => "  " + l));
    if (rows.length > 20) lines.push(tr("l4.more", { n: rows.length - 20 }));
  }
  return lines.join("\n");
}

const finalOf = (t) => (t.finals.length ? t.finals[t.finals.length - 1] : t.narration[t.narration.length - 1] || "");

function header(s) {
  const label = AGENT_LABEL[s.agent] || s.agent;
  const segs = s.files.length > 1 ? tr("hdr.segs", { n: s.files.length }) : "";
  const model = s.model ? ` · ${s.model}` : "";
  return [
    `■ ${label} · ${fmtTime(s.mtimeMs)}${segs}${model}`,
    tr("hdr.meta", {
      id: String(s.id).slice(0, 18),
      n: s.turns.length,
      cwd: s.cwd || tr("hdr.unknownPath"),
    }),
    // 标题：多个会话摆在面前时，这一行比 id 有用得多
    ...(s.title ? [tr("hdr.title", { t: s.title })] : []),
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
      ? tr("l1.ask", { i: last.i, q: oneLine(last.user, 160) }) +
        "\n\n" +
        (settled
          ? clip(finalOf(last), 4200)
          : tr("l1.note.pending") +
            "\n\n" +
            clip(finalOf(last) || tr("l1.note.empty"), 4200))
      : tr("l1.empty");

    // 未收尾时给一条退路：直接附上最近一条有结论的轮次，免得为了看一眼上一轮再调一次 level=2
    let fallback = "";
    if (last && !settled) {
      const prev = [...turns].reverse().find((t) => t.i !== last.i && t.finals.length);
      if (prev) {
        const tail = clip(finalOf(prev), 600);
        fallback = tr("l1.fallback", { i: prev.i, tok: tok(tail), txt: tail });
      }
    }
    levels.push({
      level: 1,
      title: settled ? tr("l1.title.ok") : tr("l1.title.pending"),
      body: body + fallback,
    });
  }

  // L2 最近 3 轮
  {
    const pick = turns.slice(-3);
    const body = pick
      .map((t) => {
        const q = clip(oneLine(t.user, 300), 300) || tr("l2.noUser");
        const a = clip(finalOf(t) || tr("l2.noFinal"), 900);
        return tr("l2.turn", { i: t.i, q, a });
      })
      .join("\n\n");
    levels.push({ level: 2, title: tr("l2.title", { n: pick.length }), body });
  }

  // L3 需求 + 结论（决策链）
  {
    // 每轮「要什么 → 定成了什么」：只有需求没有结论，读到的是纠结而不是决策。
    // 结论缺失时什么都不加（不写"（无结论）"，那是噪声）。
    const lines = turns.map((t) => {
      const mark = t.i === last?.i ? "▸" : " ";
      const a = decisionLine(finalOf(t), 44);
      return `${mark}${String(t.i).padStart(2, " ")}. ${oneLine(t.user, 100)}${a ? "  → " + a : ""}`;
    });
    // 一个会话可能被压缩多次（claude 实测单会话最多 11 次），只取最近两条
    const all = s.compaction || [];
    const comps = all.slice(-2);
    const comp = comps.length
      ? "\n\n" +
        comps
          .map((c, i) =>
            tr("l3.comp", {
              i: i + 1,
              n: comps.length,
              extra: all.length > comps.length ? tr("l3.comp.extra", { total: all.length, n: comps.length }) : "",
            }) + "\n" + clip(c, 1600)
          )
          .join("\n\n")
      : "";
    levels.push({ level: 3, title: tr("l3.title"), body: lines.join("\n") + comp });
  }

  // L4 工具 / 文件 / git
  {
    const files = new Map();
    const cmds = [];
    const tools = new Map();
    const noise = /(^|\/)(node_modules|dist|build|out|\.git|target|vendor)\//;
    const inRepo = (f) => !f.startsWith("/") || (s.cwd && f.startsWith(s.cwd + "/"));
    for (const t of turns) {
      for (const f of t.files) {
        if (noise.test(f) || !inRepo(f)) continue;
        files.set(f, (files.get(f) || 0) + 1);
      }
      for (const x of t.tools) {
        if (x.kind === "cmd") cmds.push(x.target);
        else tools.set(`${x.name}${x.target ? " · " + oneLineCut(x.target, 60) : ""}`, 1);
      }
    }
    const top = [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    const body = [
      tr("l4.files", { turns: turns.length, files: files.size }),
      ...top.map(([f, n]) => `  ${n}× ${f}`),
      "",
      tr("l4.cmds", { n: cmds.length }),
      ...cmds.slice(-15).map((c) => "  $ " + oneLineCut(c, 150)),
      "",
      tr("l4.tools", { n: tools.size }),
      ...[...tools.keys()].slice(0, 20).map((k) => "  - " + k),
      "",
      gitSnapshot(s.cwd, [...files.keys()]),
    ].join("\n");
    levels.push({ level: 4, title: tr("l4.title"), body });
  }

  return levels;
}

/** 指定轮次区间：调用方已经知道要看哪几轮时用它，比逐层加码省一轮往返 */
export function renderTurns(s, turns, { maxChars = 9000 } = {}) {
  const total = s.turns.length;
  if (!total) return tr("l1.empty");
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
  if (from > to) return tr("rng.bad", { from, to, total });
  const picked = s.turns.filter((t) => t.i >= from && t.i <= to);
  if (!picked.length) return tr("rng.none", { from, to, total });

  const body = picked
    .map((t) =>
      tr("l2.turn", {
        i: t.i,
        q: clip(oneLine(t.user, 600), 600) || tr("l2.noUser"),
        a: clip(finalOf(t) || tr("l2.noFinal"), 1200),
      })
    )
    .join("\n\n");

  return [header(s), "", tr("rng.head", { from, to, total }), clip(body, maxChars), "", tr("rng.hint")].join("\n");
}

/** 拼成最终文本 */
export function render(s, opts = {}) {
  if (opts.turns) return renderTurns(s, opts.turns, opts);

  const levels = buildLevels(s);
  const want = clampInt(opts.level, 1, levels.length, 1);
  const hit = levels[want - 1];
  const budget = clampInt(opts.maxChars, 200, 20000, want === 1 ? 4200 : 9000);
  const body = clip(hit.body, budget);
  const curTok = tok(body);

  const parts = [header(s), "", tr("lv.head", { n: want, title: hit.title }), body];

  if (want < levels.length) {
    parts.push("", tr("next.banner"));
    for (const n of levels.slice(want)) {
      const add = tok(clip(n.body, 9000));
      parts.push(tr("next.cost", { n: n.level, title: n.title, add, total: curTok + add }));
    }
    parts.push(tr("next.current", { n: want, tok: curTok }));
  } else {
    parts.push("", tr("next.maxed"));
  }
  return parts.join("\n");
}
