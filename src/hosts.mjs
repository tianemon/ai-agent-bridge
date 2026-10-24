/**
 * 宿主（host）与读取源（reader）是两件事，别混：
 *
 *   reader = 会话格式能被读的工具（codex / claude / easymint）
 *   host   = 能挂 MCP、从而调用本工具的工具（workbuddy / codex / claude / 未来的 cursor…）
 *
 * codex 与 claude 两者都是；workbuddy 只是 host。
 * 检测一律"文件存在才算"，用户没装的客户端一个字都不写。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOME = os.homedir();
export const NAME = "pickup";
export const LEGACY = ["session-bridge"];

export const HOSTS = {
  workbuddy: {
    label: "WorkBuddy",
    config: path.join(HOME, ".workbuddy", "mcp.json"),
    detect: () => fs.existsSync(path.join(HOME, ".workbuddy")),
  },
  codex: {
    label: "Codex",
    config: path.join(HOME, ".codex", "config.toml"),
    detect: () => fs.existsSync(path.join(HOME, ".codex")),
  },
  claude: {
    label: "Claude Code",
    config: "claude mcp (user scope)",
    detect: () => {
      // 先看有没有配置痕迹再去唤起 claude：它首次运行会自己创建 ~/.claude 与 ~/.claude.json，
      // 不能因为"探测"就在别人的机器上写东西
      const home = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
      if (!fs.existsSync(home) && !fs.existsSync(path.join(HOME, ".claude.json"))) return false;
      try {
        execFileSync("claude", ["mcp", "list"], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] });
        return true;
      } catch {
        return false;
      }
    },
  },
};

/** 已注册返回 true；未注册 false；宿主 CLI 不可用返回 null */
export function registered(host) {
  if (host === "workbuddy") {
    try {
      return !!JSON.parse(fs.readFileSync(HOSTS.workbuddy.config, "utf8"))?.mcpServers?.[NAME];
    } catch {
      return false;
    }
  }
  if (host === "codex") {
    try {
      return fs.readFileSync(HOSTS.codex.config, "utf8").includes("[mcp_servers.session_bridge]");
    } catch {
      return false;
    }
  }
  try {
    const out = execFileSync("claude", ["mcp", "list"], {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.includes(`${NAME}:`);
  } catch {
    return null;
  }
}

export function detectHosts() {
  return Object.entries(HOSTS)
    .filter(([, h]) => h.detect())
    .map(([k]) => k);
}
