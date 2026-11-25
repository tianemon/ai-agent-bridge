/** 按轮次渲染会话结论。 */
import { AGENT_LABEL } from "./registry.mjs";
import { t as tr } from "./i18n.mjs";

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

function fmtTime(ms) {
  if (!ms) return "?";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

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

/** 默认读取最后一轮，显式区间沿用相同的输出格式。 */
export function renderTurns(s, turns = { last: 1 }, { maxChars } = {}) {
  const total = s.turns.length;
  if (!total) return tr("turn.empty");
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

  const budget = clampInt(maxChars, 200, 20000, picked.length === 1 ? 4200 : 9000);
  const body = picked
    .map((turn) => tr("turn.final", { i: turn.i, text: turn.finals.at(-1) || tr("turn.noFinal") }))
    .join("\n\n");

  return [header(s), "", tr("rng.head", { from, to, total }), clip(body, budget)].join("\n");
}

export function render(s, opts = {}) {
  return renderTurns(s, opts.turns ?? undefined, opts);
}
