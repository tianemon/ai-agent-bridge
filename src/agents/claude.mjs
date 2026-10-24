/**
 * Claude Code
 *
 * 布局：${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<cwd 变形>/<session-uuid>.jsonl
 * 一个 jsonl = 一个会话；`<session-id>/subagents/` 下的子代理 trace 不算会话。
 *
 * 目录名是 cwd 的变形（斜杠换横线），但变形规则不保证只有斜杠——
 * 带点、空格、下划线的路径可能对不上。所以目录名只用来落点，
 * 最终判据一律是文件头里的真实 cwd，避免把别的项目静默当成当前项目。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  eachLine,
  filesIn,
  textOf,
  looksInjected,
  newTurn,
  readHeadMeta,
  jsonlByMtime,
  sameProject,
} from "./_shared.mjs";

const HOME = os.homedir();

function root() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
}

function index(project) {
  const out = [];
  let dirs;
  try {
    dirs = fs.readdirSync(path.join(root(), "projects"), { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  for (const d of dirs) {
    const files = jsonlByMtime(path.join(root(), "projects", d.name));
    if (!files.length) continue;
    // 同一目录下所有会话共用 cwd，所以只读最新那个的头部
    const meta = readHeadMeta(files[0].file);
    const cwd = meta.cwd || (d.name.startsWith("-") ? "/" + d.name.split("-").slice(1).join("/") : "");
    if (project && !sameProject(cwd, project)) continue;
    for (const rec of files) {
      out.push({
        agent: "claude",
        model: meta.model,
        cwd,
        id: path.basename(rec.file, ".jsonl"),
        files: [{ file: rec.file, mtimeMs: rec.stat.mtimeMs, size: rec.stat.size }],
      });
    }
  }
  return out;
}

async function parse(files) {
  const turns = [];
  const compaction = [];
  let cur = newTurn(1);
  const push = () => {
    if (cur.user || cur.finals.length) turns.push(cur);
  };

  for (const { file } of files) {
    await eachLine(file, (line) => {
      if (line.includes('"summary"') && !line.includes('"assistant"') && !line.includes('"user"')) {
        const o = JSON.parse(line);
        if (o.type === "summary" && o.summary) compaction.push(String(o.summary).slice(0, 4000));
        return;
      }
      const isA = line.includes('"type":"assistant"');
      const isU = line.includes('"type":"user"');
      if (!isA && !isU) return;
      const o = JSON.parse(line);
      const m = o.message || {};

      if (isU) {
        if (o.isMeta) return;
        // 压缩摘要伪装成 user 消息（isCompactSummary）——它是"更早内容的摘要"，
        // 不是新的用户需求。单独收起来，只在 level 3 才露头。
        if (o.isCompactSummary) {
          const s = textOf(m.content);
          if (s) compaction.push(s.slice(0, 6000));
          return;
        }
        if (o.toolUseResult) return;
        const blocks = Array.isArray(m.content) ? m.content : [];
        const hasToolResult = blocks.some((b) => b?.type === "tool_result");
        const t = textOf(m.content);
        if (looksInjected(t) || (hasToolResult && !t)) return;
        push();
        cur = newTurn(turns.length + 1);
        cur.user = t;
        cur.userTs = o.timestamp || "";
        return;
      }

      const blocks = Array.isArray(m.content) ? m.content : [];
      for (const b of blocks) {
        if (b?.type === "text" && b.text?.trim()) cur.finals.push(b.text.trim());
        else if (b?.type === "tool_use") {
          const inp = b.input || {};
          const target = inp.file_path || inp.path || inp.command || inp.pattern || inp.url || "";
          cur.tools.push({ kind: "tool", name: b.name || "tool", target: String(target).slice(0, 300) });
          for (const f of filesIn(target)) cur.files.push(f);
        }
      }
    });
  }
  push();
  return { turns, compaction };
}

export default { name: "claude", label: "Claude Code", root, index, parse };
