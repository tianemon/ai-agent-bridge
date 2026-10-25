/**
 * EasyMint（内置 Mint 助手）
 *
 * 布局：${EASYMINT_HOME:-~/.easymint}/agent/sessions/--<cwd 斜杠换横线>--/<ts>_<id>.jsonl
 * 一个 jsonl = 一个会话；`subagents/` 下的子代理 trace 不算会话。
 * 同 claude：目录名只做落点，判据用文件头里的真实 cwd。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  eachLine,
  textOf,
  looksInjected,
  newTurn,
  readHeadMeta,
  clipTitle,
  jsonlByMtime,
  sameProject,
} from "./_shared.mjs";

const HOME = os.homedir();

function root() {
  return process.env.EASYMINT_HOME || path.join(HOME, ".easymint");
}

function index(project) {
  const out = [];
  const base = path.join(root(), "agent", "sessions");
  let dirs;
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  for (const d of dirs) {
    const files = jsonlByMtime(path.join(base, d.name));
    if (!files.length) continue;
    const meta = readHeadMeta(files[0].file);
    const cwd =
      meta.cwd || (d.name.startsWith("--") ? "/" + d.name.slice(2, -2).split("-").slice(1).join("/") : "");
    if (project && !sameProject(cwd, project)) continue;
    for (const rec of files) {
      // 文件名形如 2026-09-23T14-08-39-513Z_01a0ce98-....jsonl
      const stem = path.basename(rec.file, ".jsonl");
      const own = rec.file === files[0].file ? meta : readHeadMeta(rec.file);
      out.push({
        agent: "easymint",
        model: meta.model,
        cwd,
        title: clipTitle(own.firstUser),
        id: stem.includes("_") ? stem.slice(stem.indexOf("_") + 1) : stem,
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
      if (!line.includes('"message"')) return;
      const o = JSON.parse(line);
      if (o.type !== "message") return;
      const m = o.message || {};
      if (m.role !== "user" && m.role !== "assistant") return;
      const t = textOf(m.content) || (typeof m.sections?.body === "string" ? m.sections.body : "");
      if (!t) return;
      if (m.role === "user") {
        if (looksInjected(t)) return;
        push();
        cur = newTurn(turns.length + 1);
        cur.user = t;
        cur.userTs = o.timestamp || "";
      } else {
        // 不区分"旁白/结论"，最后一条 assistant 文本就是结论
        cur.finals.push(t);
      }
    });
  }
  push();
  return { turns, compaction };
}

export default { name: "easymint", label: "EasyMint", root, index, parse };
