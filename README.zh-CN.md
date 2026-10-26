# ai-agent-bridge

**[English](README.md) · [简体中文](README.zh-CN.md)**

读取另一个 AI 编码工具的会话 —— **先给最新结论，不够再逐层往上要**。

从 Codex 切到 Claude Code，或者从任何工具切到支持 MCP 的 agent，都能接着上一次干 ——
而不必把 30 MB 的 transcript 塞进上下文。

```
■ Codex · 2026-10-23 21:59 · 续跑 2 段 · gpt-6.1-sol
  会话 01a16729-0aed-7012 · 共 41 轮需求 · /Users/amon/dev/project/EasyMint

【level 1 · 最新进展（未收尾）】
第 41 轮 · 用户问：按我理解，这应该就是大概的样子…确认明白就开始实现
（该轮没有收尾结论——会话可能中断、仍在运行，或最后一条只是进展旁白）
正式界面中已确认：组件/布局切换、Web/移动端切换、配色、效果和放大预览入口都在…

── 不够就再看一层（同一会话再调一次，换个 level）──
  level=2  最近 3 轮问答  ≈ 合计 389 token（比当前多 288）
  level=3  全部需求时间线  ≈ 合计 1063 token（比当前多 962）
  level=4  命令 / 文件 / git 状态  ≈ 合计 2937 token（比当前多 2836）
  当前 level=1，全文约 101 token
```

上面是 101 token，而这个会话原文约 900 万 token。什么时候停由调用方决定，因为每一层都标明
下一层要花多少。

## 为什么

每个 agent CLI 都把自己的会话写进自己的目录。切换工具时，唯一的共同真相是 git ——
它告诉你*改了什么*，但从不告诉你*为什么*、什么被否决了、什么还没做完。
显而易见的解法是把 transcript 丢进仓库让新 agent 读，可一旦 transcript 有 18 MB 就崩了。

所以这个工具只做三件事：

1. **从不整份读。** 只取用户提问、最终的 assistant 文本、工具调用目标、git 状态。
   思考块、工具输出、`base_instructions` 全部跳过 —— 它们占了绝大部分字节，却几乎没有信息。
2. **四层作答。** 够用的那一层就停。
3. **让调用方把已知信息交进来**（`known`），不靠猜。

## 阶梯

| 层 | 内容 | 典型成本 |
|---|---|---|
| 1 | 最后一条结论 + 该轮的提问 | ~100 token |
| 2 | 最近 3 轮（提问 + 结论） | ~300 token |
| 3 | 全部需求时间线 + 压缩摘要 | ~1k token |
| 4 | 改动文件 / 命令 / git 状态 | ~3k token |
| `turns` | 任意切片（`12-14`、`last:5`、`from:60`、`around:40±2`） | 由你决定 |

每层是一个独立视角，不是叠加：报价就是该视角全文的成本，与当前停在哪一层无关。

最后一轮没有结论时（被打断、还在跑、或最后一条只是进展旁白），第 1 层会明说，而不是拿旁白冒充
结论 —— 同时附上最近一条真有结论的轮次，带轮号和 token 成本。

## 安装 —— 让 agent 自己装

发布为 **`@tianemon/ai-agent-bridge`**；它安装的命令是 **`aab`**，因为这是 agent 一天要敲几十次的
东西。`agent-bridge` 作为别名一起装，用于 `aab` 在 `PATH` 上撞名的罕见情况。

把下面这段交给任意编码 agent（Claude Code、Codex、WorkBuddy 都行）：

> 运行 `npx -y @tianemon/ai-agent-bridge install`，再运行
> `npx -y @tianemon/ai-agent-bridge doctor`，把输出给我看。如果安装输出说 WorkBuddy 未信任，
> 把它打印的点击路径（连接器 → 自定义连接器 → aab → 信任）告诉我 —— 这一步只能我自己点。

`install` **会先探测本机到底装了哪些客户端，只写存在的那些**。没装的直接跳过，绝不假设。
动过的配置都先备份，并且是幂等的 —— 重跑不会重复写。

```bash
npx -y @tianemon/ai-agent-bridge install --dry-run    # 只看要写什么，不落盘
npx -y @tianemon/ai-agent-bridge doctor               # 能读到谁的会话、哪个客户端已挂上
npx -y @tianemon/ai-agent-bridge prompt               # 打印给 agent 的指令块
```

或者装一个常驻命令：

```bash
git clone https://github.com/tianemon/ai-agent-bridge ~/dev/ai-agent-bridge
cd ~/dev/ai-agent-bridge && npm link     # 把 aab 放到 PATH（符号链接，改代码立即生效）
npm unlink -g @tianemon/ai-agent-bridge  # 卸载
```

零依赖、无构建步骤，Node ≥ 18。完全不安装也能用：`node <路径>/bin/aab.mjs <命令>`。

### 开发版与安装版

`aab doctor` 会告诉你当前跑的是哪一份：

```
mode    npm 全局安装（正式安装）        # 安装副本 —— 正式使用应该是这个
mode    开发目录（开发态：…）           # 开发目录 —— 配置指向源码，改代码即时生效
mode    npx 缓存                       # npx 缓存 —— 配置指向 `npx -y …`
```

`npm link` 是给开发用的；正式使用请装真实副本：

```bash
npm pack && npm i -g ./tianemon-ai-agent-bridge-<版本>.tgz
aab install      # 让各家配置指向新路径
```

## 作为 MCP server

服务形态是 `aab mcp`（stdio）。`install` 会替你写好；下面是手写形式，用于你想自己配、或你的客户端
还没被覆盖的情况。

> 终端宿主（Claude Code、Codex CLI）可以用短命令 `aab mcp`；GUI 宿主（WorkBuddy、Codex Desktop）
> 启动子进程时 `PATH` 可能被裁剪，请给绝对路径。

**WorkBuddy** —— `~/.workbuddy/mcp.json`

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

**Codex** —— `~/.codex/config.toml`

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

暴露的工具：`session_latest`、`session_list`、`session_read`、`session_grep`、`session_agents`。

### WorkBuddy 装完必须手点一次信任

WorkBuddy 在配置里出现新的 MCP server 时不会提示，而且在你确认之前不会加载它。
`aab install` 写到 WorkBuddy 之后，你需要点一次：

```
连接器 → 自定义连接器 → aab → 信任
Connectors → Custom connectors → aab → Trust
```

`aab doctor` 直接告诉你当前状态，不用猜：

```
WorkBuddy    ✓ 已注册 · ✓ 已信任（2026-10-24 12:26）
WorkBuddy    ✓ 已注册 · ✗ 未信任 → 连接器 → 自定义连接器 → aab → 信任
WorkBuddy    ✓ 已注册 · ⚠ 信任记录对应的是旧配置，需重新点
```

这一步刻意无法自动化：信任记录是 WorkBuddy 自己的安全闸 ——
"由人确认这个 server 可以在本机执行命令"。工具代写自己的授权，等于闸门失效，
也会给任何往配置里塞 entry 的程序开后门。如果你完全不想点，有两条路：

- `aab install --agent codex,claude` —— 干脆不碰 WorkBuddy
- 在 WorkBuddy 里走 CLI 通道而不是 MCP：在项目的 `CLAUDE.md` / `AGENTS.md` 写一行，
  让 agent 需要别家会话时直接跑 `aab latest`（没有信任闸，但每次多一次 shell 往返）

## 作为 CLI

```bash
aab list --since 24h                     # 最近发生了什么：时间、工具、项目、id、体积、标题
aab latest --agent codex --level 1       # 只要最新结论
aab latest --agent codex --level 3       # 还不够？再要一层
aab latest --turns 40-41                 # 精确区间
aab latest --turns 12                    # 单轮
aab latest --turns last:5                # 最近 5 轮
aab latest --turns from:60               # 第 60 轮到最后
aab latest --turns "around:40±2"         # 第 40 轮前后窗口（默认跨度 3）
aab latest --known '{"agent":"codex","session":"01a16729","turns":"last:3"}'
aab read --session 53bf411c --level 2
aab grep "paths-ignore" --agent claude --limit 3   # 命中带会话 id 与轮次号
aab rule                                 # 打印可粘进 CLAUDE.md / AGENTS.md 的常驻规则
```

`grep` 的命中头会写「第 N 轮」，可以直接 `aab read --session <id> --turns N` 取上下文；
扫到条数上限时会提示用 `--agent` / `--since` 缩小范围（扫描顺序是从最近活动到更早）。

**列表带标题，不只给 id。** 只有 id 根本认不出是哪次会话。标题来源：

| 工具 | 来源 | 改标题后 |
|---|---|---|
| Codex | `<CODEX_HOME>/session_index.jsonl` 的 `thread_name` | 该文件是**追加**写：改一次标题多一行，取 `updated_at` 最新的那条 |
| WorkBuddy / CodeBuddy | 应用 SQLite 里 `sessions.title` + `sessions.custom_title` | `custom_title`（你手动改的）优先；表里永远是当前值 |
| Claude Code / EasyMint | 没有标题存储 —— 用该会话第一个真实提问兜底 | 不适用 |

兜底标题会压成一行、跳过纯图片消息；所以"首条就是图片"的会话没有标题（id 仍然在）。

`--known` 接受 JSON，是模型"把已知信息交进来"的方式（工具、项目、会话、轮次区间、时间窗）。
显式参数优先于 `known` 里的同名字段。MCP 侧对应的旋钮是 `known` 与 `maxChars`。

输出语言：`AAB_LANG=zh|en` 可强制指定，否则跟随 `LC_ALL` / `LANG`（默认英文）。会话正文永远不翻译，
只换周围的标签 —— 上面那段样例就是英文环境下读一份中文会话的真实输出。

### 想稳定命中：`aab rule`

MCP 的 `InitializeResult.instructions` 规范原文是宿主**可以**把它塞进系统提示——可选的。WorkBuddy 实测
不塞：模型只看到五个裸工具名（还是 deferred，得先检索才读得到描述）。所以描述只能提高概率，
**只有宿主每个会话都会读的文件才是确定性的**。

```bash
aab rule        # 打印十行左右的片段；stdout 可直接粘，选哪个文件的提示走 stderr
```

粘进项目根的 `CLAUDE.md`（WorkBuddy / Claude Code）或 `AGENTS.md`（Codex）。里面按"用户真实说法"列了
说法 → 调用的对照（「查看 codex 会话」「接着继续做」），以及最要紧的一条：别手解 `rollout-*.jsonl`。

这一步是**可选**的：它改的是你自己仓库的规则文件，而该写哪个文件取决于宿主。

## 作用域

默认是**本项目**：工作目录，归到它的 git 根。用 `--scope` 调整：

| scope | 行为 |
|---|---|
| `auto`（默认） | 本项目优先；找不到就退到全机，**并在输出里注明** |
| `project` | 只在本项目 —— 不回退，找不到就报错 |
| `global` | 全机 |

## 支持的工具

| 工具 | 会话位置 | 环境变量覆盖 |
|---|---|---|
| Codex | `<home>/.codex/sessions/**/rollout-*.jsonl` | `CODEX_HOME` |
| Claude Code | `<home>/.claude/projects/<slug>/<uuid>.jsonl` | `CLAUDE_CONFIG_DIR` |
| WorkBuddy | `<home>/.workbuddy/projects/<slug>/<uuid>.jsonl` | `WORKBUDDY_HOME` |
| CodeBuddy | `<home>/.codebuddy/projects/<slug>/<uuid>.jsonl` | `CODEBUDDY_HOME` |
| EasyMint | `<home>/.easymint/agent/sessions/--<slug>--/<ts>_<id>.jsonl` | `EASYMINT_HOME` |

WorkBuddy 与 CodeBuddy 共用同一套写入器（transcript 里甚至带 `__codebuddyLocal` 字段），
所以一个适配器覆盖两家：`type:"message"` 配 `input_text` / `output_text` 块，
另有 `function_call` / `function_call_result` / `reasoning` / `file-history-snapshot` 行被跳过。
WorkBuddy 会把用户提问包在 `<system-reminder>` 信封里 —— 真正的文本在 `<user_query>` 内，我们读的是它。

子代理 trace（`subagents/*.jsonl`、`agent-*.jsonl`）**刻意排除** —— 它们是模型内部的委派过程，
不是与你的对话。在作者机器上这过滤掉了数百个文件，却保留了每一个真实会话。

以下事实都对真实数据验证过：Codex 按 `session_meta.session_id` 把多文件归成一个 thread
（续跑会新写一个 rollout 文件）；Claude Code 一文件一会话；伪装成用户消息的压缩摘要
（`isCompactSummary`）被单独隔离，不会污染需求时间线。

## 再加一个工具

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
  // grep 标注轮次用：一行（已解析）是否开启新一轮，返回用户原文或 ""
  userTurnOf(o) {},
  // 廉价字面预筛：含它才值得 JSON.parse
  userMarker: '"role":"user"',
};
```

然后在 `src/registry.mjs` 的 `LIST` 里登记一行，别处不用改。

## 限制

- **只读。** 不写任何工具的数据目录。唯一的外部进程是 `git log` / `git status` / `git rev-parse`，
  固定参数、不走 shell。
- Windows 未实测。目录 slug 的兜底逻辑假设 POSIX 路径；主判据是从文件里读 `cwd`，
  所以只影响头部缺 `cwd` 的会话。
- 不是会话**浏览器**。想要 UI 和全文检索，SpecStory 之类已经在做；这个工具做的是压缩后的交接层。
- 提问是逐字读取的。你在上一个工具里打过的任何内容 —— 包括密钥 —— 都会原样出现在新上下文里。
  别把密钥写进 prompt。
- 只做了中英两种语言。工具打印的每个标签都走字典（`AAB_LANG`），英文模式下只要有一条命令漏出中文，
  测试就会失败；加第三种语言只需往 `src/i18n.mjs` 补条目，不用改代码。
- WorkBuddy 的信任闸没法自动化。授权记录由 WorkBuddy 自己签发，能代写的工具等于让闸门失效；
  `aab doctor` 负责把状态报出来。

## 维护

发版与安装规则见 [`docs/RELEASING.md`](docs/RELEASING.md)，要点在 [`AGENTS.md`](AGENTS.md)。
一句话版本：生产跑的是发布出去的包，不是这份源码。

## 许可

MIT
