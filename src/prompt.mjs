/**
 * 给 agent 的执行指令。人不用读——复制给任意编码 agent 即可。
 * 设计原则：步骤可验证、失败可归因、不假设客户端、不依赖 npm 发布。
 */
export function prompt() {
  return `# ai-agent-bridge 安装指令（给 AI 编码 agent 执行）

你有 shell 权限。按顺序执行，任一步非零退出就停下并原样报告错误。

0) 定位命令
   先试 \`aab version\`；没有该命令就用 \`npx -y @tianemon/ai-agent-bridge\` 代替（参数不变）。

1) 探路
   npx -y @tianemon/ai-agent-bridge version

2) 注册 MCP —— 只写本机确实装了的客户端，未装的会自动跳过
   npx -y @tianemon/ai-agent-bridge install

3) 验证
   npx -y @tianemon/ai-agent-bridge doctor

4) 把 doctor 输出里「会话来源」「宿主」「结论」三节贴给用户，并说明：
   - 改了配置的客户端需要新开会话（WorkBuddy 可能还要在连接器页点一次 Trust）
   - 没有任何客户端被写入时，让用户在它用的客户端里手动加一条 MCP：
     command = <node 绝对路径>，args = ["<仓库路径>/bin/aab.mjs", "mcp"]

装好之后，读另一个工具的会话：

- 有 MCP：调工具 session_latest（先 level=1，不够再 2/3/4；已知轮次用 turns:"12-14" 或 "last:5"）
- 没有 MCP：npx -y @tianemon/ai-agent-bridge latest --agent codex --level 1
- 不知道是哪次：npx -y @tianemon/ai-agent-bridge list --since 24h

注意：包名带 scope，不要写成 \`npx ai-agent-bridge\`（那是别人的包）。

约定：默认只读，不改任何工具的数据目录；输出末尾会标下一层的 token 代价，够用就停。`;
}
