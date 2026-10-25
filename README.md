# ai-agent-bridge

**[English](README.md) · [简体中文](README.zh-CN.md)**

Read another AI coding tool's session — **newest conclusion first, escalate only as far as you need**.

Switch from Codex to Claude Code, or from Claude Code to any MCP-capable agent, and pick up where the
previous tool left off — without stuffing a 30 MB transcript into the context window.

```
■ Codex · 2026-10-24 11:43 · 4 segments · gpt-6.1-sol
  session 01a16729-0aed-7012 · 67 turns · /Users/amon/dev/project/EasyMint

【level 1 · latest conclusion】
turn 67 · asked: 优化一下图标细节，房子图标不标准，播放图标三角形没有居中等等

已优化：
- 重画房屋图标，修正屋顶、墙体和门洞。
- 修复播放图标在紧凑模式和迷你播放器中的偏移，播放／暂停切换保持居中。
- 调整广播、收藏、下一曲和更多图标的轮廓与线宽。
已实测居中，27 项相关测试及构建通过。

── not enough? ask for one more level (same session, higher level) ──
  level=2  last 3 turns  ≈ +370 token
  level=3  full requirement timeline  ≈ +1601 token
  level=4  commands / files / git state  ≈ +2944 token
  currently level=1, this output ≈ 120 token
```

120 tokens instead of the session's ~9M. The caller decides when to stop, because every layer reports
what the next one costs.

**Labels follow your locale** (`AAB_LANG` / `LC_ALL` / `LANG`; English by default) — the conversation
text itself is always reproduced verbatim in whatever language it was written. The sample above is real
output from an English-locale machine reading a Chinese session.

## Why

Every agent CLI writes its own session format to its own directory. When you switch tools, the only
shared ground truth is git — which tells you *what* changed, never *why*, what was rejected, or what
was left unfinished. The obvious fix — dump the transcript into the repo and let the new agent read
it — fails the moment the transcript is 18 MB.

So this tool does three things:

1. **Never reads the whole file.** Only user prompts, final assistant messages, tool call targets,
   and commit state. Thinking blocks, tool outputs, and `base_instructions` are skipped — they are
   most of the bytes and none of the signal.
2. **Answers at four levels.** Stop at the first one that's sufficient.
3. **Lets the caller hand over what it already knows** (`known`), so nothing is guessed.

## Ladder

| level | content | typical cost |
|---|---|---|
| 1 | last conclusion + that turn's user prompt | ~100 tok |
| 2 | last 3 turns (question + conclusion) | ~300 tok |
| 3 | full requirement timeline + compaction summaries | ~1k tok |
| 4 | files touched / commands / git state | ~3k tok |
| `turns` | any explicit slice (`12-14`, `last:5`, `from:60`, `around:40±2`) | you decide |

When the last turn has no conclusion (interrupted, still running, or only a progress note), level 1
says so instead of pretending the narration is a conclusion — and appends the most recent turn that
does have one, with its turn number and token cost.

## Install — let your agent do it

Published as **`@tianemon/ai-agent-bridge`**; the command it installs is **`aab`** (ai-agent-bridge),
because that is what an agent types dozens of times a day. `agent-bridge` is installed as an alias for
the rare case where `aab` collides with something else on your `PATH`.

Give this to any coding agent (Claude Code, Codex, WorkBuddy, whatever you use):

> Run `npx -y @tianemon/ai-agent-bridge install`, then
> `npx -y @tianemon/ai-agent-bridge doctor`, and show me the output. If the install output says WorkBuddy
> is not trusted, tell me the click path it prints (连接器 → 自定义连接器 → aab → 信任 /
> Connectors → Custom connectors → aab → Trust) — I have to do that part myself.

`install` **detects which clients actually exist on this machine and writes only to those**. Clients
you have not installed are skipped, never assumed. Everything it touches is backed up first, and it is
idempotent — re-running it changes nothing.

```bash
npx -y @tianemon/ai-agent-bridge install --dry-run    # show what it would write
npx -y @tianemon/ai-agent-bridge doctor               # what can be read, which hosts are wired up
npx -y @tianemon/ai-agent-bridge prompt               # the agent-facing instruction block
```

Or keep a permanent command:

```bash
git clone https://github.com/tianemon/ai-agent-bridge ~/dev/ai-agent-bridge
cd ~/dev/ai-agent-bridge && npm link     # puts `aab` on PATH (symlink: edits take effect immediately)
npm unlink -g @tianemon/ai-agent-bridge  # uninstall
```

No dependencies, no build step, Node ≥ 18. Without any install, everything works as
`node <path>/bin/aab.mjs <cmd>`.

### Development vs installed copy

`aab doctor` prints which copy you are running:

```
mode    npm 全局安装（正式安装）        # installed copy — what production should use
mode    开发目录（开发态：…）           # dev checkout — configs point at source, edits apply live
mode    npx 缓存                       # npx cache — configs point at `npx -y …`
```

`npm link` is for developing; for production install a real copy:

```bash
npm pack && npm i -g ./tianemon-ai-agent-bridge-<version>.tgz
aab install      # rewrite host configs to the new path
```

## Use as MCP server

The server is `aab mcp` (stdio). `install` writes this for you; the manual form is below if you want
to do it yourself or your client isn't covered yet.

> Terminal hosts (Claude Code, Codex CLI) can use the short `aab mcp`; GUI hosts (WorkBuddy, Codex
> Desktop) may spawn children with a minimal `PATH`, so give them an absolute command.

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

Tools exposed: `session_latest`, `session_list`, `session_read`, `session_grep`, `session_agents`.

### WorkBuddy requires one manual click after installing

WorkBuddy does not prompt when a new MCP server appears in its config, and it will not load one until you
approve it. After `aab install` reaches WorkBuddy you must click once:

```
连接器 → 自定义连接器 → aab → 信任
Connectors → Custom connectors → aab → Trust
```

`aab doctor` tells you the current state, so you never have to guess:

```
WorkBuddy    ✓ 已注册 · ✓ 已信任（2026-10-24 12:26）
WorkBuddy    ✓ 已注册 · ✗ 未信任 → 连接器 → 自定义连接器 → aab → 信任
WorkBuddy    ✓ 已注册 · ⚠ 信任记录对应的是旧配置，需重新点
```

This step cannot be automated, by design: the approval record is WorkBuddy's own security gate —
"a human confirms this server may run commands on this machine". A tool that writes its own approval
would be defeating the gate, and would open the same hole for anything else that drops an entry into the
config. If you would rather not click at all, two options:

- `aab install --agent codex,claude` — skip WorkBuddy entirely
- Use the CLI channel inside WorkBuddy instead of MCP: one line in the project's `CLAUDE.md` /
  `AGENTS.md` telling the agent to run `aab latest` when it needs another tool's session
  (no trust gate, but one shell round-trip per call)

## Use as CLI

```bash
aab list --since 24h                     # what happened lately: time, tool, project, id, size, title
aab latest --agent codex --level 1       # newest conclusion only
aab latest --agent codex --level 3       # still not enough? go one layer deeper
aab latest --turns 40-41                 # exact range
aab latest --turns 12                    # one turn
aab latest --turns last:5                # last 5 turns
aab latest --turns from:60               # from turn 60 to the end
aab latest --turns "around:40±2"         # window around turn 40 (default span 3)
aab latest --known '{"agent":"codex","session":"01a16729","turns":"last:3"}'
aab read --session 53bf411c --level 2
aab grep "paths-ignore" --agent claude --limit 3
aab rule                                 # standing rule to paste into CLAUDE.md / AGENTS.md
```

**Titles, not just ids.** Each line ends with the session title, because an id alone tells you nothing about
which conversation it is. Where the title comes from:

| tool | source | if renamed |
|---|---|---|
| Codex | `<CODEX_HOME>/session_index.jsonl` (`thread_name`) | the file **appends** a line per rename — the newest `updated_at` wins |
| WorkBuddy / CodeBuddy | `sessions.title` + `sessions.custom_title` in the app's SQLite DB | `custom_title` (your rename) beats the generated one; the row is always current |
| Claude Code / EasyMint | no title store — the first real user prompt is used | n/a |

The fallback is clipped to one line, and image-only first messages are skipped. Sessions whose transcript opens
with an image therefore show no title (the id is still there).

`--known` accepts JSON and is how a model hands over what it already knows (tool, project, session,
turn range, time window). Explicit flags win over `known` fields. In MCP the same knobs are
`known` and `maxChars`.

Output language: `AAB_LANG=en|zh` overrides, otherwise it follows `LC_ALL` / `LANG`. Conversation
content is never translated — only the surrounding labels change.

### Make it deterministic: `aab rule`

MCP's `InitializeResult.instructions` is specified as something the host *may* put into the system
prompt — optional. WorkBuddy does not, in practice: the model sees five bare tool names (deferred, so it
has to search before it can even read the descriptions). Descriptions raise the odds of a hit; only a file
the host reads every session makes it certain.

```bash
aab rule        # prints a 10-line section; stdout is paste-ready, the "which file" hint goes to stderr
```

Paste it into the project's `CLAUDE.md` (WorkBuddy, Claude Code) or `AGENTS.md` (Codex). It lists the
phrasings people actually use — "查看 codex 会话", "接着继续做", "read the codex session" — against the call
to make, and the one rule that matters most: do not hand-parse `rollout-*.jsonl`.

This is opt-in on purpose: it edits *your* repo's rule file, and which file applies depends on the host.

## Scope

Default is **this project**: the working directory, resolved to its git root. Use `--scope`:

| scope | behaviour |
|---|---|
| `auto` (default) | this project first; if nothing found, fall back to machine-wide **and say so** in the output |
| `project` | this project only — no fallback, reports not-found instead |
| `global` | machine-wide |

## Supported tools

| tool | session location | env override |
|---|---|---|
| Codex | `<home>/.codex/sessions/**/rollout-*.jsonl` | `CODEX_HOME` |
| Claude Code | `<home>/.claude/projects/<slug>/<uuid>.jsonl` | `CLAUDE_CONFIG_DIR` |
| WorkBuddy | `<home>/.workbuddy/projects/<slug>/<uuid>.jsonl` | `WORKBUDDY_HOME` |
| CodeBuddy | `<home>/.codebuddy/projects/<slug>/<uuid>.jsonl` | `CODEBUDDY_HOME` |
| EasyMint | `<home>/.easymint/agent/sessions/--<slug>--/<ts>_<id>.jsonl` | `EASYMINT_HOME` |

WorkBuddy and CodeBuddy share one writer (their transcripts even carry a `__codebuddyLocal` field), so a
single adapter covers both: `type:"message"` with `input_text` / `output_text` blocks, plus
`function_call` / `function_call_result` / `reasoning` / `file-history-snapshot` lines that we skip.
WorkBuddy wraps the user's prompt in a `<system-reminder>` envelope — the real text is inside
`<user_query>`, which is what we read.

Sub-agent traces (`subagents/*.jsonl`, `agent-*.jsonl`) are **deliberately excluded** — they are
internal delegation steps, not conversations with you. On the author's machine that filters out
hundreds of files while keeping every real conversation.

Facts verified against real data: Codex groups multiple files per thread by `session_meta.session_id`
(resumed threads write a new rollout file), Claude Code is one file per session, and compaction
summaries that masquerade as user messages (`isCompactSummary`) are separated out so they never
pollute the requirement timeline.

## Add another tool

Create `src/agents/<name>.mjs`:

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
};
```

then add it to `LIST` in `src/registry.mjs`. Nothing else changes.

## Limits

- **Read-only.** Writes nothing to any tool's data directory. The only external processes are
  `git log`, `git status`, `git rev-parse` — fixed arguments, no shell.
- Windows is untested. Directory-slug fallbacks assume POSIX paths; the primary `cwd` judgement reads
  it from the file itself, so this only affects sessions whose header lacks `cwd`.
- Not a session *browser*. If you want a UI and full-text search over transcripts, something like
  SpecStory already does that; this tool is the compressed handoff layer.
- Prompts are read verbatim. Anything you typed into a previous tool — including secrets — will be
  reproduced in the new context. Keep keys out of prompts.
- English and Chinese only. Every label the tool prints is localized (`AAB_LANG`), and the test suite
  fails if any command leaks Chinese in English mode — but a third language would need new dictionary
  entries in `src/i18n.mjs`, not a code change.
- WorkBuddy's trust gate cannot be automated. The approval record is signed by WorkBuddy itself; a tool
  that could write it would be defeating the gate. `aab doctor` reports the state instead.

## Maintaining

Release and installation rules live in [`docs/RELEASING.md`](docs/RELEASING.md) (Chinese), with the
short version in [`AGENTS.md`](AGENTS.md). The one-line summary: production runs the published package, not
this checkout.

## License

MIT
