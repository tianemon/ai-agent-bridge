/**
 * "已知信息"入参归一。
 *
 * 调用方（模型）往往已经知道一部分事实：哪个工具、哪个项目、哪次会话、
 * 甚至哪几轮。显式传进来比让工具猜更准，也省一次全机扫描。
 *
 * 合并规则：显式参数 > known 里的同名字段；解析不了的字段忽略并回一条 warning。
 */

const TIME_UNIT = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "24h" / "90m" / "7d" / ISO 日期或时间 / 毫秒时间戳 → ms；不认识则 null */
export function parseSince(spec) {
  if (spec === undefined || spec === null || spec === "" || spec === "true") return null;
  if (typeof spec === "number") return spec > 1e11 ? spec : Date.now() - spec * TIME_UNIT.h;

  const s = String(spec).trim();
  const rel = s.match(/^(\d+(?:\.\d+)?)\s*([mhd])$/i);
  if (rel) return Date.now() - Number(rel[1]) * TIME_UNIT[rel[2].toLowerCase()];

  if (/^\d{12,}$/.test(s)) return Number(s);

  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * "12" / "12-14" / "last:3" / "from:30" / "around:40±2" → {from,to} | {last} | {around,span}
 * 单轮也按区间处理，渲染层统一走一条路径。
 */
export function parseTurns(spec) {
  if (spec === undefined || spec === null || spec === "" || spec === "true") return null;
  if (Array.isArray(spec) && spec.length >= 1) {
    const from = Number.parseInt(spec[0], 10);
    const to = spec.length > 1 ? Number.parseInt(spec[1], 10) : from;
    return Number.isFinite(from) ? { from, to: Number.isFinite(to) ? to : from } : null;
  }
  const s = String(spec).trim();
  const last = s.match(/^(?:last:|-)(\d+)$/i);
  if (last) return { last: Number(last[1]) };
  // from:30 → 第 30 轮到最新
  const from = s.match(/^from:(\d+)$/i);
  if (from) return { from: Number(from[1]) };
  // around:40 / around:40±3 / around:40+3 → 以第 40 轮为中心，前后各 span 轮
  const around = s.match(/^around:(\d+)(?:\s*(?:±|\+\/-?|\+-)\s*(\d+))?$/i);
  if (around) return { around: Number(around[1]), span: around[2] ? Number(around[2]) : 3 };
  const range = s.match(/^(\d+)\s*[-~]\s*(\d+)$/);
  if (range) return { from: Number(range[1]), to: Number(range[2]) };
  if (/^\d+$/.test(s)) return { from: Number(s), to: Number(s) };
  return null;
}

/** known 可以是对象，也可以是 JSON 字符串（模型侧拼参数更省事） */
function unpack(known) {
  if (!known || known === "true") return {};
  if (typeof known === "object") return known;
  try {
    const o = JSON.parse(String(known));
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

const clean = (v) => (v === undefined || v === null || v === "" || v === "true" ? undefined : v);

/**
 * @param {object} known   调用方给的已知信息
 * @param {object} explicit 显式参数（优先）
 * @returns {{agent,project,session,since,turns,keywords,warnings:string[]}}
 */
export function resolveInputs(known, explicit = {}) {
  const k = unpack(known);
  const warnings = [];

  const pick = (key) => clean(explicit[key]) ?? clean(k[key]);

  const since = parseSince(pick("since"));
  const turns = parseTurns(pick("turns"));
  if (pick("since") !== undefined && since === null) warnings.push(`since「${pick("since")}」无法解析，已忽略`);
  if (pick("turns") !== undefined && turns === null) warnings.push(`turns「${pick("turns")}」无法解析，已忽略`);

  const agent = pick("agent") && pick("agent") !== "auto" ? String(pick("agent")) : "auto";

  return {
    agent,
    project: pick("project") ? String(pick("project")) : "",
    session: pick("session") || pick("id") ? String(pick("session") || pick("id")) : "",
    since,
    turns,
    keywords: pick("keywords") ? String(pick("keywords")) : "",
    warnings,
  };
}
