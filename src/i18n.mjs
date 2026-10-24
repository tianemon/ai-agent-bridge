/**
 * 输出层文案的语言选择。
 *
 * 只覆盖"给人看的输出"（ladder / doctor / install 的可见文本）；
 * CLI 的报错提示暂不翻译——那是开发者自己终端里看的。
 *
 * 选择顺序：AAB_LANG > LC_ALL / LC_MESSAGES / LANG > 默认 en
 */

const DICT = {
  zh: {
    "common.truncated": "…（截断 {n} 字）…",
    "hdr.segs": " · 续跑 {n} 段",
    "hdr.meta": "  会话 {id} · 共 {n} 轮需求 · {cwd}",
    "hdr.unknownPath": "路径未知",

    "l1.title.ok": "最新一条结论",
    "l1.title.pending": "最新进展（未收尾）",
    "l1.ask": "第 {i} 轮 · 用户问：{q}",
    "l1.note.pending": "（该轮没有收尾结论——会话可能中断、仍在运行，或最后一条只是进展旁白）",
    "l1.note.empty": "（该轮没有任何文本输出）",
    "l1.empty": "（这个会话里没有解析到对话内容）",
    "l1.fallback": "\n\n── 退路：最近一条结论在第 {i} 轮（约 +{tok} token）──\n{txt}",

    "l2.title": "最近 {n} 轮问答",
    "l2.turn": "── 第 {i} 轮 ──\n问：{q}\n论：{a}",
    "l2.noUser": "（无用户输入，可能由应用侧自动发起）",
    "l2.noFinal": "（无文本结论）",

    "l3.title": "全部需求时间线",
    "l3.comp": "[压缩摘要 {i}/{n}{extra}]",
    "l3.comp.extra": "（会话共被压缩 {total} 次，此处只取最近 {n} 次）",

    "l4.title": "命令 / 文件 / git 状态",
    "l4.files": "改动过的文件（整段会话 {turns} 轮累计，共 {files} 个，按出现次数）",
    "l4.cmds": "命令（{n} 条，取最后 15 条）",
    "l4.tools": "工具调用（{n} 种）",
    "l4.dirty": "工作区未提交（{n} 项，整个仓库的当前状态）",
    "l4.dirty.overlap": "  其中与本会话改动文件重合 {n} 项，其余可能来自其它工具/其它会话",
    "l4.more": "  …还有 {n} 项",
    "l4.commits": "最近提交：",

    "next.banner": "── 信息不够就再要一层（同一会话再调一次，加 level）──",
    "next.cost": "  level={n}  {title}  ≈ +{tok} token",
    "next.current": "  当前 level={n}，全文约 {tok} token",
    "next.maxed": "── 已是最大粒度；再要原文请用 session_grep 指定关键词 ──",

    "lv.head": "【level {n} · {title}】",
    "rng.head": "【第 {from}-{to} 轮 · 共 {total} 轮】",
    "rng.hint": "（按需指定区间；不给 turns 时走 level 阶梯，从最新结论开始）",
    "rng.bad": "轮次区间无效：{from}-{to}（会话共 {total} 轮）",
    "rng.none": "会话里没有第 {from}-{to} 轮（共 {total} 轮）",

    "doc.runtime": "■ 运行时",
    "doc.sources": "■ 会话来源（能读谁的会话）",
    "doc.hosts": "■ 宿主（哪个客户端挂了 MCP）",
    "doc.scope": "■ 当前作用域",
    "doc.conclusion": "结论：",
    "doc.sessions": "{n} 个会话，最近 {ago}",
    "ago.none": "无",
    "ago.days": "{n} 天前",
    "ago.hours": "{n} 小时前",
    "ago.now": "刚刚",
    "doc.missingDir": "目录不存在，跳过",
    "doc.node.hint": "（这是宿主自带的 node；写进配置时会改用 {node}）",
    "doc.mode.dev": "开发目录（开发态：配置指向源码，正式使用应装 npm 版）",
    "doc.mode.installed": "npm 全局安装（正式安装）",
    "doc.mode.npx": "npx 缓存",
    "doc.path.missing": "未装到 PATH（npx / 绝对路径调用不受影响）",
    "doc.c.needInstall": "{hosts} 已安装但没注册 → 跑 aab install",
    "doc.c.none": "没检测到任何支持 MCP 的客户端。哪个客户端要用，就在它的设置里加一条 MCP：npx -y @tianemon/ai-agent-bridge mcp",
    "doc.c.untrusted": "配置都写好了，但 WorkBuddy 还没点信任 → 连接器 → 自定义连接器 → aab → 信任（点完新开会话）",
    "doc.c.ok": "已安装的客户端都已注册。改完配置需新开会话（WorkBuddy 可能还要点一次 Trust）。",
  },

  en: {
    "common.truncated": "…({n} chars clipped)…",
    "hdr.segs": " · {n} segments",
    "hdr.meta": "  session {id} · {n} turns · {cwd}",
    "hdr.unknownPath": "unknown path",

    "l1.title.ok": "latest conclusion",
    "l1.title.pending": "latest progress (unfinished)",
    "l1.ask": "turn {i} · asked: {q}",
    "l1.note.pending": "(this turn has no conclusion — the session may be interrupted, still running, or the last message was only a progress note)",
    "l1.note.empty": "(this turn produced no text)",
    "l1.empty": "(no conversation content parsed from this session)",
    "l1.fallback": "\n\n── fallback: last conclusion was turn {i} (~+{tok} token) ──\n{txt}",

    "l2.title": "last {n} turns",
    "l2.turn": "── turn {i} ──\nQ: {q}\nA: {a}",
    "l2.noUser": "(no user input — probably started by the app itself)",
    "l2.noFinal": "(no text conclusion)",

    "l3.title": "full requirement timeline",
    "l3.comp": "[compaction summary {i}/{n}{extra}]",
    "l3.comp.extra": " (session was compacted {total} times; showing the last {n})",

    "l4.title": "commands / files / git state",
    "l4.files": "files touched ({turns} turns cumulative, {files} distinct, by frequency)",
    "l4.cmds": "commands ({n}, last 15)",
    "l4.tools": "tool calls ({n} kinds)",
    "l4.dirty": "uncommitted changes ({n} entries — the repo as it is now)",
    "l4.dirty.overlap": "  {n} of them overlap with files this session touched; the rest may come from other tools/sessions",
    "l4.more": "  …and {n} more",
    "l4.commits": "recent commits:",

    "next.banner": "── not enough? ask for one more level (same session, higher level) ──",
    "next.cost": "  level={n}  {title}  ≈ +{tok} token",
    "next.current": "  currently level={n}, this output ≈ {tok} token",
    "next.maxed": "── finest grain reached; use session_grep with a keyword for raw text ──",

    "lv.head": "【level {n} · {title}】",
    "rng.head": "【turns {from}-{to} of {total}】",
    "rng.hint": "(explicit slice; without turns the level ladder starts from the newest conclusion)",
    "rng.bad": "invalid turn range: {from}-{to} (session has {total} turns)",
    "rng.none": "session has no turns {from}-{to} (it has {total})",

    "doc.runtime": "■ runtime",
    "doc.sources": "■ sources (whose sessions can be read)",
    "doc.hosts": "■ hosts (which client has the MCP server)",
    "doc.scope": "■ scope",
    "doc.conclusion": "Conclusion: ",
    "doc.sessions": "{n} sessions, latest {ago}",
    "ago.none": "never",
    "ago.days": "{n}d ago",
    "ago.hours": "{n}h ago",
    "ago.now": "just now",
    "doc.missingDir": "directory missing, skipped",
    "doc.node.hint": "(bundled node from the host; configs will use {node})",
    "doc.mode.dev": "dev checkout (configs point at source; use an installed copy in production)",
    "doc.mode.installed": "installed via npm",
    "doc.mode.npx": "npx cache",
    "doc.path.missing": "not on PATH (npx / absolute invocation still work)",
    "doc.c.needInstall": "{hosts} installed but not registered → run aab install",
    "doc.c.none": "no MCP-capable client detected. In whichever client you use, add an MCP entry: npx -y @tianemon/ai-agent-bridge mcp",
    "doc.c.untrusted": "configs are written, but WorkBuddy is not trusted yet → 连接器 → 自定义连接器 → aab → 信任 (then open a new session)",
    "doc.c.ok": "every installed client is registered. Open a new session after config changes (WorkBuddy may also need one Trust click).",
  },
};

function detect() {
  const explicit = (process.env.AAB_LANG || "").trim().toLowerCase();
  const raw = explicit || (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "").trim().toLowerCase();
  if (raw.startsWith("zh")) return "zh";
  if (raw.startsWith("en")) return "en";
  return explicit === "zh" ? "zh" : "en";
}

const LANG = detect();

export const lang = () => LANG;

/** t("l1.ask", { i: 41, q: "..." }) */
export function t(id, vars = {}) {
  const s = DICT[LANG]?.[id] ?? DICT.zh[id] ?? id;
  return String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
}

export const isZh = () => LANG === "zh";

/** 两种语言的键必须一一对应；返回缺失明细（测试用） */
export function validateDict() {
  const zh = Object.keys(DICT.zh);
  const en = Object.keys(DICT.en);
  return {
    missingInEn: zh.filter((k) => !(k in DICT.en)),
    missingInZh: en.filter((k) => !(k in DICT.zh)),
    size: zh.length,
  };
}
