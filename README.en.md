# ai-agent-bridge

Read another AI coding tool's session: **newest conclusion first, escalate only as needed**.

Supports Codex, Claude Code, WorkBuddy, CodeBuddy and EasyMint. Session data is read-only; the only writes
are the MCP client configs, made by `install` and previewable with `--dry-run`.

```bash
npx -y @tianemon/ai-agent-bridge install     # detect installed clients and write the MCP config
npx -y @tianemon/ai-agent-bridge doctor      # which sessions are readable, which client is registered
```

The installed command is `aab` (alias `agent-bridge`). No dependencies; Node ≥ 18.

## Output

```
■ Codex · 2026-10-25 10:03 · 4 segments · gpt-6.1-sol
  session 01a16729-0aed-7012 · 99 turns · /Users/amon/dev/project/EasyMint
  title 解析视频并仿制 UI 风格

【level 1 · latest progress (unfinished)】
turn 99 · asked: 重新发布1.4.0

(this turn has no conclusion — the session may be interrupted, still running, or the last
message was only a progress note)

我会把这些界面修正并入 1.4.0，完成发版检查后替换标签和 Release，触发三平台重新构建。

── fallback: last conclusion was turn 98 (~+93 token) ──
已实现：Mint 头像和名称移到回复上方；去掉回复气泡底色；只有结论保留复制、钉住、重新回答。

── not enough? ask for another view (same session, another level) ──
  level=2  last 3 turns  ≈ 551 token total (+368 over this reply)
  level=3  full requirement + conclusion timeline  ≈ 4130 token total (+3947 over this reply)
  level=4  commands / files / git state  ≈ 2494 token total (+2311 over this reply)
  current level=1 ≈ 183 token
```

The source session is 87 MB; `level=1` is 183 tokens.

## Levels

| Level | Content | Cost (measured on the 99-turn session) |
|---|---|---|
| 1 | last conclusion + its prompt | 183 tokens |
| 2 | last 3 turns (prompt + conclusion) | 551 tokens |
| 3 | every prompt + what it settled on | 4130 tokens |
| 4 | changed files / commands / git state | 2494 tokens (top 40 files, last 15 commands) |
| `turns` | explicit slice: `12-14`, `12`, `last:5`, `from:60`, `around:40±2` | by slice |

Each level is an independent view, not an accumulation: a quote is the full cost of that view, regardless of
where you stopped. Level 3 grows linearly with the turn count and can exceed level 4 on a long session —
choose by quote, not by depth.

When the last turn has no conclusion (interrupted, still running, or a progress note), level 1 says so
explicitly and appends the most recent turn that has one, with its turn number and cost.

## Design choices

- **Never read the whole transcript.** Only user prompts, final assistant text, tool-call targets and git
  state; reasoning blocks, tool output and `base_instructions` are skipped.
- **Four levels, stop when it is enough.** Each reply quotes the token cost of the next level.
- **The caller supplies what it already knows** (`--known` / `known`) instead of the tool guessing.

## Install

`install` writes configuration only for clients actually present on the machine, backs up before writing, and
is idempotent. Supported hosts: WorkBuddy, Codex, Claude Code, EasyMint.

```bash
npx -y @tianemon/ai-agent-bridge install --dry-run              # print what would be written
npx -y @tianemon/ai-agent-bridge install --agent codex,claude   # limit to specific clients
npx -y @tianemon/ai-agent-bridge install easymint               # EasyMint only (same as --agent easymint)
aab prompt                                                      # print instructions an agent can follow
```

It also runs without installing: `node <repo>/bin/aab.mjs <command>`.

To run from source, pack and install a real copy rather than linking:

```bash
npm pack && npm i -g ./tianemon-ai-agent-bridge-<version>.tgz
aab install          # point the client configs at the new path
```

The `mode` line of `aab doctor` reports the current form: `npm global install` / `checkout` / `npx cache`.

## As an MCP server

The server is `aab mcp` (stdio). `install` writes the configuration; the forms below are for manual setups or
clients not covered yet.

> Terminal hosts (Claude Code, Codex CLI) accept the short `aab mcp`; GUI hosts (WorkBuddy, Codex Desktop)
> may spawn children with a minimal `PATH`, so give them an absolute path.

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

**EasyMint** — `<EASYMINT_HOME>/agent/mcp.json` (defaults to `~/.easymint/agent/mcp.json`; if the legacy
`~/.easymint/mcp.json` still holds entries, that file is updated instead so nothing gets shadowed)

```json
{
  "mcpServers": {
    "aab": {
      "type": "stdio",
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/you/dev/ai-agent-bridge/bin/aab.mjs", "mcp"],
      "description": "Read another AI coding tool's session"
    }
  }
}
```

Tools: `session_latest`, `session_list`, `session_read`, `session_grep`, `session_agents`.

### WorkBuddy needs one manual confirmation

WorkBuddy does not prompt for a new MCP server and does not load it before confirmation. After `aab install`
writes the entry, confirm once:

```
连接器 → 自定义连接器 → aab → 信任
Connectors → Custom connectors → aab → Trust
```

`aab doctor` reports the state:

```
WorkBuddy    ✓ registered · ✓ trusted (2026-10-24 12:26)
WorkBuddy    ✓ registered · ✗ not trusted → 连接器 → 自定义连接器 → aab → 信任
WorkBuddy    ✓ registered · ⚠ trust record is for an older config, confirm again
```

The approval record is issued by WorkBuddy; the tool does not write it. To skip WorkBuddy, either:

- `aab install --agent codex,claude` — do not touch WorkBuddy
- use the CLI instead of MCP: add a line to the project's `CLAUDE.md` / `AGENTS.md` telling the agent to run
  `aab latest` when it needs another tool's session

## As a CLI

```bash
aab list --since 24h                     # time, tool, project, id, size, title
aab latest --agent codex --level 1       # newest conclusion
aab latest --agent codex --level 3       # one level deeper
aab latest --turns 40-41                 # exact range
aab latest --turns last:5                # last five turns
aab latest --turns from:60               # turn 60 to the end
aab latest --turns "around:40±2"         # window around turn 40 (span 3 by default)
aab latest --known '{"agent":"codex","session":"01a16729","turns":"last:3"}'
aab read --session 53bf411c --level 2
aab grep "paths-ignore" --agent claude --limit 3   # hits carry session id and turn number
aab rule                                 # standing rule to paste into CLAUDE.md / AGENTS.md
```

A `grep` hit is labelled `turn N`, so the follow-up is `aab read --session <id> --turns N`. When the hit limit
is reached the output suggests narrowing with `--agent` / `--since`; scanning goes newest activity first.

### Titles

Both the list and the session header carry a title. Sources:

| Tool | Source | After a rename |
|---|---|---|
| Codex | `thread_name` in `<CODEX_HOME>/session_index.jsonl` | the file is appended to: one line per rename, so take the newest `updated_at` |
| WorkBuddy / CodeBuddy | `sessions.title`, `sessions.custom_title` in the app's SQLite DB | `custom_title` wins; the row holds the current value |
| Claude Code / EasyMint | no title store — the first real user prompt is used | n/a |

The fallback title is collapsed to one line and skips image-only messages, so a session whose first message
is an image has no title (the id still works).

`--known` accepts JSON (tool, project, session, turn range, time window). Explicit flags win over same-named
fields; the MCP equivalents are `known` and `maxChars`.

Output language: `AAB_LANG=zh|en`, otherwise `LC_ALL` / `LANG` (English by default). Conversation text is
never translated — only the surrounding labels change.

### Making it deterministic: `aab rule`

MCP's `InitializeResult.instructions` is optional in the specification; a host may omit it. WorkBuddy omits
it in practice, so the model sees only tool names (deferred, requiring a search first). Descriptions therefore
only raise the odds of a hit; a file the host reads every session is what makes it certain.

```bash
aab rule        # prints the snippet; stdout is paste-ready, the "which file" hint goes to stderr
```

Paste it into the project's `CLAUDE.md` (WorkBuddy, Claude Code) or `AGENTS.md` (Codex). It maps phrasings to
calls (「查看 codex 会话」, 「接着继续做」) and states not to parse `rollout-*.jsonl` by hand. Optional.

## Scope

The default is **this project**: the working directory resolved to its git root. `--scope` changes it:

| scope | Behaviour |
|---|---|
| `auto` (default) | this project first; falls back to the whole machine and says so in the output |
| `project` | this project only; no fallback, errors if empty |
| `global` | the whole machine |

## Supported tools

| Tool | Session location | Env override |
|---|---|---|
| Codex | `<home>/.codex/sessions/**/rollout-*.jsonl` | `CODEX_HOME` |
| Claude Code | `<home>/.claude/projects/<slug>/<uuid>.jsonl` | `CLAUDE_CONFIG_DIR` |
| WorkBuddy | `<home>/.workbuddy/projects/<slug>/<uuid>.jsonl` | `WORKBUDDY_HOME` |
| CodeBuddy | `<home>/.codebuddy/projects/<slug>/<uuid>.jsonl` | `CODEBUDDY_HOME` |
| EasyMint | `<home>/.easymint/agent/sessions/--<slug>--/<ts>_<id>.jsonl` | `EASYMINT_HOME` |

WorkBuddy and CodeBuddy share one writer (transcripts carry a `__codebuddyLocal` field), so one adapter covers
both: `type:"message"` with `input_text` / `output_text` blocks, while `function_call`, `function_call_result`,
`reasoning` and `file-history-snapshot` lines are skipped. WorkBuddy wraps the user prompt in a
`<system-reminder>` envelope; the actual text is inside `<user_query>`.

Subagent traces (`subagents/*.jsonl`, `agent-*.jsonl`) are excluded: they are internal delegation, not the
conversation with the user.

Parsing details: Codex groups several rollout files into one thread by `session_meta.session_id` (a continued
session writes a new file); Claude Code is one file per session; compaction summaries disguised as user
messages (`isCompactSummary`) are isolated.

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
  userTurnOf(o) {},            // does a parsed line start a turn? return the user text or ""
  userMarker: '"role":"user"', // cheap literal prefilter: only parse when present
};
```

Then register it in `LIST` in `src/registry.mjs`.

## Limits

- **Session data is read-only.** It never writes another tool's data directory; the only writes are the MCP
  configs (`install`, previewable). The only external processes are `git log`, `git status` and `git rev-parse`,
  with fixed arguments and no shell.
- A single session can reach tens of MB (87 MB measured here); it is read level by level so it never
  enters the context whole.
- Windows is untested. The directory-slug fallback assumes POSIX paths; the primary signal is the `cwd` read
  from the file, so this only affects sessions whose header lacks one.
- It is not a session browser and offers no full-text search UI; it provides tiered reading only.
- User prompts are reproduced verbatim. Anything typed into the previous tool — including secrets — will
  appear in the new context.
- Only Chinese and English output. Every label goes through the `src/i18n.mjs` dictionary; in English mode a
  single Chinese string makes the tests fail. Adding a language means adding dictionary entries only.
- WorkBuddy's trust confirmation cannot be automated; `aab doctor` only reports the state.

## Maintaining

Release and installation rules live in [`docs/RELEASING.md`](docs/RELEASING.md), with the short version in
[`AGENTS.md`](AGENTS.md). Production runs the published package, not this checkout.

## License

MIT
