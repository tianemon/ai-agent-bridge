/**
 * WorkBuddy / CodeBuddy —— 同一套引擎写出的会话格式，一个模块带两家。
 *
 * 布局：${ROOT}/projects/<cwd 变形>/<session-uuid>.jsonl
 *       子代理 trace 在 <session-uuid>/subagents/*.jsonl，不算会话
 *
 * 行类型（实测）：
 *   message               role=user|assistant，content=[{type:"input_text"|"output_text", text}]
 *   function_call         工具调用（name + arguments）
 *   function_call_result  工具输出（丢弃）
 *   reasoning             思考（丢弃）
 *   file-history-snapshot 文件快照（丢弃，体积大头）
 *   session-meta          会话元信息
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  eachLine,
  textOf,
  looksInjected,
  userPromptOf,
  newTurn,
  readHeadMeta,
  jsonlByMtime,
  sameProject,
} from "./_shared.mjs";

const HOME = os.homedir();

function make({ name, label, dir, env }) {
  const root = () => process.env[env] || path.join(HOME, dir);

  function index(project) {
    const out = [];
    const base = path.join(root(), "projects");
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
      const cwd = meta.cwd || (d.name.startsWith("-") || !d.name.startsWith("/") ? "/" + d.name.split("-").slice(1).join("/") : d.name);
      if (project && !sameProject(cwd, project)) continue;
      for (const rec of files) {
        out.push({
          agent: name,
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
        if (!line.includes('"type":"message"') && !line.includes('"function_call"')) return;
        const o = JSON.parse(line);

        if (o.type === "message") {
          const raw = textOf(o.content) || textOf(o.message?.content);
          if (!raw) return;
          // WB/CB 会把 <system-reminder> 之类的包装拼在用户消息前面，先剥掉
          const t = o.role === "user" ? userPromptOf(raw) : raw;
          if (!t) return;
          if (o.role === "user") {
            if (looksInjected(t)) return;
            push();
            cur = newTurn(turns.length + 1);
            cur.user = t;
            cur.userTs = o.timestamp || "";
          } else if (o.role === "assistant") {
            // 这个格式没有 final/commentary 之分，最后一条 assistant 文本即结论
            cur.finals.push(t);
          }
          return;
        }

        if (o.type === "function_call") {
          const a = o.arguments ?? o.input ?? {};
          const target =
            (typeof a === "string" ? a : a.path || a.file_path || a.cmd || a.command || a.query || "") || "";
          cur.tools.push({ kind: "tool", name: o.name || o.tool || "tool", target: String(target).slice(0, 300) });
          return;
        }
      });
    }
    push();
    return { turns, compaction };
  }

  return { name, label, root, index, parse };
}

export const workbuddy = make({ name: "workbuddy", label: "WorkBuddy", dir: ".workbuddy", env: "WORKBUDDY_HOME" });
export const codebuddy = make({ name: "codebuddy", label: "CodeBuddy", dir: ".codebuddy", env: "CODEBUDDY_HOME" });
