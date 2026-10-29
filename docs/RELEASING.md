# 发布与安装（维护者 SOP）

本文件写给**维护这个仓库的 AI 会话**。目标：一次发布不产生任何"发布后才发现"的问题。

---

## 0. 两个目录，先分清

| 角色 | 路径 | 谁在用 |
|---|---|---|
| **源码（开发）** | `/Users/amon/dev/project/ai-agent-bridge` | 改代码、跑测试、打包 |
| **生产（安装）** | `/opt/homebrew/lib/node_modules/@tianemon/ai-agent-bridge` | 各家宿主的 MCP 配置指向它；`aab` 命令走它 |

判断当前是哪一种：

```bash
aab doctor | sed -n '/runtime/,+5p'      # 中文环境把 runtime 换成 运行时
# mode  npm 全局安装（正式安装）   → 生产
# mode  开发目录（开发态…）        → 源码
```

四家宿主写入的都是**绝对路径**（不依赖 `PATH`，GUI 宿主也能启动）：

```
~/.workbuddy/mcp.json          mcpServers.aab = {command: <node>, args: [<生产路径>/bin/aab.mjs, "mcp"]}
~/.codex/config.toml           [mcp_servers.aab] 同上
claude mcp (user scope)        同上
~/.easymint/agent/mcp.json     mcpServers.aab = {type: "stdio", command: <node>, args: [<生产路径>/bin/aab.mjs, "mcp"]}
```

### EasyMint 的路径规则（改 `hosts.mjs` / `install.mjs` 前必读）

- 生效路径跟 EasyMint 自己的 `userMcpPath()` 对齐：`<EASYMINT_HOME>/agent/mcp.json`（`EASYMINT_HOME` 去空白、展开 `~`，缺省 `~/.easymint`）；只有该文件缺失或损坏时，才回退到旧位置 `<EASYMINT_HOME>/mcp.json`，且旧文件里**有非空 `mcpServers`** 才接管。
- 所以安装器**不能**在旧配置还在用时另建新文件——那会把旧文件里的其它 server 整批遮蔽掉。迁移是 EasyMint 自己的事，`aab` 不代劳。
- 合并写 `mcpServers.aab`，保留其它 server 和顶层字段；配置损坏就拒绝，不覆盖；同目录临时文件 + `rename` 原子替换，免得 EasyMint 读到半截 JSON。
- 不碰 `em-settings.json`（隐藏/启用列表在那里），user scope 也不需要审批。

## 1. 安装原则

### 生产必须是"发布产物的副本"

```bash
npm i -g @tianemon/ai-agent-bridge@<version> --registry=https://registry.npmjs.org/
```

- 这样生产里跑的就是**别人 `npx` 能装到的那份字节**，`aab doctor` 显示 `npm 全局安装`
- 升级到新版本时**路径不变** → 各家的 MCP 配置不用重写，WorkBuddy 的信任指纹也不变

### 开发期想立刻验证改动，用打包安装，不要 link

```bash
npm run pack                                    # 产出到 /tmp，不落仓库
npm i -g /tmp/tianemon-ai-agent-bridge-<ver>.tgz
```

代价：要重新跑一次上面那条，才换成新的。**这是刻意的**——生产不能跟着源码漂。

### 三件绝对不做的事

1. **不要对生产路径 `npm link`。** 曾经的后果：源码一改就上线，`doctor` 变成"开发目录"，
   而且没人知道线上到底是哪个版本。
2. **不要把全局包装进宿主自带运行时**（`~/.workbuddy/binaries/node/versions/<v>/...`）。
   宿主升级会整块替换该目录，装进去的包直接消失；而且 `which -a aab` 会出现两个，
   `PATH` 顺序决定你敲到哪一个。
3. **不要手改宿主自己的 MCP 配置**。用 `aab install`：它会备份、会清旧名（`pickup`/`session-bridge`）、
   重复执行不累积。它**只写本机确实装了的客户端**，没装的跳过。

---

## 2. 发版前检查清单（全部勾完再 bump）

- [ ] `node test/run.mjs` 全绿（当前 78 条；**新增命令必须同时加进 `AAB_LANG=en` 那条闸门**）
- [ ] 源码扫一遍中文字面量：只剩 `zh` 版 help/prompt、`mcp` 里的中文触发词、WorkBuddy 中文菜单路径
- [ ] 中英字典键一一对齐（测试已覆盖 `validateDict()`）
- [ ] `README.md`（中文，默认）与 `README.en.md` 都写上了新命令/新行为（两版要同步）
- [ ] `aab help` 里有新命令，且 `--agent` 列表写全（`codex|claude|workbuddy|codebuddy|easymint|auto`）
- [ ] `git status` 干净；没有 `*.tgz` 之类打包产物被跟踪
- [ ] 结论里有"发布后才可能发现"的项，就在**这一步**查，不要留到发布后

> 反面教材：0.1.3 发完才去扫源码，发现 `install`/`prompt`/`help` 还是中文 → 0.1.4；
> 0.1.4 发完才发现 `list`/`grep` 静默吞参数 → 0.1.5。半小时三个版本，全部可以避免。

---

## 3. 一次完整发布（照抄即可）

设 `V=0.1.7`（下一个可用版本；**已发布的版本号永久占用，不能重发**）。

### 3.1 升版本

```bash
cd /Users/amon/dev/project/ai-agent-bridge
git status --short                      # 必须为空或只有本次发版改动
npm version $V --no-git-tag-version
node test/run.mjs | tail -2             # 再跑一次，版本号变了也要绿
```

### 3.2 打包并记下本地指纹

```bash
npm run pack                            # → /tmp/tianemon-ai-agent-bridge-$V.tgz
# 输出里记 shasum:  <LOCAL_SHA>
ls *.tgz 2>/dev/null                    # 必须为空：产物不许落仓库
```

### 3.3 提交并推送

```bash
git add -A && git commit -F - <<'MSG'
<这次改了什么、为什么>
MSG
git push origin main
```

### 3.4 发布（需要人工过 2FA）

按 npm 现在的规则，发布必须验证：**`--auth-type=web` + security key**，不需要 6 位验证码。

```bash
rm -f /tmp/npm-pub-$V.log
(script -q /dev/null npm publish --auth-type=web > /tmp/npm-pub-$V.log 2>&1 &)
sleep 10
sed -e 's/\x1b\[[0-9;]*m//g' /tmp/npm-pub-$V.log \
  | grep -oE "https://www\.npmjs\.com/auth/cli/[a-f0-9-]+" | head -1
```

**把这条链接发给用户点一下**（这一步只能人做）。然后等回执：

```bash
sed -e 's/\x1b\[[0-9;]*m//g' /tmp/npm-pub-$V.log \
  | tr -s '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' ' ' | grep -E "\+ @tianemon|npm error" | head -3
```

### 3.5 等元数据、比对指纹（不可跳过）

```bash
for i in $(seq 1 24); do
  s=$(npm view @tianemon/ai-agent-bridge@$V dist.shasum --registry=https://registry.npmjs.org/ 2>/dev/null)
  [ -n "$s" ] && break; sleep 5
done
echo "线上: $s"; echo "本地: <LOCAL_SHA>"
```

- 一致 → 继续
- 不一致 → **不要打 tag**，先查为什么（打包时工作树和提交不一致是典型原因）

元数据有时要等 1–3 分钟才可见（`npm view` 返回空），这是 npm 侧扫描，不是失败。

### 3.6 打 tag（在指纹核对之后）

```bash
git tag -a v$V -m "v$V — <一句话>"
git push origin v$V
```

### 3.7 GitHub Release

`gh release create v$V --verify-tag --latest --title "v$V — <标题>" --notes-file /tmp/rel-$V.md`

`--verify-tag` 防止误建 tag；`--latest` 要显式给，否则**后创建的旧版本会把 Latest 抢走**
（0.1.2 与 0.1.0 就这么错过一次，需要用 `gh release edit v$V --latest` 纠正）。

### 3.8 更新本机生产副本

```bash
npm i -g @tianemon/ai-agent-bridge@$V --registry=https://registry.npmjs.org/
aab version        # 必须是 $V
aab doctor | sed -n '/runtime/,+5p'   # 必须是 "npm 全局安装"
```

**只有当配置里的路径变了**（例如换了 Node 前缀、挪了目录）才需要重跑 `aab install`；
同路径升级不用，WorkBuddy 的信任也不会失效。

### 3.9 五处对齐核对（收尾必跑）

```bash
node -p "require('./package.json').version"                                   # $V
npm view @tianemon/ai-agent-bridge version --registry=https://registry.npmjs.org/  # $V
aab version                                                                   # aab $V
gh release list | head -1                                                     # v$V 且 Latest
git rev-parse --short HEAD; git rev-parse --short origin/main                 # 相同
git status --short | wc -l; git rev-list --count origin/main..HEAD            # 0 / 0
```

---

## 4. 失败模式与处置

| 现象 | 原因 | 处置 |
|---|---|---|
| `npm error code E404 … /-/v1/done?authId=` | 授权链接的会话过期（或已被消费） | 重新执行 3.4，用**新链接** |
| `npm view dist.shasum` 一直为空 | 元数据未生成（1–3 分钟） | 继续等；超过 10 分钟再看 `npm status` |
| 线上 shasum ≠ 本地 | 打包内容与提交不一致（脏工作树） | 删 tag 重来，别硬发 |
| `cannot publish over previously published version` | 版本号已存在 | `npm version patch` 后重发；**不要试图重发同号** |
| WorkBuddy 显示"信任记录对应的是旧配置" | 配置 entry 变过（路径/参数） | 让人点一次：连接器 → 自定义连接器 → aab → 信任 |
| `which -a aab` 有两个 | 有会话往宿主运行时里装过 | 删掉宿主运行时那份符号链接/目录，只保留 `/opt/homebrew/bin/aab` |
| MCP 里读到的还是旧描述 | 宿主进程没重启 | **退出重开宿主**（不是新开会话） |

**授权失败不等于登录失效。** `npm whoami --registry=https://registry.npmjs.org/` 能回 `tianemon`
就说明 token 还在，直接重起发布即可。

---

## 5. 发布说明怎么写

- 只写**已发布的内容**：不要把"下个版本才发"的东西写成已具备（0.1.2 的说明里曾把 `doctor`
  的英文状态词算进去，实际那时还是中文，发布后要单独更正）。
- 断言"新增 / 修好了 / 以前没有"之前，去上一个 tag 取证：

  ```bash
  git show v<上一个版本>:src/known.mjs > /tmp/old.mjs     # 先落盘，再用 Grep 工具查
  ```

- 写清验证方式与数字：测试条数、shasum、修复前后的实际输出对比。
- 中英两段摘要（仓库对外是英文优先，中文段方便本地回顾）。

---

## 6. 让 MCP 侧真的加载新东西

改的是**工具描述 / initialize instructions / 工具名**时：

1. 生产副本换成新版本（3.8）
2. **重启宿主**（WorkBuddy：退出应用再打开）
3. 验证：

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
  | node <生产路径>/bin/aab.mjs mcp 2>/dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['instructions'][:200])"
```

`instructions` 是"宿主**可以**注入"的可选项，WorkBuddy 实测不注入——所以描述再好也只是提高命中率。
**确定性来自项目规则文件**（`aab rule` 的输出粘进 `CLAUDE.md` / `AGENTS.md`）。
