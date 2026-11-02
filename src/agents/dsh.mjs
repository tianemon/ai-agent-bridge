/**
 * DeepSeek Harness（dsh）
 *
 * 布局：${DSH_HOME:-~/.dsh}/sessions/--<cwd 斜杠换横线>--/session-<uuid>/session.v4.jsonl.zstd
 *
 * 两个坑：
 * 1. **多帧 zstd**。每次追加压一个独立 frame（实测一条会话 69 个），而 Node 的
 *    zstdDecompressSync 只解第一个 frame —— 直接调用只能拿到 200 字节的会话头。
 *    必须按 frame 切开逐段解压。帧魔数也可能出现在压缩数据内部，所以切出来的段解压失败时
 *    要并回下一段，而不是丢弃。
 * 2. **同一会话目录里可能同时有两个文件**：session.jsonl.zstd（旧，version 0）与
 *    session.v4.jsonl.zstd（当前）。实测是同一段对话的两种编码，两个都读会把轮次算成两份，
 *    因此优先读 v4，缺失时退回旧文件。
 *
 * 索引走 storages/session_projcache/sessions/<id>.json（明文 JSON），里面有 cwd / 标题 /
 * 模型 / 轮数，不必解压。缓存缺失时才退回去解压会话头。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import {
  textOf,
  userPromptOf,
  looksInjected,
  newTurn,
  clipTitle,
  filesIn,
  statSafe,
  sameProject,
} from "./_shared.mjs";

const HOME = os.homedir();
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function root() {
  return process.env.DSH_HOME || path.join(HOME, ".dsh");
}

const zstd = () => (typeof zlib.zstdDecompressSync === "function" ? zlib.zstdDecompressSync : null);

/** 逐个解 zstd frame；段解压失败说明魔数是数据里的巧合，并到下一段继续 */
function* frames(buf) {
  const unzstd = zstd();
  if (!unzstd) return;
  if (buf.length < 4 || !buf.subarray(0, 4).equals(MAGIC)) {
    // 明文 JSONL 直接放行；二进制（未知压缩/加密）宁可读不到，也别当文本解析成垃圾
    if (buf.subarray(0, 512).includes(0)) return;
    yield buf;
    return;
  }
  const starts = [];
  let at = buf.indexOf(MAGIC);
  while (at !== -1) {
    starts.push(at);
    at = buf.indexOf(MAGIC, at + 4);
  }
  if (!starts.length || starts[0] !== 0) starts.unshift(0);
  let from = starts[0];
  for (let k = 1; k <= starts.length; k++) {
    const to = k < starts.length ? starts[k] : buf.length;
    if (to <= from) continue;
    try {
      const out = unzstd(buf.subarray(from, to));
      yield out;
      from = to;
    } catch {
      /* 魔数落在压缩数据内部：这一段不切，留给下一个候选点 */
    }
  }
}

function readAll(file) {
  try {
    return Buffer.concat([...frames(fs.readFileSync(file))]).toString("utf8");
  } catch {
    return "";
  }
}

/** 头部：只解前若干 frame，够取 cwd / 标题 / 模型就停 */
function readHead(file) {
  const meta = { cwd: "", title: "", model: "", firstUser: "" };
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return meta;
  }
  // 小文件直接全解（几十 KB，比按帧截断更准）；大文件只解到 24 帧 / 256KB
  const whole = buf.length <= 512 * 1024;
  const parts = [];
  let size = 0;
  for (const chunk of frames(buf)) {
    parts.push(chunk);
    size += chunk.length;
    if (!whole && (parts.length >= 24 || size >= 256 * 1024)) break;
  }
  for (const line of Buffer.concat(parts).toString("utf8").split("\n")) {
    if (!line.startsWith("{")) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const d = o.data || {};
    if (o.type === "session") {
      // cwd 在顶层，不在 data 里；写成 d.cwd 会让没有 projcache 的会话永远缺项目
      meta.cwd = meta.cwd || o.cwd || d.cwd || "";
      continue;
    }
    if (o.type === "session/title") {
      if (d.title) meta.title = d.title; // 多次改标题时后写的覆盖
      continue;
    }
    if (o.type === "model/selection") {
      meta.model = d.model || d.lastUsed?.model || meta.model;
      continue;
    }
    if (!meta.firstUser && o.type === "user/message") {
      const t = userTextOf(o);
      if (t) meta.firstUser = t;
    }
  }
  return meta;
}

/**
 * 会话目录里选一个文件：带版本号的优先，版本高的优先；无版本号的（v0 时代）垫底。
 * 不写死 v4 —— 上游换版本时不该整块失效。
 */
function transcript(dir) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => /^session(\.[\w-]+)*\.jsonl\.zstd$/.test(n));
  } catch {
    return "";
  }
  if (!names.length) return "";
  const ver = (n) => {
    const m = n.match(/\.v(\d+)\./);
    return m ? Number(m[1]) : -1;
  };
  names.sort((a, b) => ver(b) - ver(a) || a.length - b.length);
  return path.join(dir, names[0]);
}

function cacheOf(sid) {
  try {
    const p = path.join(root(), "storages", "session_projcache", "sessions", `${sid}.json`);
    const rec = JSON.parse(fs.readFileSync(p, "utf8")).record || {};
    return {
      cwd: rec.rows?.workingDirectory?.val || rec.identity?.cwd || "",
      title: rec.rows?.title?.val || "",
      model: rec.rows?.modelSelection?.val?.lastUsed?.model || "",
    };
  } catch {
    return null;
  }
}

/** 真正的用户提问：source.kind 必须是 user，且不是被注入的指令块 */
export function userTextOf(o) {
  if (o?.type !== "user/message") return "";
  const kind = o.data?.source?.kind;
  if (kind && kind !== "user") return "";
  const t = userPromptOf(textOf(o.data?.content));
  return t && !looksInjected(t) ? t : "";
}

export function userTurnOf(o) {
  return userTextOf(o);
}

function index(project) {
  const out = [];
  if (!zstd()) return out; // 没有原生 zstd（Node < 22.15）：这类会话读不了，别假装能读
  const base = path.join(root(), "sessions");
  let projects;
  try {
    projects = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  for (const p of projects) {
    const dir = path.join(base, p.name);
    let sessions;
    try {
      sessions = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const s of sessions) {
      if (!s.isDirectory() || !s.name.startsWith("session-")) continue;
      const file = transcript(path.join(dir, s.name));
      if (!file) continue;
      const st = statSafe(file);
      if (!st) continue;

      const cache = cacheOf(s.name);
      let cwd = cache?.cwd || "";
      let title = cache?.title || "";
      let model = cache?.model || "";
      let firstUser = "";
      if (!cwd || !title) {
        const head = readHead(file);
        cwd = cwd || head.cwd;
        title = title || head.title;
        model = model || head.model;
        firstUser = head.firstUser;
      }
      if (project && !sameProject(cwd, project)) continue;

      out.push({
        agent: "dsh",
        // 目录名带 session- 前缀；列表里统一成 uuid，和其他工具的 id 形态一致
        id: s.name.replace(/^session-/, ""),
        cwd,
        model,
        title: clipTitle(title || firstUser),
        files: [{ file, mtimeMs: st.mtimeMs, size: st.size }],
      });
    }
  }
  return out;
}

async function parse(files) {
  const turns = [];
  let cur = newTurn(1);
  const push = () => {
    if (cur.user || cur.finals.length) turns.push(cur);
  };

  for (const { file } of files) {
    const text = readAll(file);
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (!line.startsWith("{")) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const d = o.data || {};

      if (o.type === "user/message") {
        const t = userTextOf(o);
        if (!t) continue; // user-approval / runtime-context / skill-catalog 这类注入不算需求
        push();
        cur = newTurn(turns.length + 1);
        cur.user = t;
        cur.userTs = o.time ? new Date(o.time).toISOString() : "";
        continue;
      }

      if (o.type === "assistant/message") {
        const t = textOf(d.message?.content);
        if (!t) continue;
        // 同一轮第 2 次及以后的文本：前一次降级为旁白，最后一次才是结论
        if (cur.finals.length) cur.narration.push(...cur.finals);
        cur.finals = [t];
        continue;
      }

      if (o.type === "tool/call") {
        const name = d.name || "tool";
        let args = d.arguments;
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        if (!args || typeof args !== "object") args = {};
        if (name === "bash") {
          const cmd = String(args.command || "");
          cur.tools.push({ kind: "cmd", name: "bash", target: cmd.slice(0, 300) });
          for (const f of filesIn(cmd)) cur.files.push(f);
        } else {
          const target = String(args.file_path || args.path || args.pattern || args.query || "");
          cur.tools.push({ kind: "tool", name, target: target.slice(0, 200) });
          if (target) cur.files.push(target);
          for (const f of filesIn(JSON.stringify(args).slice(0, 2000))) cur.files.push(f);
        }
      }
    }
  }
  push();
  return { turns, compaction: [] };
}

/**
 * grep 降噪：这家的系统提示与注入指令都写在普通 text 块里，不按类型过滤就会命中
 * 「You are an AI agent powered by DeepSeek Harness」这类内容。
 */
export function grepSkip(o) {
  if (o?.type === "system/message") return true;
  if (o?.type === "tool/result") return true;
  if (o?.type === "agent/inbox/spliced") return true;
  if (o?.type === "user/message" && o.data?.source?.kind !== "user") return true;
  return false;
}

/** grep 用：磁盘上是 zstd，必须解压后逐行扫（grep.mjs 会优先用它） */
export function linesOf(file) {
  const text = readAll(file);
  return text ? text.split("\n") : [];
}

export default {
  name: "dsh",
  label: "DeepSeek Harness",
  root,
  index,
  parse,
  userTurnOf,
  userMarker: '"type":"user/message"',
  linesOf,
  grepSkip,
  // 没有原生 zstd（Node < 22.15）时这类会话读不了，doctor 用它解释原因
  available: () => !!zstd(),
};
