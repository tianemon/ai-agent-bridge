/**
 * MCP server（stdio，JSON-RPC 2.0，换行分隔）。
 *
 * 只实现 tools，不实现 resources / prompts。
 * 描述文案面向模型，写成英文为主 + 中文触发词：中文提问（「读一下 codex 最新会话」）
 * 与英文提问都能匹配到，且海外用户读到的不是一屏中文。
 */
import readline from "node:readline";
import { AGENTS, AGENT_LABEL } from "./registry.mjs";
import { actLatest, actRead, actList, actGrep } from "./cli.mjs";

import { VERSION } from "./version.mjs";
import { t as tr } from "./i18n.mjs";

export { VERSION };

/** 我们实际实现的协议版本；客户端要别的就回这个，不谎称支持 */
const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-30"];

const TOOL_LIST = "codex / Claude Code / WorkBuddy / EasyMint / CodeBuddy";

/**
 * 随 initialize 一起下发的提示（MCP 规范里的 InitializeResult.instructions，规范原文：宿主可以把它
 * 塞进系统提示，让模型知道这个 server 该怎么用）。工具描述只在模型主动检索工具时可见，
 * 这段则可能常驻上下文——所以触发词和"别做什么"都放这儿。
 */
const INSTRUCTIONS = [
  `aab reads another AI coding tool's session (${TOOL_LIST}) — newest conclusion first, deeper only if needed. `,
  'Trigger it whenever the user says "read the latest codex session", "where did claude get to", ',
  '"pick up what the other tool was doing" — 中文：「读一下 codex 最新会话」「claude 那边做到哪了」',
  '「接着上一个工具的活干」— call session_latest. Default level=1 (~120 tokens); raise the level only ',
  "if it is not enough, and anchor with turns when you already know which turns you need. ",
  "Do not parse rollout-*.jsonl or session sqlite by hand — one thread can exceed 50 MB and will blow up ",
  "the context. If aab doctor reports WorkBuddy as untrusted, tell the user to click ",
  "连接器 → 自定义连接器 → aab → 信任 (Connectors → Custom connectors → aab → Trust) — only a human can do that.",
].join("");

const KNOWN_SCHEMA = {
  type: "object",
  description:
    "What the caller already knows — passing it saves a guess. Explicit arguments win over same-named fields here. " +
    "Example: {agent:'codex', project:'/repo', session:'01a16729', turns:'last:5', since:'24h'}",
  properties: {
    agent: { type: "string", enum: AGENTS },
    project: { type: "string" },
    session: { type: "string" },
    turns: { type: "string" },
    since: { type: "string" },
  },
};

const TOOLS = [
  {
    name: "session_latest",
    description:
      `Read another AI coding tool's session (${TOOL_LIST}) starting from the newest conclusion. ` +
      'Use this for "read the latest codex session", "where did claude get to", "pick up what the other tool ' +
      'was doing"（中文：「读一下 codex 最新会话」「claude 那边做到哪了」「接着上一个工具的活干」）. ' +
      "level=1 (default) returns only the final conclusion, the cheapest possible answer; escalate only if " +
      "needed: 2 = last 3 turns, 3 = requirement timeline, 4 = commands/files/git state. Every reply ends with " +
      "the token cost of the next level. If you already know the project/session/turns, pass them — anchoring " +
      "beats guessing.",
    inputSchema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          enum: ["auto", ...AGENTS],
          default: "auto",
          description: "which tool; auto = newest across all of them",
        },
        level: { type: "integer", minimum: 1, maximum: 4, default: 1 },
        turns: {
          type: "string",
          description:
            "exact turns, takes precedence over level: 12-14 range | 12 single | last:5 last five | from:30 from turn 30 | around:40±2 window",
        },
        maxChars: {
          type: "integer",
          minimum: 200,
          maximum: 20000,
          description: "cap for this reply; defaults to 4200 at level 1 and 9000 otherwise",
        },
        since: { type: "string", description: "only sessions active in this window, e.g. 24h / 7d / 2026-10-23" },
        session: { type: "string", description: "session id or prefix, to anchor one specific session" },
        project: { type: "string", description: "absolute project path; empty = cwd (subdirectories resolve to the git root)" },
        scope: {
          type: "string",
          enum: ["auto", "project", "global"],
          default: "auto",
          description: "project = this project only, error if none; auto = fall back to the whole machine (noted)",
        },
        known: KNOWN_SCHEMA,
      },
    },
  },
  {
    name: "session_list",
    description:
      `List recent sessions across ${TOOL_LIST} (time, tool, project, id, size; multi-segment threads are ` +
      "marked). Use it when you are not sure which session is the newest, or want to see what has been running " +
      "in a project recently. 中文：不确定「最新那个」是哪一次时先用它。",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", enum: ["auto", ...AGENTS], default: "auto" },
        project: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 15 },
        since: { type: "string" },
        scope: { type: "string", enum: ["auto", "project", "global"], default: "auto" },
        known: KNOWN_SCHEMA,
      },
    },
  },
  {
    name: "session_read",
    description:
      `Read one specific session (by id prefix) from ${TOOL_LIST}, with the same level / turns controls. ` +
      "Use it when you already know which session it is, or after session_latest gave you an id. " +
      "中文：已知具体是哪次会话时用这个。",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "session id or prefix; empty = the newest one for that tool" },
        agent: { type: "string", enum: ["auto", ...AGENTS], default: "auto" },
        level: { type: "integer", minimum: 1, maximum: 4, default: 1 },
        turns: { type: "string", description: "12-14 | 12 | last:5 | from:30 | around:40±2" },
        maxChars: { type: "integer", minimum: 200, maximum: 20000 },
        project: { type: "string" },
        known: KNOWN_SCHEMA,
      },
    },
  },
  {
    name: "session_grep",
    description:
      `Keyword search inside recent sessions of ${TOOL_LIST} — up to 480 characters per hit, 8 hits by ` +
      "default; reasoning blocks are never searched. Use it only when the level ladder is not enough and you " +
      "need one specific detail; do not use it to dump a whole conversation. " +
      "中文：只在前面的 level 都不够、要确认某个具体细节时用。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        agent: { type: "string", enum: ["auto", ...AGENTS], default: "auto" },
        project: { type: "string" },
        since: { type: "string" },
        scope: { type: "string", enum: ["auto", "project", "global"], default: "auto" },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 8 },
        known: KNOWN_SCHEMA,
      },
      required: ["query"],
    },
  },
  {
    name: "session_agents",
    description:
      "List the tools whose sessions can be read on this machine, with their data directories — useful to " +
      "diagnose why one tool returns nothing.",
    inputSchema: { type: "object", properties: {} },
  },
];

const toOpts = (args = {}) => {
  const o = { ...args, _: [args.query || ""] };
  if (args.maxChars) o["max-chars"] = args.maxChars; // CLI 侧的参数名是 kebab-case
  return o;
};

async function callTool(name, args = {}) {
  const o = toOpts(args);
  switch (name) {
    case "session_latest":
      return actLatest(o);
    case "session_list":
      return actList(o);
    case "session_read":
      return actRead(o);
    case "session_grep":
      return actGrep(o);
    case "session_agents":
      return AGENTS.map((a) => `${a}  ${AGENT_LABEL[a]}`).join("\n");
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export function serveMcp() {
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    const { id, method, params } = req;
    if (method?.startsWith("notifications/")) return;

    if (method === "initialize") {
      const asked = params?.protocolVersion;
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "aab", version: VERSION },
          instructions: INSTRUCTIONS,
        },
      });
      return;
    }
    if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      try {
        const text = await callTool(params?.name, params?.arguments || {});
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } catch (e) {
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: tr("mcp.failed", { msg: e.message }) }], isError: true },
        });
      }
      return;
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${method}` } });
  });

  process.stderr.write("aab mcp ready\n");
}
