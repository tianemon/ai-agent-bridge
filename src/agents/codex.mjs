/**
 * Codex CLI / Codex Desktop
 *
 * 布局：${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-*.jsonl
 * 同一个 thread 续跑会新开一个文件（文件名带 `_<新 id>`），
 * 所以按 session_meta.session_id 归组，组内按 mtime 升序当"段"。
 */
import path from "node:path";
import os from "node:os";
import {
  eachLine,
  filesIn,
  textOf,
  looksInjected,
  newTurn,
  readHeadMeta,
  statSafe,
  walkFiles,
} from "./_shared.mjs";

const HOME = os.homedir();

function root() {
  return process.env.CODEX_HOME || path.join(HOME, ".codex");
}

function index() {
  const files = walkFiles(path.join(root(), "sessions"), (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"));
  const groups = new Map();
  for (const file of files) {
    const st = statSafe(file);
    if (!st) continue;
    const meta = readHeadMeta(file, 32768);
    const id = meta.id || path.basename(file);
    const g = groups.get(id) ?? { agent: "codex", id, cwd: meta.cwd, model: meta.model, files: [] };
    if (!g.cwd && meta.cwd) g.cwd = meta.cwd;
    if (!g.model && meta.model) g.model = meta.model;
    g.files.push({ file, mtimeMs: st.mtimeMs, size: st.size });
    groups.set(id, g);
  }
  for (const g of groups.values()) g.files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return [...groups.values()];
}

/* 只认 event_msg/item_completed：它是去重后的规范流，
 * response_item 是同一批内容的另一条流（用它会把每轮数成两份）。 */
async function parse(files) {
  const turns = [];
  const compaction = [];
  let cur = newTurn(1);
  const push = () => {
    if (cur.user || cur.finals.length) turns.push(cur);
  };

  for (const { file } of files) {
    await eachLine(file, (line) => {
      if (line.includes('"compacted"') && !line.includes('"item_completed"')) {
        const o = JSON.parse(line);
        if (o.type === "compacted") {
          const t = o.payload?.message || o.payload?.summary || o.summary || "";
          if (t) compaction.push(String(t).slice(0, 4000));
        }
        return;
      }
      if (!line.includes('"item_completed"')) return;
      const o = JSON.parse(line);
      const it = o?.payload?.item;
      if (!it) return;
      const ts = o.timestamp || "";

      if (it.type === "UserMessage") {
        const t = textOf(it.content);
        if (looksInjected(t)) return;
        push();
        cur = newTurn(turns.length + 1);
        cur.user = t;
        cur.userTs = ts;
        return;
      }
      if (it.type === "AgentMessage") {
        const t = textOf(it.content);
        if (!t) return;
        (it.phase === "final_answer" ? cur.finals : cur.narration).push(t);
        return;
      }
      if (it.type === "CommandExecution") {
        const cmd = Array.isArray(it.command) ? it.command[it.command.length - 1] : it.command;
        cur.tools.push({ kind: "cmd", name: "shell", target: String(cmd || "").slice(0, 300) });
        for (const f of filesIn(cmd)) cur.files.push(f);
        if (it.exit_code && it.exit_code !== 0) {
          cur.tools.push({ kind: "err", name: "exit", target: String(it.exit_code) });
        }
        return;
      }
      if (it.type === "McpToolCall") {
        const a = it.arguments || {};
        cur.tools.push({
          kind: "mcp",
          name: `${it.server || "mcp"}.${it.tool || "?"}`,
          target: String(a.path || a.file || a.query || a.title || "").slice(0, 200),
        });
        for (const f of filesIn(JSON.stringify(a).slice(0, 4000))) cur.files.push(f);
        return;
      }
      if (it.type === "Extension") {
        cur.tools.push({ kind: "web", name: it.kind || "web", target: String(it.query || "").slice(0, 200) });
        return;
      }
      if (it.type === "ImageView") {
        for (const f of filesIn(it.path)) cur.files.push(f);
      }
    });
  }
  push();
  return { turns, compaction };
}

export default { name: "codex", label: "Codex", root, index, parse };
