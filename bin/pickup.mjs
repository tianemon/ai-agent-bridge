#!/usr/bin/env node
/**
 * pickup 入口。两种形态：
 *
 *   pickup <command>    一次性 CLI
 *   pickup mcp          常驻 stdio MCP server
 */
import { runCli } from "../src/cli.mjs";
import { serveMcp } from "../src/mcp.mjs";

const [cmd = "latest", ...rest] = process.argv.slice(2);

if (cmd === "mcp") {
  serveMcp();
} else {
  runCli([cmd, ...rest])
    .then((text) => process.stdout.write(text + "\n"))
    .catch((e) => {
      process.stderr.write(String(e?.stack || e) + "\n");
      process.exitCode = 1;
    });
}
