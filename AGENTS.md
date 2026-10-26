# AGENTS.md — 维护本仓库的会话，先读这一页

这是**操作纪律**，不是产品说明。产品是什么、怎么用，看 `README.md`（中文，默认）/ `README.en.md`。
发版与安装的完整流程（含每条命令与失败处置）在 **`docs/RELEASING.md`**，**发版前必须通读**。

## 四条铁律

**1. 生产跑的是 npm 安装版，不是源码。**
MCP 配置里写的是 `/opt/homebrew/lib/node_modules/@tianemon/ai-agent-bridge/bin/aab.mjs`。
它必须是**真实副本**。不要对它 `npm link`——那会让源码改动直接上线，`aab doctor` 会显示
`mode 开发目录`。也不要把全局包装进宿主自带运行时（`~/.workbuddy/binaries/node/...`）：
那个目录随宿主升级整块消失。

**2. 先验证，再发布。**
不要"发完再扫"。0.1.3 → 0.1.4 → 0.1.5 半小时内连打三个补丁，全是发布之后才发现的：
漏译、`list`/`grep` 静默吞参数、信任记录读错一条。**发版前把 `docs/RELEASING.md` 的检查清单走完。**

**3. 一次发布要对齐五处，缺一不可。**
`package.json` 版本 = npm `latest` = GitHub Release（`--latest`）= git tag = 本机全局安装版本。
外加工作树干净、`origin/main` 无未推送。

**4. 可见文案只能进 `src/i18n.mjs`。**
中英两份字典必须键一致（有测试校验）。会话正文永远逐字保留、不翻译。
`AAB_LANG=en` 下任何命令漏出中文都会被闸门测试抓到——**新命令必须加进那条闸门**。

## 改完工具描述 / initialize 提示之后

描述是给模型看的，进程起来时才读取，所以：

```bash
npm run pack && npm i -g ./tianemon-ai-agent-bridge-<ver>.tgz   # 或先发布再装
```

然后**重启宿主**（WorkBuddy 要退出重开，不是新开会话），MCP 才会重新 `initialize`、重建工具索引。
改完不重启就断言"没生效"，是误判。

## 常用命令

```bash
node test/run.mjs                 # 全部端到端用例（发版闸门包含在内）
aab doctor                        # 运行形态 / 会话来源 / 三个宿主是否注册+是否已信任
aab rule                          # 打印可粘进项目规则文件的片段
aab install --dry-run             # 看会往哪几家写配置，不落盘
```

## 不要做的事

- 不要手改三家宿主的 MCP 配置来"修"路径——用 `aab install`，它会备份、会清旧名、是幂等的
- 不要代写 WorkBuddy 的信任记录（`~/.workbuddy/mcp-approvals.json`）：那是人工安全闸
- 不要 `git add -A` 之前不 `git status`：`npm pack` 的产物曾经这样被提交进仓库并推上 GitHub
- 不要把"我这边验证不了"写成"做不到"：先查官方文档，再决定是标注未验证还是降级
