# ai-agent-bridge

**[English](README.en.md)**

读取另一个 AI 编码工具的会话：**先给最新结论，不够再逐层展开**。

支持 Codex、Claude Code、WorkBuddy、CodeBuddy、EasyMint。会话数据只读；唯一写入的是各客户端的
MCP 配置，由 `install` 完成，可用 `--dry-run` 预览。

```bash
npx -y @tianemon/ai-agent-bridge install     # 探测本机已装的客户端并写入 MCP 配置
npx -y @tianemon/ai-agent-bridge doctor      # 能读到谁的会话、哪个客户端已挂上
```

安装后命令为 `aab`，别名 `agent-bridge`。零依赖，Node ≥ 18。

## 输出

```
■ Codex · 2026-10-25 10:03 · 续跑 4 段 · gpt-6.1-sol
  会话 01a16729-0aed-7012 · 共 99 轮需求 · /Users/amon/dev/project/EasyMint
  标题 解析视频并仿制 UI 风格

【level 1 · 最新进展（未收尾）】
第 99 轮 · 用户问：重新发布1.4.0

（该轮没有收尾结论——会话可能中断、仍在运行，或最后一条只是进展旁白）

我会把这些界面修正并入 1.4.0，完成发版检查后替换标签和 Release，触发三平台重新构建。

── 退路：最近一条结论在第 98 轮（约 +93 token）──
已实现：Mint 头像和名称移到回复上方；去掉回复气泡底色；只有结论保留复制、钉住、重新回答。

── 不够就再看一层（同一会话再调一次，换个 level）──
  level=2  最近 3 轮问答  ≈ 合计 551 token（比当前多 368）
  level=3  全部需求与结论（每轮一行）  ≈ 合计 4130 token（比当前多 3947）
  level=4  命令 / 文件 / git 状态  ≈ 合计 2494 token（比当前多 2311）
  当前 level=1，全文约 183 token
```

该会话原文 87 MB，`level=1` 为 183 token。

## 阶梯

| 层 | 内容 | 成本（99 轮会话实测） |
|---|---|---|
| 1 | 最后一条结论 + 该轮提问 | 183 token |
| 2 | 最近 3 轮（提问 + 结论） | 551 token |
| 3 | 每轮需求 + 结论 | 4130 token |
| 4 | 改动文件 / 命令 / git 状态 | 2494 token（前 40 个文件、最近 15 条命令） |
| `turns` | 指定切片：`12-14`、`12`、`last:5`、`from:60`、`around:40±2` | 由切片决定 |

每层是独立视角，不是叠加：报价是该视角全文的成本，与当前停在哪一层无关。第 3 层随轮数线性增长，
长会话中可能高于第 4 层，按报价选择。

最后一轮没有结论时（中断、仍在运行、末条为进展说明），第 1 层会明确标注，并附最近一条有结论的
轮次及其轮号与成本。

## 设计取舍

- **不整份读取。** 只取用户提问、最终 assistant 文本、工具调用目标与 git 状态；思考块、工具输出、
  `base_instructions` 跳过。
- **四层作答，够用即停。** 每层附下一层的 token 成本。
- **已知信息由调用方传入**（`--known` / `known`），不依赖推测。

## 安装

`install` 只写本机确实存在的客户端配置，写入前备份，可重复执行。支持 WorkBuddy、Codex、Claude Code、EasyMint。

```bash
npx -y @tianemon/ai-agent-bridge install --dry-run          # 只打印要写什么
npx -y @tianemon/ai-agent-bridge install --agent codex,claude  # 限定客户端
npx -y @tianemon/ai-agent-bridge install easymint           # 只写 EasyMint（等价 --agent easymint）
aab prompt                                                  # 打印可交给 agent 执行的指令
```

不安装也可以直接运行 `node <repo>/bin/aab.mjs <命令>`。

从源码使用时先打包再安装，不使用符号链接：

```bash
npm pack && npm i -g ./tianemon-ai-agent-bridge-<版本>.tgz
aab install          # 让各家配置指向新路径
```

`aab doctor` 的 `mode` 行显示当前运行形态：`npm 全局安装` / `开发目录` / `npx 缓存`。

## 作为 MCP server

服务形态是 `aab mcp`（stdio）。`install` 会写入配置；以下是手写形式，用于自行配置或客户端尚未覆盖的情况。

> 终端宿主（Claude Code、Codex CLI）可用短命令 `aab mcp`；GUI 宿主（WorkBuddy、Codex Desktop）
> 启动子进程时 `PATH` 可能被裁剪，需给绝对路径。

**WorkBuddy** — `~/.workbuddy/mcp.json`

```json
{
  "mcpServers": {
    "aab": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/you/dev/ai-agent-bridge/bin/aab.mjs", "mcp"]
    }
  }
}
```

**Codex** — `~/.codex/config.toml`

```toml
[mcp_servers.aab]
command = "/opt/homebrew/bin/node"
args = ["/Users/you/dev/ai-agent-bridge/bin/aab.mjs", "mcp"]
startup_timeout_sec = 20
```

**Claude Code**

```bash
claude mcp add --scope user aab /opt/homebrew/bin/node /Users/you/dev/ai-agent-bridge/bin/aab.mjs mcp
```

**EasyMint** — `<EASYMINT_HOME>/agent/mcp.json`（默认 `~/.easymint/agent/mcp.json`；旧位置 `~/.easymint/mcp.json` 里还有条目时沿用旧文件，不另建新文件）

```json
{
  "mcpServers": {
    "aab": {
      "type": "stdio",
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/you/dev/ai-agent-bridge/bin/aab.mjs", "mcp"],
      "description": "读取其它 AI 编码工具的会话"
    }
  }
}
```

工具：`session_latest`、`session_list`、`session_read`、`session_grep`、`session_agents`。

### WorkBuddy 需要手动确认一次

WorkBuddy 不会提示新的 MCP server，且在确认前不加载。`aab install` 写入后需确认一次：

```
连接器 → 自定义连接器 → aab → 信任
Connectors → Custom connectors → aab → Trust
```

`aab doctor` 显示当前状态：

```
WorkBuddy    ✓ 已注册 · ✓ 已信任（2026-10-24 12:26）
WorkBuddy    ✓ 已注册 · ✗ 未信任 → 连接器 → 自定义连接器 → aab → 信任
WorkBuddy    ✓ 已注册 · ⚠ 信任记录对应的是旧配置，需重新确认
```

授权记录由 WorkBuddy 签发，工具不代写。若不需要 WorkBuddy 接入，有两种方式：

- `aab install --agent codex,claude`，不写入 WorkBuddy
- 走 CLI 而非 MCP：在项目的 `CLAUDE.md` / `AGENTS.md` 中写明需要其他工具会话时执行 `aab latest`

## 作为 CLI

```bash
aab list --since 24h                     # 时间、工具、项目、id、体积、标题
aab latest --agent codex --level 1       # 最新结论
aab latest --agent codex --level 3       # 更高一层
aab latest --turns 40-41                 # 精确区间
aab latest --turns last:5                # 最近 5 轮
aab latest --turns from:60               # 第 60 轮至末尾
aab latest --turns "around:40±2"         # 第 40 轮前后窗口（默认跨度 3）
aab latest --known '{"agent":"codex","session":"01a16729","turns":"last:3"}'
aab read --session 53bf411c --level 2
aab grep "paths-ignore" --agent claude --limit 3   # 命中带会话 id 与轮次号
aab rule                                 # 打印可粘进 CLAUDE.md / AGENTS.md 的常驻规则
```

`grep` 的命中标注「第 N 轮」，可直接 `aab read --session <id> --turns N` 取上下文。达到条数上限时提示
用 `--agent` / `--since` 缩小范围，扫描顺序为最近活动优先。

### 标题

列表与表头都带标题。标题来源：

| 工具 | 来源 | 改名后 |
|---|---|---|
| Codex | `<CODEX_HOME>/session_index.jsonl` 的 `thread_name` | 该文件追加写入：每次改名多一行，取 `updated_at` 最新的一条 |
| WorkBuddy / CodeBuddy | 应用 SQLite 的 `sessions.title`、`sessions.custom_title` | `custom_title` 优先；行内为当前值 |
| Claude Code / EasyMint | 无标题存储，取该会话第一个真实提问 | 不适用 |

兜底标题压成一行并跳过纯图片消息，因此首条为图片的会话没有标题（id 仍可用）。

`--known` 接受 JSON（工具、项目、会话、轮次区间、时间窗）。显式参数优先于 `known` 中同名字段；
MCP 侧对应 `known` 与 `maxChars`。

输出语言：`AAB_LANG=zh|en`，否则跟随 `LC_ALL` / `LANG`（默认英文）。会话正文不翻译，只换标签。

### 常驻规则：`aab rule`

MCP 的 `InitializeResult.instructions` 在规范中是可选项，宿主可以不注入。WorkBuddy 实测不注入，
模型只能看到工具名（且为 deferred，需先检索）。因此工具描述只能提高命中概率，宿主每个会话都会读的
文件才能保证生效。

```bash
aab rule        # 打印片段；正文走 stdout，写入哪个文件的提示走 stderr
```

粘进项目根的 `CLAUDE.md`（WorkBuddy / Claude Code）或 `AGENTS.md`（Codex）。内容为说法与调用的对照
（「查看 codex 会话」「接着继续做」）以及不要手工解析 `rollout-*.jsonl`。该步骤可选。

## 作用域

默认**本项目**：工作目录归到 git 根。`--scope` 调整：

| scope | 行为 |
|---|---|
| `auto`（默认） | 本项目优先；找不到时退到全机，并在输出中注明 |
| `project` | 仅本项目，不回退，找不到报错 |
| `global` | 全机 |

## 支持的工具

| 工具 | 会话位置 | 环境变量 |
|---|---|---|
| Codex | `<home>/.codex/sessions/**/rollout-*.jsonl` | `CODEX_HOME` |
| Claude Code | `<home>/.claude/projects/<slug>/<uuid>.jsonl` | `CLAUDE_CONFIG_DIR` |
| WorkBuddy | `<home>/.workbuddy/projects/<slug>/<uuid>.jsonl` | `WORKBUDDY_HOME` |
| CodeBuddy | `<home>/.codebuddy/projects/<slug>/<uuid>.jsonl` | `CODEBUDDY_HOME` |
| EasyMint | `<home>/.easymint/agent/sessions/--<slug>--/<ts>_<id>.jsonl` | `EASYMINT_HOME` |

WorkBuddy 与 CodeBuddy 使用同一套写入器（transcript 含 `__codebuddyLocal` 字段），由一个适配器覆盖：
`type:"message"` 配 `input_text` / `output_text` 块，`function_call` / `function_call_result` /
`reasoning` / `file-history-snapshot` 行跳过。WorkBuddy 将用户提问包在 `<system-reminder>` 信封中，
实际文本位于 `<user_query>` 内。

子代理 trace（`subagents/*.jsonl`、`agent-*.jsonl`）排除在外，它们是模型内部的委派过程，不是与用户的
对话。

适配细节：Codex 按 `session_meta.session_id` 将多个 rollout 文件归为一个 thread（续跑会新写文件）；
Claude Code 一文件一会话；伪装成用户消息的压缩摘要（`isCompactSummary`）单独隔离。

## 新增工具

新建 `src/agents/<名字>.mjs`：

```js
export default {
  name: "cursor",
  label: "Cursor",
  root: () => "/path/to/cursor/data",
  index(project) {
    // → [{ id, cwd, model, files: [{ file, mtimeMs, size }] }]
  },
  async parse(files) {
    // → { turns: [{ i, user, userTs, finals: [], narration: [], tools: [], files: [] }], compaction: [] }
  },
  userTurnOf(o) {},          // 一行是否开启新一轮：返回用户原文或 ""
  userMarker: '"role":"user"', // 廉价字面预筛：含它才值得 JSON.parse
};
```

然后在 `src/registry.mjs` 的 `LIST` 中登记一行。

## 限制

- **会话数据只读。** 不写任何工具的数据目录；唯一写入的是 MCP 配置（`install`，可预览）。
  外部进程仅 `git log` / `git status` / `git rev-parse`，固定参数，不经 shell。
- 单个会话可达数十 MB（本机实测 87 MB），分层读取，不会整份进入上下文。
- Windows 未实测。目录 slug 的兜底逻辑假设 POSIX 路径；主判据是从文件读取 `cwd`，只影响头部缺
  `cwd` 的会话。
- 不提供会话浏览界面与全文检索，只做分级读取。
- 用户提问逐字读取。在上一个工具中输入的任何内容（含密钥）都会出现在新上下文中。
- 仅中英两种输出语言。标签全部走 `src/i18n.mjs` 字典，英文模式下若有一条命令输出中文，测试会失败；
  增加语言只需补字典条目。
- WorkBuddy 的信任确认无法自动化，`aab doctor` 只报告状态。

## 维护

发版与安装规则见 [`docs/RELEASING.md`](docs/RELEASING.md)，要点见 [`AGENTS.md`](AGENTS.md)。
生产环境运行的是发布产物，不是本仓库源码。

## 许可

MIT
