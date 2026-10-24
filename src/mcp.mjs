/**
 * MCP server（stdio，JSON-RPC 2.0，换行分隔）。
 *
 * 只实现 tools，不实现 resources / prompts。
 */
import readline from "node:readline";
import { AGENTS, AGENT_LABEL } from "./registry.mjs";
import { actLatest, actRead, actList, actGrep } from "./cli.mjs";

import { VERSION } from "./version.mjs";

export { VERSION };

/** 我们实际实现的协议版本；客户端要别的就回这个，不谎称支持 */
const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-30"];

/**
 * 随 initialize 一起下发的提示（MCP 规范里的 InitializeResult.instructions，规范原文：宿主可以把它
 * 塞进系统提示，让模型知道这个 server 该怎么用）。工具描述只在模型主动检索工具时可见，
 * 这段则可能常驻上下文——所以触发词和"别做什么"都放这儿。
 */
const INSTRUCTIONS = [
  "aab：读【另一个 AI 编码工具】（codex / Claude Code / WorkBuddy / EasyMint / CodeBuddy）的会话。",
  "用户说「读一下 codex 最新会话」「claude 那边做到哪了」「接着上一个工具的活干」时，用 session_latest，",
  "默认 level=1（约 100 token），不够再逐层加 level；已知轮次用 turns 直接锚定。",
  "不要用 shell 手工解析 rollout-*.jsonl 或会话 sqlite —— 单条线程可达 50MB 以上，会把上下文撑爆。",
  "若 aab doctor 显示 WorkBuddy 未信任，把「连接器 → 自定义连接器 → aab → 信任」原样告诉用户——这一步只能人来点。",
].join("");

const KNOWN_SCHEMA = {
  type: "object",
  description:
    "调用方已经知道的信息，传了就少猜一次。显式参数优先于这里的同名字段。例：{agent:'codex', project:'/repo', session:'01a16729', turns:'last:5', since:'24h'}",
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
      "读【另一个 AI 编码工具】的会话：codex / Claude Code / WorkBuddy / EasyMint / CodeBuddy 的最新进展（「读一下 codex 最新会话」「claude 那边做到哪了」「接着上一个工具的活干」都用这个）。从最后一条结论开始，信息不够再加 level：默认 level=1 只给最后一条结论（最省上下文）；不够再调 level=2（最近 3 轮问答）→3（全部需求时间线）→4（命令/文件/git）。返回末尾标明更高层的 token 代价。若已知项目/会话/轮次，用 project/session/turns 直接锚定，比让它自己猜更准。",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", enum: ["auto", ...AGENTS], default: "auto", description: "哪个工具；auto=三家里最近的" },
        level: { type: "integer", minimum: 1, maximum: 4, default: 1 },
        turns: { type: "string", description: "直接要某几轮，例如 12-14 或 last:5（优先于 level）" },
        since: { type: "string", description: "只要这段时间内有活动的会话，例如 24h / 7d / 2026-10-23" },
        session: { type: "string", description: "会话 id 或前缀，锚定某一次会话" },
        project: { type: "string", description: "项目绝对路径；留空=当前工作目录（子目录归到 git 根）" },
        scope: { type: "string", enum: ["auto", "project", "global"], default: "auto", description: "project=只在本项目，找不到就报错；auto=找不到退全机并注明" },
        known: KNOWN_SCHEMA,
      },
    },
  },
  {
    name: "session_list",
    description:
      "列出 codex / Claude Code / WorkBuddy / EasyMint / CodeBuddy 最近的会话（时间、工具、项目、会话 id、体积）。不确定「最新那个」是哪一次、或想看某个项目最近的几轮都是谁在跑时先用它。",
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
    description: "读 codex / Claude Code / WorkBuddy / EasyMint / CodeBuddy 里指定的那次会话（按 id 前缀），走同样的 level / turns 控制。已知具体是哪次会话（或已从 session_latest 拿到 id）时用这个。",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "会话 id 或前缀；留空=该工具最新一个" },
        agent: { type: "string", enum: ["auto", ...AGENTS], default: "auto" },
        level: { type: "integer", minimum: 1, maximum: 4, default: 1 },
        turns: { type: "string", description: "例如 12-14 或 last:5" },
        project: { type: "string" },
        known: KNOWN_SCHEMA,
      },
    },
  },
  {
    name: "session_grep",
    description:
      "在 codex / Claude Code / WorkBuddy / EasyMint / CodeBuddy 最近的会话里按关键词定点找片段（每处最多 480 字，默认 8 处），思考块不参与匹配。只在前面的 level 都不够、需要确认某个具体细节时用；不要用它把整段对话捞出来。",
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
    description: "列出本机支持读取的工具，以及各自的数据目录（用于诊断“为什么读不到某家的会话”）。",
    inputSchema: { type: "object", properties: {} },
  },
];

const toOpts = (args = {}) => ({ ...args, _: [args.query || ""] });

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
          result: { content: [{ type: "text", text: `失败：${e.message}` }], isError: true },
        });
      }
      return;
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${method}` } });
  });

  process.stderr.write("aab mcp ready\n");
}
