/**
 * 打印一段「常驻规则」，由用户粘进宿主的项目规则文件。
 *
 * 为什么需要这个命令：
 *   MCP 的 InitializeResult.instructions 规范原文是「宿主**可以**把它塞进系统提示」——可选的。
 *   WorkBuddy 实测没塞：模型上下文里只有 5 个裸工具名（还是 deferred，要主动检索才看得到描述），
 *   于是用户说「查看 codex 会话」时，模型很可能先去 ls ~/.codex/sessions 自己解析 jsonl。
 *   工具描述再怎么优化，也只是提高"检索命中率"；只有落在宿主每个会话都会读的文件里才是确定性的。
 *
 * 落点（各宿主都读项目根，不是全局）：
 *   WorkBuddy   -> CLAUDE.md / AGENTS.md
 *   Codex       -> AGENTS.md
 *   Claude Code -> CLAUDE.md
 * 所以只给片段，不替用户选文件——写错文件等于没写，还会污染别人的仓库。
 *
 * 输出只含规则本体（从 ### 起）：粘进 CLAUDE.md 不能带标题层级错位；
 * 「粘到哪个文件」这类元信息走 stderr，免得被一起复制进去。
 */
import { isZh } from "./i18n.mjs";

const ZH = `### 读其它 AI 工具的会话（aab）

读 / 查其他 AI 编码工具（codex / claude / codebuddy / workbuddy）的会话时，**一律走 aab MCP**
（\`mcp__aab__*\`，deferred 工具，先检索再调用）；**不要自己解析 \`rollout-*.jsonl\` 或 session sqlite**
——单个线程可达 50MB+，必撑爆上下文。

| 用户说法 | 调用 |
|---|---|
| 「查看 codex 会话」「codex 那边做到哪了」 | \`session_latest(agent="codex", level=1)\` |
| 「接着 codex 最新会话继续做」「继续上一个会话」 | 同上；每层是一个视角，按需换 level，已知轮次用 \`turns="last:5"\` |
| 不确定是哪一次 | \`session_list\` 先列（可 \`scope="global"\`） |
| 已知是哪一次（有 id 前缀） | \`session_read(agent="codex", session="01a176fa")\` |
| 只差一个细节 | \`session_grep("关键词")\`（命中带轮次号，再用 \`session_read(turns=<轮次>)\` 取上下文），别整篇导出 |

用户点名了工具就传 \`agent\`，别留 \`auto\`。`;

const EN = `### Reading another AI tool's session (aab)

Whenever you need another AI coding tool's session (codex / claude / codebuddy / workbuddy), **use the aab
MCP server** (\`mcp__aab__*\`, a deferred tool — search for it first); **do not parse \`rollout-*.jsonl\` or
session sqlite by hand** — a single thread can exceed 50MB and will blow up the context.

| What the user says | Call |
|---|---|
| "read the codex session", "where did codex get to" | \`session_latest(agent="codex", level=1)\` |
| "continue where codex left off", "pick up the previous session" | same; levels are views — switch level as needed; \`turns="last:5"\` when known |
| not sure which session | \`session_list\` first (\`scope="global"\` when needed) |
| know the session id/prefix | \`session_read(agent="codex", session="01a176fa")\` |
| one specific detail | \`session_grep("keyword")\` (hits carry the turn number; follow with \`session_read(turns=<N>)\`), never dump the whole conversation |

If the user names a tool, pass \`agent\`; do not leave it \`auto\`.`;

export function rule() {
  return isZh() ? ZH : EN;
}
