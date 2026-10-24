/**
 * 给 agent 的执行指令。人不用读——复制给任意编码 agent 即可。
 * 设计原则：步骤可验证、失败可归因、不假设客户端、不依赖 npm 发布。
 * 中英各一份，跟随 AAB_LANG / 系统语言。
 */
import { isZh } from "./i18n.mjs";

const ZH = `# ai-agent-bridge 安装指令（给 AI 编码 agent 执行）

你有 shell 权限。按顺序执行，任一步非零退出就停下并原样报告错误。

0) 定位命令
   先试 \`aab version\`；没有该命令就用 \`npx -y @tianemon/ai-agent-bridge\` 代替（参数不变）。

1) 探路
   npx -y @tianemon/ai-agent-bridge version

2) 注册 MCP —— 只写本机确实装了的客户端，未装的会自动跳过
   npx -y @tianemon/ai-agent-bridge install

3) 验证
   npx -y @tianemon/ai-agent-bridge doctor

4) 把 doctor 输出里的「会话来源」「宿主」「结论」三节贴给用户，并说明：
   - 改了配置的客户端需要新开会话（WorkBuddy 还要在 连接器 → 自定义连接器 → aab → 信任 点一次）
   - 没有任何客户端被写入时，让用户在它用的客户端里手动加一条 MCP：
     command = <node 绝对路径>，args = ["<仓库路径>/bin/aab.mjs", "mcp"]

装好之后，读另一个工具的会话：

- 有 MCP：调工具 session_latest（先 level=1，不够再 2/3/4；已知轮次用 turns:"12-14" 或 "last:5"）
- 没有 MCP：npx -y @tianemon/ai-agent-bridge latest --agent codex --level 1
- 不知道是哪次：npx -y @tianemon/ai-agent-bridge list --since 24h

注意：包名带 scope，不要写成 \`npx ai-agent-bridge\`（那是别人的包）。

5) （可选，但强烈建议）如果这个项目会经常"读另一个工具的会话"，把 \`aab rule\` 的输出粘进项目根的
   CLAUDE.md / AGENTS.md。WorkBuddy 实测不注入 MCP instructions，只有写进文件才是每个会话必读的。

约定：默认只读，不改任何工具的数据目录；输出末尾会标下一层的 token 代价，够用就停。`;

const EN = `# ai-agent-bridge install instructions (for an AI coding agent to execute)

You have shell access. Run these in order; if any step exits non-zero, stop and report the error verbatim.

0) Locate the command
   Try \`aab version\` first; if missing, use \`npx -y @tianemon/ai-agent-bridge\` instead (same arguments).

1) Probe
   npx -y @tianemon/ai-agent-bridge version

2) Register the MCP server — only clients actually installed here are touched, the rest are skipped
   npx -y @tianemon/ai-agent-bridge install

3) Verify
   npx -y @tianemon/ai-agent-bridge doctor

4) Paste the "sources", "hosts" and "Conclusion" sections of the doctor output to the user, and tell them:
   - clients whose config changed need a new session (and WorkBuddy needs one click:
     Connectors → Custom connectors → aab → Trust)
   - if no client was written, have the user add the MCP entry by hand in whichever client they use:
     command = <absolute node path>, args = ["<repo>/bin/aab.mjs", "mcp"]

Once installed, to read another tool's session:

- with MCP: call session_latest (start at level=1; raise to 2/3/4 only if needed; if you know the turns use
  turns:"12-14" or "last:5")
- without MCP: npx -y @tianemon/ai-agent-bridge latest --agent codex --level 1
- not sure which session: npx -y @tianemon/ai-agent-bridge list --since 24h

Note: the package name is scoped — do not write \`npx ai-agent-bridge\` (that is someone else's package).

5) (optional, strongly recommended) if this project will routinely read another tool's session, paste the
   output of \`aab rule\` into the project's CLAUDE.md / AGENTS.md. WorkBuddy does not inject MCP
   instructions in practice — only a rule file is read in every session.

Contract: read-only, never modify another tool's data directory; every reply ends with the token cost of the
next level, so stop as soon as you have enough.`;

export function prompt() {
  return isZh() ? ZH : EN;
}
