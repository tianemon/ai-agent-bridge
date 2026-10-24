# agent-session-bridge

Read another AI coding tool's session — **newest conclusion first, escalate only as far as you need**.

Switch from Codex to Claude Code, or from Claude Code to any MCP-capable agent, and pick up where the
previous tool left off — without stuffing a 30 MB transcript into the context window.

```
■ Codex · 2026-10-23 21:59 · 续跑 2 段 · gpt-6.1-sol
  会话 01a16729-0aed-7012 · 共 41 轮需求 · /Users/amon/dev/project/EasyMint

【level 1 · 最新进展（未收尾）】
第 41 轮 · 用户问：按我理解，这应该就是大概的样子…确认明白就开始实现
（该轮没有收尾结论——会话可能中断、仍在运行，或最后一条只是进展旁白）
正式界面中已确认：组件/布局切换、Web/移动端切换、配色、效果和放大预览入口都在…

── 信息不够就再要一层（同一会话再调一次，加 level）──
  level=2  最近 3 轮问答  ≈ +288 token
  level=3  全部需求时间线  ≈ +962 token
  level=4  命令 / 文件 / git 状态  ≈ +2836 token
```

Above: 101 tokens instead of the session's ~9M. The caller decides when to stop, because every layer
reports what the next one costs.

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
| `turns` | any explicit range (`12-14`, `last:5`) | you decide |

When the last turn has no conclusion (interrupted, still running, or only a progress note), level 1
says so instead of pretending the narration is a conclusion — that difference matters when you are
about to continue someone else's work.

## Install — let your agent do it

Published as **`@tianemon/agent-session-bridge`**; the command it installs is **`pickup`** — short for
*where the previous tool left off*, because that is what an agent types dozens of times a day.

Give this to any coding agent (Claude Code, Codex, WorkBuddy, whatever you use):

> Run `npx -y @tianemon/agent-session-bridge install`, then
> `npx -y @tianemon/agent-session-bridge doctor`, and show me the output.

`install` **detects which clients actually exist on this machine and writes only to those**. Clients
you have not installed are skipped, never assumed. Everything it touches is backed up first, and it is
idempotent — re-running it changes nothing.

```bash
npx -y @tianemon/agent-session-bridge install --dry-run    # show what it would write
npx -y @tianemon/agent-session-bridge doctor               # what can be read, which hosts are wired up
npx -y @tianemon/agent-session-bridge prompt               # the agent-facing instruction block
```

Or keep a permanent command (the checkout is symlinked, so edits take effect immediately):

```bash
git clone https://github.com/tianemon/agent-session-bridge ~/dev/agent-session-bridge
cd ~/dev/agent-session-bridge && npm link     # puts `pickup` on PATH
npm unlink -g @tianemon/agent-session-bridge  # uninstall
```

No dependencies, no build step, Node ≥ 18. Without any install, everything works as
`node <path>/bin/pickup.mjs <cmd>`.

## Use as MCP server

The server is `pickup mcp` (stdio). `install` writes this for you; the manual form is below if you want
to do it yourself or your client isn't covered yet.

> Terminal hosts (Claude Code, Codex CLI) can use the short `pickup mcp`; GUI hosts (WorkBuddy, Codex
> Desktop) may spawn children with a minimal `PATH`, so give them an absolute command.

**WorkBuddy** — `~/.workbuddy/mcp.json`

```json
{
  "mcpServers": {
    "pickup": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/you/dev/pickup/bin/pickup.mjs", "mcp"]
    }
  }
}
```

**Codex** — `~/.codex/config.toml`

```toml
[mcp_servers.pickup]
command = "/opt/homebrew/bin/node"
args = ["/Users/you/dev/pickup/bin/pickup.mjs", "mcp"]
startup_timeout_sec = 20
```

**Claude Code**

```bash
claude mcp add --scope user pickup pickup mcp
```

Tools exposed: `session_latest`, `session_list`, `session_read`, `session_grep`, `session_agents`.

## Use as CLI

```bash
pickup list --since 24h                     # what happened lately, one line each
pickup latest --agent codex --level 1       # newest conclusion only
pickup latest --agent codex --level 3       # still not enough? go one layer deeper
pickup latest --turns 40-41                 # you already know which turns you need
pickup latest --known '{"agent":"codex","session":"01a16729","turns":"last:3"}'
pickup read --session 53bf411c --level 2
pickup grep "paths-ignore" --agent claude --limit 3
```

`--known` accepts JSON and is how a model hands over what it already knows (tool, project, session,
turn range, time window). Explicit flags win over `known` fields.

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
| EasyMint | `<home>/.easymint/agent/sessions/--<slug>--/<ts>_<id>.jsonl` | `EASYMINT_HOME` |

Sub-agent traces (`subagents/*.jsonl`) are **deliberately excluded** — they are internal delegation
steps, not conversations with you. On this author's machine that is 622 sub-agent trace files filtered out of 706 JSONL files (63 real sessions).

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
- Cannot read tools whose sessions are not plain JSONL (e.g. WorkBuddy stores no external transcript).
- Windows is untested. Directory-slug fallbacks assume POSIX paths; the primary `cwd` judgement reads
  it from the file itself, so this only affects sessions whose header lacks `cwd`.
- Not a session *browser*. If you want a UI and full-text search over transcripts, something like
  SpecStory already does that; this tool is the compressed handoff layer.

## License

MIT
