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
import { createRequire } from "node:module";
import {
  eachLine,
  textOf,
  looksInjected,
  userPromptOf,
  newTurn,
  readHeadMeta,
  clipTitle,
  filesIn,
  jsonlByMtime,
  sameProject,
} from "./_shared.mjs";

const HOME = os.homedir();
const requireCJS = createRequire(import.meta.url);

/**
 * 标题在 sqlite 的 sessions 表：`title` 是自动生成的，`custom_title` 是用户在界面上改的（优先）。
 * 表里永远是**当前值**（原地更新），所以读一次就是最新标题，不必去重。
 *
 * 用 node:sqlite（Node ≥ 22.5 内置）。老 Node 没有这个模块 → 标题退化为首个用户提问，
 * 不影响其他字段。ExperimentalWarning 会污染宿主日志，导入时临时屏蔽这一条。
 */
let sqliteMod;
function sqlite() {
  if (sqliteMod !== undefined) return sqliteMod;
  sqliteMod = null;
  try {
    const emit = process.emitWarning;
    process.emitWarning = (w, ...rest) => {
      const msg = typeof w === "string" ? w : w?.message || "";
      if (/SQLite is an experimental feature/i.test(msg)) return;
      emit.call(process, w, ...rest);
    };
    try {
      sqliteMod = requireCJS("node:sqlite");
    } finally {
      process.emitWarning = emit;
    }
  } catch {
    /* 没有 node:sqlite：标题走首个提问兜底 */
  }
  return sqliteMod;
}

/** session_id → 最新标题（custom_title 优先） */
export function dbTitles(root) {
  const mod = sqlite();
  if (!mod?.DatabaseSync) return new Map();
  for (const name of ["workbuddy.db", "codebuddy.db"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    let con;
    try {
      con = new mod.DatabaseSync(file, { readOnly: true });
      const rows = con.prepare("select id, title, custom_title from sessions").all();
      const map = new Map();
      for (const r of rows) {
        const t = String(r.custom_title || r.title || "").trim();
        if (r.id && t) map.set(String(r.id), t);
      }
      return map;
    } catch {
      /* 库被锁 / 表结构不同：退化为首个提问 */
    } finally {
      try {
        con?.close();
      } catch {
        /* ignore */
      }
    }
  }
  return new Map();
}

/** 一行（已解析）是否开启新一轮：返回用户原文，否则空串。parse 与 grep 共用。 */
export function userTurnOf(o) {
  if (!o || o.type !== "message" || o.role !== "user") return "";
  const raw = textOf(o.content) || textOf(o.message?.content);
  if (!raw) return "";
  const t = userPromptOf(raw);
  return t && !looksInjected(t) ? t : "";
}

function make({ name, label, dir, env }) {
  const root = () => process.env[env] || path.join(HOME, dir);

  function index(project) {
    const out = [];
    const names = dbTitles(root());
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
        const id = path.basename(rec.file, ".jsonl");
        const own = rec.file === files[0].file ? meta : readHeadMeta(rec.file);
        out.push({
          agent: name,
          model: meta.model,
          cwd,
          id,
          title: clipTitle(names.get(id) || own.firstUser),
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
          if (o.role === "user") {
            // WB/CB 会把 <system-reminder> 之类的包装拼在用户消息前面，userTurnOf 会剥掉
            const t = userTurnOf(o);
            if (!t) return;
            push();
            cur = newTurn(turns.length + 1);
            cur.user = t;
            cur.userTs = o.timestamp || "";
            return;
          }
          if (o.role === "assistant") {
            const t = textOf(o.content) || textOf(o.message?.content);
            if (!t) return;
            // 这个格式没有 final/commentary 之分，最后一条 assistant 文本即结论
            cur.finals.push(t);
          }
          return;
        }

        if (o.type === "function_call") {
          // WB/CB 把参数写成 JSON 字符串（实测 175/175）；不解析就只能把整串当目标，
          // level 4 会既数不出命令、也提不出文件。
          let a = o.arguments ?? o.input ?? {};
          if (typeof a === "string") {
            try {
              a = JSON.parse(a);
            } catch {
              a = {};
            }
          }
          if (!a || typeof a !== "object") a = {};
          const cmd = typeof a.command === "string" ? a.command : typeof a.cmd === "string" ? a.cmd : "";
          const target =
            (typeof a.path === "string" && a.path) ||
            (typeof a.file_path === "string" && a.file_path) ||
            (typeof a.pattern === "string" && a.pattern) ||
            (typeof a.query === "string" && a.query) ||
            (typeof a.url === "string" && a.url) ||
            cmd;
          cur.tools.push({
            kind: cmd ? "cmd" : "tool",
            name: o.name || o.tool || "tool",
            target: String(target).slice(0, 300),
          });
          for (const f of filesIn(JSON.stringify(a).slice(0, 4000))) cur.files.push(f);
          return;
        }
      });
    }
    push();
    return { turns, compaction };
  }

  return { name, label, root, index, parse, userTurnOf, userMarker: '"role":"user"' };
}

export const workbuddy = make({ name: "workbuddy", label: "WorkBuddy", dir: ".workbuddy", env: "WORKBUDDY_HOME" });
export const codebuddy = make({ name: "codebuddy", label: "CodeBuddy", dir: ".codebuddy", env: "CODEBUDDY_HOME" });
