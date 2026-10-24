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
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOME = os.homedir();
export const NAME = "aab";
export const LEGACY = ["pickup", "session-bridge"];

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
      const text = fs.readFileSync(HOSTS.codex.config, "utf8");
      // 段名必须跟着 NAME 走：install 写的是 [mcp_servers.aab]，这里曾硬编码成旧名
      // → doctor 永远报「Codex 未注册」。旧名由 LEGACY 兜住。
      return [NAME, ...LEGACY].some((n) => text.includes(`[mcp_servers.${n.replace(/-/g, "_")}]`));
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

/**
 * WorkBuddy 的信任状态（连接器 → 自定义连接器 → aab → 信任）。
 *
 * 它记在 ~/.workbuddy/mcp-approvals.json 里，key 形如 `<sha256>::<server>`。
 * 那个 hash 我们推不出算法，所以不重算，改用时间戳对比：
 * 信任记录早于配置文件的修改时间 = 配置在信任之后被改过，很可能需要重新信任。
 */
export function approvalState(host) {
  if (host !== "workbuddy") return null;
  const file = path.join(HOME, ".workbuddy", "mcp-approvals.json");
  let map;
  try {
    map = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { approved: false, ts: 0 };
  }
  // 只认当前服务名：旧名（pickup / session-bridge）的授权记录不能沿用，
  // 改名后配置指纹变了，WorkBuddy 会要求重信任
  const hit = Object.keys(map).find((k) => k.endsWith(`::${NAME}`));
  const legacyHit = Object.keys(map).find((k) => LEGACY.some((n) => k.endsWith(`::${n}`)));
  if (!hit) return { approved: false, ts: 0, legacyOnly: !!legacyHit };

  // 只报事实：有没有信任记录、什么时候点的。
  // 不去比较配置 mtime——宿主自己也会重写 mcp.json，比出来的是假阳性。
  return { approved: true, ts: Number(map[hit]) || 0 };
}

/** 我们上次装进去的那条配置的指纹；用来判断"信任之后配置有没有变过" */
const STATE_FILE = path.join(HOME, ".aab", "state.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function recordEntry(host, entry) {
  const st = readState();
  st[host] = {
    hash: crypto.createHash("sha256").update(JSON.stringify(entry)).digest("hex").slice(0, 16),
    ts: Date.now(),
  };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2) + "\n");
}

/** 当前配置 vs 我们上次写的：false = 配置在安装后被改过（信任大概率失效） */
export function entryUnchanged(host) {
  const rec = readState()[host]?.hash;
  if (!rec) return true; // 没有记录就不下结论
  if (host !== "workbuddy") return true;
  try {
    const cur = JSON.parse(fs.readFileSync(HOSTS.workbuddy.config, "utf8"))?.mcpServers?.[NAME];
    const now = crypto.createHash("sha256").update(JSON.stringify(cur)).digest("hex").slice(0, 16);
    return now === rec;
  } catch {
    return true;
  }
}

export function detectHosts() {
  return Object.entries(HOSTS)
    .filter(([, h]) => h.detect())
    .map(([k]) => k);
}
