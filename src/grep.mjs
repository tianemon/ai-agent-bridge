/**
 * 关键词定点检索：只回命中附近的片段，不把整段对话捞出来。
 * 流式读文件，内存不随文件大小涨；命中够数立刻停。
 */
import fs from "node:fs";
import readline from "node:readline";
import { AGENT_LABEL, recentSessions } from "./registry.mjs";
import { t as tr } from "./i18n.mjs";

const SNIPPET = 480;
const LEAD = 220;

/** 流式扫一个文件；onLine 返回 true 表示够了，立刻停 */
async function scanFile(file, onLine) {
  let stream;
  let rl;
  try {
    stream = fs.createReadStream(file, { encoding: "utf8" });
    rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (onLine(line)) return;
    }
  } catch {
    /* 单个文件读不了不影响其它 */
  } finally {
    if (rl) rl.close();
    if (stream) stream.destroy();
  }
}

/** 从一条 jsonl 里挖出所有"非思考"且包含关键词的长字符串 */
function harvest(rawLine, lower) {
  const out = [];
  const SKIP_KEYS = new Set([
    "thinking",
    "thinkingSignature",
    "raw_content",
    "summary_text",
    "base_instructions",
    "encrypted_content",
  ]);
  const walk = (v, key) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string") {
      if (v.length > 20 && !SKIP_KEYS.has(key) && v.toLowerCase().includes(lower)) out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, key);
      return;
    }
    if (typeof v === "object") {
      if (v.type === "thinking" || v.type === "tool_result") return;
      for (const [k, x] of Object.entries(v)) walk(x, k);
    }
  };
  try {
    walk(JSON.parse(rawLine), "");
  } catch {}
  return out;
}

/**
 * @returns {Promise<string>} 直接可读的片段列表
 */
export async function grepSessions({ query, agent = "auto", project = "", since = 0, limit = 8 }) {
  const lower = String(query).toLowerCase();
  const hits = [];
  /* 同一段文本在一条 rollout 里常出现两次（event_msg 的规范流 + metadata/response_item 的转义副本），
   * 不归一化就会把一处命中报成两处、白白吃掉 limit。归一化只用于判重，不改展示内容：
   * 先整体删掉 \n \r \t \" \\ 这类两字转义，再只留字母数字与汉字——否则字面 \n 会残留一个字母 n，
   * 两版永远判不成同一处。 */
  const seen = new Set();
  const normOf = (s) => s.replace(/\\[nrt"\\]/g, "").replace(/[^\p{L}\p{N}]/gu, "");

  for (const s of recentSessions({ agent, project, since, limit: 8 })) {
    for (const f of s.files) {
      await scanFile(f.file, (line) => {
        if (!line.toLowerCase().includes(lower)) return false;
        const cands = harvest(line, lower);
        const text = cands.sort((x, y) => y.length - x.length)[0];
        if (text) {
          const i = text.toLowerCase().indexOf(lower);
          const snip = text.slice(Math.max(0, i - LEAD), Math.max(0, i - LEAD) + SNIPPET).replace(/\s+/g, " ").trim();
          /* key 以命中词为中心取对称窗口：副本之间的差异都在命中点之前（多一层转义的 \n），
           * 用整段 snip 判重会因窗口起点不同而失效。 */
          const key = normOf(text.slice(Math.max(0, i - 60), i + lower.length + 60));
          if (snip && key && !seen.has(key)) {
            seen.add(key);
            hits.push(
              `[${AGENT_LABEL[s.agent]} · ${String(s.id).slice(0, 8)} · ${(s.cwd || "").split("/").pop()}]\n  …${snip}…`
            );
          }
        }
        return hits.length >= limit;
      });
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }

  if (!hits.length) return tr("grep.none", { q: query });
  return `${hits.join("\n\n")}\n\n${tr("grep.footer", { n: hits.length })}`;
}
