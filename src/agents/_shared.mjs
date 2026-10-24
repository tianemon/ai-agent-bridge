/**
 * 各适配器共用的解析工具。
 *
 * 铁律：思考块、工具输出、base_instructions、file-history-snapshot 一律不解析。
 * 那些正是 900MB 里的大头，也是上下文毒药。
 */
import fs from "node:fs";
import readline from "node:readline";

const FILE_RE =
  /[\w@.\-/]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|css|scss|html|yml|yaml|toml|sh|sql)\b/g;

const MAX_READ_BYTES = 65536;

/** 流式逐行读，避免几十 MB 全量进内存 */
export async function eachLine(file, fn) {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (line.length < 2) continue;
      try {
        fn(line);
      } catch {
        /* 单行坏掉不影响整份 */
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

export function filesIn(text) {
  if (!text) return [];
  const out = new Set();
  for (const m of String(text).matchAll(FILE_RE)) out.add(m[0].replace(/^\.\//, ""));
  return [...out];
}

export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && (b.type === "text" || b.type === "Text" || b.type === "input_text"))
    .map((b) => b.text || "")
    .join("\n")
    .trim();
}

/** 用户消息里那些"注入的"条目不算需求 */
export function looksInjected(t) {
  const s = (t || "").trim();
  return !s || s.startsWith("<") || s.startsWith("# AGENTS") || s.startsWith("Caveat:");
}

export function newTurn(i) {
  return { i, user: "", userTs: "", finals: [], narration: [], tools: [], files: [] };
}

/**
 * 头部多行合并取元信息。
 * 各家把 cwd / model 放在不同位置（codex 在 session_meta，claude 在任意一条对话里），
 * 所以扫前若干行直到凑齐，别只看第一行。
 */
export function readHeadMeta(file, bytes = MAX_READ_BYTES) {
  const meta = { cwd: "", model: "", id: "" };
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    for (const line of buf.toString("utf8", 0, n).split("\n")) {
      if (!line.startsWith("{")) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const p = o.payload ?? o;
      if (!meta.cwd) meta.cwd = p.cwd || o.cwd || "";
      if (!meta.model) {
        meta.model =
          p.model || p.thread_settings?.model || o.message?.model || p.message?.model || "";
      }
      if (!meta.id) meta.id = p.session_id || p.id || o.sessionId || "";
      if (meta.cwd && meta.model && meta.id) break;
    }
  } catch {
    /* 读不到就当没有 */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return meta;
}

export function statSafe(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

/** 递归找文件；跳过隐藏目录与 node_modules */
export function walkFiles(dir, pick, depth = 0, acc = []) {
  if (depth > 6) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "subagents") continue;
      walkFiles(full, pick, depth + 1, acc);
    } else if (pick(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** 目录下直接的 .jsonl（不递归），按 mtime 降序 */
export function jsonlByMtime(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".jsonl"))
    .map((n) => `${dir}/${n}`)
    .map((f) => ({ file: f, stat: statSafe(f) }))
    .filter((x) => x.stat && x.stat.isFile())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
}

/** 规范化后精确比较：不做前缀猜测，宁可找不到也不串项目 */
export const norm = (p) => (p || "").replace(/\/+$/, "");
export const sameProject = (a, b) => !!a && !!b && norm(a) === norm(b);
export const lastMtime = (s) => (s.files.length ? Math.max(...s.files.map((f) => f.mtimeMs)) : 0);
