/** Metadata-only Codex accounting. Never loads conversation turns or emits content. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { walkFiles, statSafe } from "./agents/_shared.mjs";
import { parseSince } from "./known.mjs";
import { t } from "./i18n.mjs";

const FIELDS = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"];
const zero = () => Object.fromEntries(FIELDS.map(k => [k, 0]));
function numbers(raw) {
  if (!raw || typeof raw !== "object" || !Number.isFinite(raw.input_tokens) || !Number.isFinite(raw.output_tokens)) return null;
  const out = {};
  for (const k of FIELDS) {
    if (raw[k] !== undefined && (!Number.isFinite(raw[k]) || raw[k] < 0)) return null;
    out[k] = raw[k] ?? 0;
  }
  if (raw.total_tokens === undefined) out.total_tokens = out.input_tokens + out.output_tokens;
  if (out.cached_input_tokens > out.input_tokens || out.reasoning_output_tokens > out.output_tokens) return null;
  return out;
}
const add = (a, b) => { for (const k of FIELDS) a[k] += b[k]; };
async function lines(file, fn) {
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      // Skip bodies before JSON parsing. Only explicit top-level metadata record types qualify below.
      if (!/"(?:session_meta|turn_context|token_usage_record|event_msg|compacted)"/.test(line.slice(0, 220))) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      fn(o);
    }
  } finally { rl.close(); input.destroy(); }
}

/** Small first-record reader: unlike the conversation index, child threads are never merged by session_id. */
export function usageIndex(root = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")) {
  const groups = new Map();
  for (const file of walkFiles(path.join(root, "sessions"), n => n.startsWith("rollout-") && n.endsWith(".jsonl"))) {
    const st = statSafe(file);
    if (!st) continue;
    const fd = fs.openSync(file, "r");
    let o;
    try {
      const buf = Buffer.alloc(65536), size = fs.readSync(fd, buf, 0, buf.length, 0);
      o = JSON.parse(buf.toString("utf8", 0, size).split("\n")[0]);
    } catch { continue; } finally { fs.closeSync(fd); }
    if (o.type !== "session_meta") continue;
    const p = o.payload ?? {}, spawn = p.source?.subagent?.thread_spawn;
    const id = p.id || p.thread_id || p.session_id;
    if (typeof id !== "string") continue;
    const group = groups.get(id) ?? { id, parentId: spawn?.parent_thread_id || p.forked_from_id || null,
      agentPath: spawn?.agent_path || null, cwd: p.cwd || "", files: [], mtimeMs: 0 };
    group.files.push({ file, timestamp: o.timestamp || p.timestamp || "", mtimeMs: st.mtimeMs });
    group.mtimeMs = Math.max(group.mtimeMs, st.mtimeMs);
    groups.set(id, group);
  }
  for (const g of groups.values()) g.files.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.mtimeMs - b.mtimeMs);
  return [...groups.values()];
}

function boundary(value, label) {
  if (value === undefined || value === "") return null;
  const n = parseSince(value);
  if (n === null || !Number.isFinite(n)) throw new Error(t("usage.invalidTime", { name: label }));
  return n;
}
function rateSnapshot(p, timestamp) {
  if (!p || typeof p !== "object") return null;
  const out = { timestamp, limitId: p.limit_id ?? null };
  for (const key of ["primary", "secondary"]) {
    const v = p[key];
    if (v && Number.isFinite(v.used_percent)) out[key] = { usedPercent: v.used_percent, windowMinutes: v.window_minutes ?? null, resetsAt: v.resets_at ?? null };
  }
  return out.primary || out.secondary ? out : null;
}

export async function readUsageThread(thread, { since = null, until = null, turnId = null } = {}) {
  const records = [], fallback = [], rates = [], compactions = [], executions = new Map();
  const seen = new Set(), seenSnapshots = new Set(), missingFields = new Set();
  let context = { model: null, effort: null, serviceTier: null, turnId: null }, previous = null, invalid = 0, counterResets = 0;
  const selected = (ts, turn) => Number.isFinite(ts) && (since === null || ts >= since) && (until === null || ts <= until) && (!turnId || turn === turnId);
  for (const { file } of thread.files) {
    await lines(file, o => {
      const p = o.payload ?? {}, timestamp = o.timestamp, ts = Date.parse(timestamp);
      if (o.type === "turn_context") {
        context = { model: typeof p.model === "string" ? p.model : null, effort: p.effort ?? p.reasoning_effort ?? null,
          serviceTier: p.service_tier ?? null, turnId: p.turn_id ?? null };
      } else if (o.type === "event_msg" && ["task_started", "task_complete", "turn_aborted"].includes(p.type)) {
        const id = p.turn_id ?? context.turnId;
        if (id) {
          const previous = executions.get(id) ?? {};
          executions.set(id, { ...previous,
            ...(p.type === "task_started" ? { startedAt: p.started_at ?? timestamp, status: "running" } : {}),
            ...(p.type === "task_complete" ? { completedAt: p.completed_at ?? timestamp, durationMs: Number.isFinite(p.duration_ms) ? p.duration_ms : null, status: "completed" } : {}),
            ...(p.type === "turn_aborted" ? { completedAt: timestamp, status: "aborted" } : {}),
          });
        }
      } else if (o.type === "compacted") {
        if (selected(ts, context.turnId)) compactions.push(timestamp);
      } else if (o.type === "token_usage_record") {
        if (p.thread_id && p.thread_id !== thread.id) return;
        const turn = p.turn_id ?? context.turnId;
        const usage = numbers(p.usage);
        if (!usage) { invalid++; return; }
        for (const k of ["cached_input_tokens", "cache_write_input_tokens", "reasoning_output_tokens"]) if (p.usage[k] === undefined) missingFields.add(k);
        // response_id is stable across replayed/continued segments. No heuristic content deduplication.
        const key = p.response_id ? `${thread.id}:${p.response_id}` : `${thread.id}:${timestamp}:${o.ordinal ?? ""}:${JSON.stringify(usage)}`;
        if (seen.has(key)) return;
        seen.add(key);
        records.push({ timestamp, ts, ...context, turnId: turn, rootTurnId: p.root_turn_id ?? null, usage, selected: selected(ts, turn) || (turnId && p.root_turn_id === turnId && selected(ts, turnId)) });
      } else if (o.type === "event_msg" && p.type === "token_count") {
        const rate = rateSnapshot(p.rate_limits, timestamp);
        if (rate && selected(ts, context.turnId)) rates.push(rate);
        const total = numbers(p.info?.total_token_usage);
        if (!total) return;
        const key = `${timestamp}:${JSON.stringify(total)}`;
        if (seenSnapshots.has(key)) return;
        seenSnapshots.add(key);
        let usage;
        if (previous && FIELDS.every(k => total[k] === previous[k])) return;
        if (!previous) usage = total;
        else if (FIELDS.some(k => total[k] < previous[k])) {
          // A reset has no safe delta. Last usage is all that can be attributed without assuming zero.
          counterResets++;
          usage = numbers(p.info?.last_token_usage);
        } else usage = Object.fromEntries(FIELDS.map(k => [k, total[k] - previous[k]]));
        const initial = previous === null;
        previous = total;
        if (usage) fallback.push({ timestamp, ts, turnId: context.turnId, ...context, usage,
          selected: selected(ts, context.turnId), initial });
      }
    });
  }
  // Prefer per-response records; never add the parallel cumulative stream to them.
  const firstRecord = records.reduce((min, r) => Number.isFinite(r.ts) ? Math.min(min, r.ts) : min, Infinity);
  const useRecords = records.length > 0 && !(until !== null && until < firstRecord);
  const source = useRecords ? "token_usage_record" : "token_count_delta";
  const all = useRecords ? records : fallback;
  const rows = all.filter(r => r.selected);
  const total = zero(), groups = new Map(), turns = new Map();
  for (const row of rows) {
    add(total, row.usage);
    const key = JSON.stringify([row.model, row.effort, row.serviceTier]);
    const g = groups.get(key) ?? { model: row.model, effort: row.effort, serviceTier: row.serviceTier, responses: 0, tokens: zero(), maxInput: 0 };
    g.responses++; add(g.tokens, row.usage); g.maxInput = Math.max(g.maxInput, row.usage.input_tokens); groups.set(key, g);
    const turn = turns.get(row.turnId) ?? { id: row.turnId, first: row.timestamp, last: row.timestamp, responses: 0, tokens: zero() };
    turn.last = row.timestamp; turn.responses++; add(turn.tokens, row.usage); turns.set(row.turnId, turn);
  }
  return { id: thread.id, parentId: thread.parentId, agentPath: thread.agentPath, source,
    responses: rows.length, tokens: total, cacheHitPercent: total.input_tokens && !missingFields.has("cached_input_tokens") ? total.cached_input_tokens / total.input_tokens * 100 : null,
    first: rows[0]?.timestamp ?? null, last: rows.at(-1)?.timestamp ?? null,
    meanInput: rows.length ? total.input_tokens / rows.length : null, maxInput: rows.reduce((max, r) => Math.max(max, r.usage.input_tokens), 0),
    models: [...groups.values()], turns: [...turns.values()].map(turn => ({ ...turn, execution: executions.get(turn.id) ?? null })), compactions: compactions.length,
    rateLimits: rates.length ? { first: rates[0], last: rates.at(-1) } : null,
    coverage: { invalidRecords: invalid, missingFields: [...missingFields], counterResets, earlierCumulativeOnly: useRecords && fallback.some(r => r.selected && r.ts < firstRecord),
      initialCumulativeBaseline: !useRecords && rows.some(r => r.initial) },
  };
}

export async function sessionUsage({ agent = "codex", session, project = "", since, until, turnId, includeChildren = false, root } = {}) {
  if (agent !== "codex" && agent !== "auto") throw new Error(t("usage.unsupported", { agent }));
  const from = boundary(since, "since"), to = boundary(until, "until");
  if (from !== null && to !== null && from > to) throw new Error(t("usage.range"));
  const index = usageIndex(root);
  const candidates = index.filter(s => !project || path.resolve(s.cwd) === path.resolve(project));
  const matches = session ? candidates.filter(s => s.id.startsWith(session)) : candidates.filter(s => !s.parentId).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 1);
  if (!matches.length) throw new Error(t("usage.notFound"));
  if (matches.length > 1) throw new Error(t("usage.ambiguous"));
  const main = matches[0], selected = [main], ids = new Set([main.id]);
  if (includeChildren) {
    for (let i = 0; i < selected.length; i++) for (const child of index) {
      if (child.parentId === selected[i].id && !ids.has(child.id)) { ids.add(child.id); selected.push(child); }
    }
  }
  const threads = [];
  for (const thread of selected) threads.push(await readUsageThread(thread, { since: from, until: to, turnId }));
  const tokens = zero(); for (const thread of threads) add(tokens, thread.tokens);
  return { agent: "codex", session: main.id, filter: { since: from === null ? null : new Date(from).toISOString(), until: to === null ? null : new Date(to).toISOString(), turnId: turnId || null, includeChildren },
    tokens, responses: threads.reduce((n, s) => n + s.responses, 0), threads };
}

export function renderUsage(report) {
  const n = value => Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const out = [t("usage.header", { id: report.session }), t("usage.scope", { since: report.filter.since ?? "*", until: report.filter.until ?? "*", turn: report.filter.turnId ?? "*" }),
    t("usage.total", { responses: report.responses, threads: report.threads.length, input: n(report.tokens.input_tokens), cached: n(report.tokens.cached_input_tokens), output: n(report.tokens.output_tokens), reasoning: n(report.tokens.reasoning_output_tokens) }), t("usage.accounting")];
  for (const s of report.threads) {
    out.push(`\n${s.id}${s.agentPath ? ` (${s.agentPath})` : ""} · ${s.source}`,
      t("usage.thread", { responses: s.responses, input: n(s.tokens.input_tokens), cached: n(s.tokens.cached_input_tokens), output: n(s.tokens.output_tokens), hit: s.cacheHitPercent === null ? "?" : n(s.cacheHitPercent), mean: s.meanInput === null ? "?" : n(s.meanInput), max: n(s.maxInput), compactions: s.compactions }));
    if (!s.responses) out.push(t("usage.noRecords"));
    for (const m of s.models) out.push(t("usage.model", { model: m.model ?? "?", effort: m.effort ?? "?", tier: m.serviceTier ?? "?", responses: m.responses, input: n(m.tokens.input_tokens), output: n(m.tokens.output_tokens) }));
    // Bounded text; JSON preserves every turn for analysis.
    for (const turn of s.turns.slice(-15)) out.push(t("usage.turn", { id: turn.id ?? "?", first: turn.first, last: turn.last, responses: turn.responses, input: n(turn.tokens.input_tokens), output: n(turn.tokens.output_tokens) }));
    if (s.turns.length > 15) out.push(t("usage.moreTurns", { n: s.turns.length - 15 }));
    if (s.rateLimits) out.push(t("usage.rates", { data: JSON.stringify(s.rateLimits) }));
    if (s.coverage.earlierCumulativeOnly || s.coverage.initialCumulativeBaseline || s.coverage.invalidRecords || s.coverage.counterResets || s.coverage.missingFields.length) out.push(t("usage.coverage", { data: JSON.stringify(s.coverage) }));
  }
  out.push("\n" + t("usage.limitNote"));
  return out.join("\n");
}
