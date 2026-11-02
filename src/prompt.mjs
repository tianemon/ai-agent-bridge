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

2) 自动注册 —— aab 会写本机确实装了的、且它已适配配置格式的客户端
   npx -y @tianemon/ai-agent-bridge install

3) 验证
   npx -y @tianemon/ai-agent-bridge doctor

4) 检查「你自己」所在的客户端
   aab 已适配的宿主：EasyMint、DeepSeek Harness、WorkBuddy、Codex、Claude Code。
   看 doctor 的「能装」一节：
   - 你在列表里且显示已注册 → 完成，跳到第 6 步
   - 你在列表里但显示未注册 → 再跑一次 \`install <你的名字>\` 或 \`install --agent <你的名字>\`
   - 你不在列表里 → aab 没有适配你的工具，自己装：

     自己确定本工具的 MCP 配置位置（你知道自己是什么工具；查它的文档或配置目录），
     写入一条 stdio MCP server：
       command = <node 绝对路径>
       args = ["<aab 安装路径>/bin/aab.mjs", "mcp"]
     然后重启本工具（或新开会话）让它加载。

5) 把 doctor 的「能读」「能装」「结论」三节贴给用户，并说明：
   - 改了配置的客户端需要新开会话（WorkBuddy 还要在 连接器 → 自定义连接器 → aab → 信任 点一次）
   - DeepSeek Harness 需要重启应用
   - 没有任何客户端被写入时，让用户在它用的客户端里手动加一条 MCP（格式见第 4 步）

6) （可选，但强烈建议）如果这个项目会经常「读另一个工具的会话」，把 \`aab rule\` 的输出粘进
   项目根的 CLAUDE.md / AGENTS.md。WorkBuddy 实测不注入 MCP instructions，只有写进文件才是每个
   会话必读的。

装好之后，读另一个工具的会话：
- 有 MCP：调工具 session_latest（先 level=1，不够再 2/3/4；已知轮次用 turns:"12-14" 或 "last:5"）
- 没有 MCP：npx -y @tianemon/ai-agent-bridge latest --agent codex --level 1
- 不知道是哪次：npx -y @tianemon/ai-agent-bridge list --since 24h

注意：包名带 scope，不要写成 \`npx ai-agent-bridge\`（那是别人的包）。

约定：默认只读，不改任何工具的数据目录；输出末尾会标下一层的 token 代价，够用就停。`;

const EN = `# ai-agent-bridge install instructions (for an AI coding agent to execute)

You have shell access. Run these in order; if any step exits non-zero, stop and report the error verbatim.

0) Locate the command
   Try \`aab version\` first; if missing, use \`npx -y @tianemon/ai-agent-bridge\` instead (same arguments).

1) Probe
   npx -y @tianemon/ai-agent-bridge version

2) Auto-register — aab writes only the clients actually installed here that it has adapted
   npx -y @tianemon/ai-agent-bridge install

3) Verify
   npx -y @tianemon/ai-agent-bridge doctor

4) Check the client "you" are running inside
   Hosts aab has adapted: EasyMint, DeepSeek Harness, WorkBuddy, Codex, Claude Code.
   Read the "installable" section of doctor:
   - you are listed and registered → done, skip to step 6
   - you are listed but not registered → run \`install <your-name>\` (or \`install --agent <your-name>\`) again
   - you are not listed → aab has no adapter for your tool; install it yourself:

     find this tool's MCP config location on your own (you know what tool you are; check its docs or
     config directory), then add a stdio MCP server:
       command = <absolute node path>
       args = ["<aab install path>/bin/aab.mjs", "mcp"]
     restart the tool (or open a new session) so it loads.

5) Paste the "readable", "installable" and "Conclusion" sections of doctor to the user, and tell them:
   - clients whose config changed need a new session (and WorkBuddy needs one click:
     Connectors → Custom connectors → aab → Trust)
   - DeepSeek Harness needs an app restart
   - if no client was written, have the user add the MCP entry by hand in whichever client they use
     (format in step 4)

6) (optional, strongly recommended) if this project will routinely read another tool's session, paste the
   output of \`aab rule\` into the project's CLAUDE.md / AGENTS.md. WorkBuddy does not inject MCP
   instructions in practice — only a rule file is read in every session.

Once installed, to read another tool's session:

- with MCP: call session_latest (start at level=1; raise to 2/3/4 only if needed; if you know the turns use
  turns:"12-14" or "last:5")
- without MCP: npx -y @tianemon/ai-agent-bridge latest --agent codex --level 1
- not sure which session: npx -y @tianemon/ai-agent-bridge list --since 24h

Note: the package name is scoped — do not write \`npx ai-agent-bridge\` (that is someone else's package).

Contract: read-only, never modify another tool's data directory; every reply ends with the token cost of the
next level, so stop as soon as you have enough.`;

export function prompt() {
  return isZh() ? ZH : EN;
}
