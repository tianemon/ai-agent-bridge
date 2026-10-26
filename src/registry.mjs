/**
 * 工具注册表 —— 加一个新工具 = 在 agents/ 下加一个模块并登记到这里。
 *
 * 每个适配器只需实现：
 *   name    工具标识（CLI/MCP 里用的值）
 *   label   显示名
 *   root()  数据根目录（应支持各自的环境变量覆盖）
 *   index(project)  返回 {id, cwd, model, files:[{file, mtimeMs, size}]}
 *   parse(files)    返回 {turns, compaction}
 *   userTurnOf(o)   一行（已解析）是否开启新一轮：返回用户原文或 ""（parse 与 grep 共用）
 *   userMarker      廉价的字面预筛；含它才值得 JSON.parse 一次
 */
import codex from "./agents/codex.mjs";
import claude from "./agents/claude.mjs";
import easymint from "./agents/easymint.mjs";
import { workbuddy, codebuddy } from "./agents/codebuddy.mjs";
import { lastMtime, sameProject } from "./agents/_shared.mjs";

const LIST = [codex, claude, easymint, workbuddy, codebuddy];

export const AGENTS = LIST.map((a) => a.name);
export const AGENT_LABEL = Object.fromEntries(LIST.map((a) => [a.name, a.label]));
export const isAgent = (name) => AGENTS.includes(name);
export const getAgent = (name) => LIST.find((a) => a.name === name) || null;

/** 未知工具返回空，绝不静默当成"全部" */
export function indexAll(agent, project) {
  const wanted = agent && agent !== "auto" ? LIST.filter((a) => a.name === agent) : LIST;
  const out = [];
  for (const a of wanted) {
    for (const s of a.index(project)) {
      if (project && !sameProject(s.cwd, project)) continue;
      out.push({ ...s, mtimeMs: lastMtime(s) });
    }
  }
  return out;
}

const withSince = (rows, since) => (since ? rows.filter((r) => r.mtimeMs >= since) : rows);

/**
 * "最新一个会话" = 最近被写入的会话（跨工具可比）。
 * @param {object} o
 * @param {string} o.agent   工具名或 auto
 * @param {string} o.project 项目绝对路径，空则不按项目过滤
 * @param {number} o.since   只考虑这个时间点之后有活动的会话（ms）
 */
export function latestSession({ agent = "auto", project = "", since = 0 } = {}) {
  const rows = withSince(indexAll(agent, project), since);
  if (!rows.length) return null;
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows[0];
}

export function recentSessions({ agent = "auto", project = "", limit = 15, since = 0 } = {}) {
  return withSince(indexAll(agent, project), since)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);
}

/** 按 id 前缀找会话；不指定工具时在所有工具里找 */
export function findSession({ id, agent = "auto", project = "" }) {
  if (!id) return null;
  // 按最近活动排序：同前缀可能同时命中多家（如都以 01a1 开头），
  // 不排序就会按注册顺序返回 codex，而不是用户刚在用的那家
  const rows = indexAll(agent, project).sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows.find((r) => String(r.id).startsWith(id)) || null;
}
