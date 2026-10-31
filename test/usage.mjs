import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sessionUsage, renderUsage } from "../src/usage.mjs";

export async function usageTests() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aab-usage-"));
  const dir = path.join(root, "sessions", "2026", "01", "01");
  fs.mkdirSync(dir, { recursive: true });
  const event = (type, payload, n = 0) => ({ timestamp: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`, type, payload });
  const usage = (input, output = 10) => ({ input_tokens: input, cached_input_tokens: input / 2, output_tokens: output, reasoning_output_tokens: 2, total_tokens: input + output });
  const meta = (id, parent) => event("session_meta", { id, session_id: "main", cwd: root, ...(parent ? { source: { subagent: { thread_spawn: { parent_thread_id: parent, agent_path: "/root/helper" } } } } : {}) });
  const context = (model = "model-a", turn = "turn-1") => event("turn_context", { model, effort: "medium", turn_id: turn });
  const record = (id, n, input, turn = "turn-1", thread = "main", rootTurn = turn) => event("token_usage_record", { response_id: id, thread_id: thread, turn_id: turn, root_turn_id: rootTurn, usage: usage(input) }, n);
  const snapshot = (n, input, last = 100) => event("event_msg", { type: "token_count", info: { total_token_usage: usage(input), last_token_usage: usage(last) }, rate_limits: { primary: { used_percent: n, window_minutes: 300, resets_at: 123 } } }, n);
  const write = (name, rows) => fs.writeFileSync(path.join(dir, `rollout-${name}.jsonl`), rows.map(x => typeof x === "string" ? x : JSON.stringify(x)).join("\n") + "\n");
  let count = 0;
  const check = async (name, fn) => { await fn(); count++; console.log(`  usage ✓ ${name}`); };
  try {
    write("main", [meta("main"), context(), record("one", 1, 100), snapshot(1, 100), record("two", 2, 200), snapshot(2, 300), snapshot(3, 300),
      event("response_item", { content: "SECRET BODY AND TOKEN EXAMPLE", type: "message", usage: usage(999999) }),
      event("compacted", { message: "SECRET SUMMARY" }, 2), "{broken"]);
    write("child", [meta("child", "main"), context("model-b", "child-turn"), record("c", 2, 50, "child-turn", "child", "turn-1")]);
    write("grandchild", [meta("grand", "child"), context("model-c", "grand-turn"), record("g", 2, 40, "grand-turn", "grand", "turn-1")]);
    await check("per-response preferred, no cumulative double counting, no content", async () => {
      const r = await sessionUsage({ session: "main", root });
      assert.equal(r.tokens.input_tokens, 300); assert.equal(r.tokens.output_tokens, 20); assert.equal(r.responses, 2);
      assert.equal(r.threads[0].maxInput, 200); assert.equal(r.threads[0].compactions, 1);
      assert.equal(r.threads[0].cacheHitPercent, 50); assert.equal(r.threads[0].rateLimits.first.primary.usedPercent, 1);
      assert.ok(!JSON.stringify(r).includes("SECRET")); assert.ok(!renderUsage(r).includes("SECRET"));
    });
    await check("physical IDs separate shared session_id; recursive children counted once", async () => {
      const r = await sessionUsage({ session: "main", includeChildren: true, root });
      assert.equal(r.threads.length, 3); assert.equal(r.tokens.input_tokens, 390); assert.equal(r.responses, 4);
      assert.equal(r.threads[1].models[0].model, "model-b");
    });
    await check("inclusive event bounds retain baseline outside range", async () => {
      const r = await sessionUsage({ session: "main", since: "2026-01-01T00:00:02Z", until: "2026-01-01T00:00:02Z", root });
      assert.equal(r.tokens.input_tokens, 200); assert.equal(r.responses, 1);
    });
    await check("root turn matches descendant turns", async () => {
      const r = await sessionUsage({ session: "main", turnId: "turn-1", includeChildren: true, root });
      assert.equal(r.tokens.input_tokens, 390);
    });
    await check("replayed response IDs deduplicated across segments", async () => {
      write("main-copy", [meta("main"), context(), record("one", 1, 100)]);
      assert.equal((await sessionUsage({ session: "main", root })).responses, 2);
    });
    await check("legacy snapshots use deltas; duplicates do not repeat last usage", async () => {
      write("legacy", [meta("legacy"), context(), snapshot(1, 100), snapshot(2, 300), snapshot(3, 300)]);
      const r = await sessionUsage({ session: "legacy", since: "2026-01-01T00:00:02Z", root });
      assert.equal(r.tokens.input_tokens, 200); assert.equal(r.responses, 1); assert.equal(r.threads[0].source, "token_count_delta");
      assert.equal((await sessionUsage({ session: "legacy", root })).threads[0].coverage.initialCumulativeBaseline, true);
    });
    await check("legacy resets do not reuse lifetime totals", async () => {
      write("reset", [meta("reset"), context(), snapshot(1, 100), snapshot(2, 300), snapshot(3, 100, 20), snapshot(4, 300)]);
      const r = await sessionUsage({ session: "reset", root });
      assert.equal(r.tokens.input_tokens, 520); assert.equal(r.threads[0].coverage.counterResets, 1);
    });
    await check("partial historical coverage and missing fields disclosed", async () => {
      write("partial", [meta("partial"), context(), snapshot(1, 100), { ...record("p", 2, 50, "turn-1", "partial"), payload: { response_id: "p", thread_id: "partial", usage: { input_tokens: 50, output_tokens: 10 } } }]);
      const s = (await sessionUsage({ session: "partial", root })).threads[0];
      const older = await sessionUsage({ session: "partial", until: "2026-01-01T00:00:01Z", root });
      assert.equal(older.tokens.input_tokens, 100); assert.equal(older.threads[0].source, "token_count_delta");
      assert.equal(s.coverage.earlierCumulativeOnly, true); assert.ok(s.coverage.missingFields.includes("cached_input_tokens")); assert.equal(s.cacheHitPercent, null);
    });
    await check("model changes within one turn and execution metadata preserved", async () => {
      write("switch", [meta("switch"), context("first"), event("event_msg", { type: "task_started", turn_id: "turn-1" }),
        record("s1", 1, 100, "turn-1", "switch"), context("second"), record("s2", 2, 200, "turn-1", "switch"),
        event("event_msg", { type: "task_complete", turn_id: "turn-1", duration_ms: 2000 }, 2)]);
      const s = (await sessionUsage({ session: "switch", root })).threads[0];
      assert.deepEqual(s.models.map(m => m.model), ["first", "second"]); assert.equal(s.turns[0].execution.durationMs, 2000);
    });
    await check("invalid counters ignored, empty range not represented as known zero", async () => {
      write("bad", [meta("bad"), context(), record("b", 1, -10, "turn-1", "bad")]);
      const r = await sessionUsage({ session: "bad", root });
      assert.equal(r.threads[0].coverage.invalidRecords, 1); assert.equal(r.responses, 0); assert.ok(renderUsage(r).length > 0);
    });
    await check("invalid range, unsupported agent, ambiguous and missing thread rejected", async () => {
      for (const o of [{ since: "nonsense" }, { since: "2026-01-02", until: "2026-01-01" }, { agent: "claude" }, { session: "m" }, { session: "none" }]) {
        if (o.session === "m") write("more", [meta("more")]);
        await assert.rejects(sessionUsage({ session: "main", root, ...o }));
      }
    });
    await check("CLI JSON and English output with isolated source", async () => {
      const bin = new URL("../bin/aab.mjs", import.meta.url).pathname;
      const env = { ...process.env, CODEX_HOME: root, AAB_LANG: "en" };
      const r = spawnSync(process.execPath, [bin, "usage", "--session", "main", "--json"], { env, encoding: "utf8" });
      assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).tokens.input_tokens, 300);
      const text = spawnSync(process.execPath, [bin, "usage", "--session", "main", "--include-children"], { env, encoding: "utf8" });
      assert.equal(text.status, 0); assert.ok(!/[\u4e00-\u9fff]/.test(text.stdout)); assert.ok(text.stdout.includes("model-b"));
      const mcp = spawnSync(process.execPath, [bin, "mcp"], { env, encoding: "utf8", input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "session_usage", arguments: { session: "main", includeChildren: true, json: true } } }) + "\n" });
      assert.equal(mcp.status, 0);
      const answer = JSON.parse(mcp.stdout).result;
      assert.ok(!answer.isError); assert.equal(JSON.parse(answer.content[0].text).tokens.input_tokens, 390);
    });
    return count;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
