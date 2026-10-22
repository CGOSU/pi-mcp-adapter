# 会话记录

本文件按时间追加每次工作的完成内容、实际验证和遗留问题，不记录敏感信息或未经验证的结果。

## 记录格式

每次记录应包含日期、完成内容、实际执行的验证及遗留问题。

## 会话

### 2026-10-22：接入 Pi 1.4.0 原生 MCP 兼容

- 目标：只新增 Pi 1.4.0 兼容，保留既有 1.2.0/1.3.0 资产与 native-only 契约；不降级、不引入第二套 runtime 或 fallback。
- 固定基线：上游 tag `v1.4.0` → commit `4a080252f06caf63a525d7873c5d94d3c23887e0`。候选补丁 `patches/pi-1.4.0-native-mcp-management.patch` 在本任务前已存在（未跟踪），按既有候选处理、未冒称本轮生成；在 `/private/tmp/pi-1.4.0-fixed-patch.8aSzZL/pi` 干净 checkout 上 `git apply --check`/`git apply`/`git diff --check` 与反向 apply 校验全部通过，23 修改 + 26 新增共 49 路径与 manifest 一致；`npm ci` 安装 332 包；4 个 owner/management 测试文件 59 项通过。固定在 Pi 1.2.0 的脏 checkout `../pi-upstream-native` 未被触碰。
- Manifest 与 runner：新增 `patches/pi-1.4.0-native-mcp-management.json`（含 target/hash/49 路径/18 caps/directTools/实际安装与测试结果/handoff 段）；`scripts/patched-pi-source.mjs` 追加 1.4.0 固定目标；`test/node/package/patched-pi-runners.test.mjs` 新增 1.4 manifest 校验与 1.3↔1.4 双向 baseCommit 拒绝，7 项通过。
- 真实产物：完整 `npm run build` 通过（84 个 bundle 文件，9.0 MiB），`npm pack --ignore-scripts` 产出 tarball SHA-256 `9a3f27b857e29c6197de266fc1282176a6ec139ec71e5f4ffac78f6de50531ed`（7 778 845 bytes、1322 文件）；解包实测 `dist/index.js` 导出 management protocol/18 caps/`installMcpOwnerAssembly`，bundle 含三条 owner events，`pi --version` 为 `1.4.0`。
- Adapter 真实验证：`npm run test:public-types -- --pi-source <patched 1.4.0 checkout>` 与 `npm run test:patched-native-session -- --pi-source <同一 checkout>` 均实际通过并同步发布 `dist`；`typecheck`、`test/unit/native` 8 文件 30 项通过。
- 修复的两处 runner 缺陷：packed host 与 vitest alias 原先都把 adapter pin 的 `pi-ai` 1.2.0 注入 1.4.0 宿主，导致 `formatUserAgent` 缺失和 tool result 丢失。改为从所选 Pi checkout 解析宿主依赖，并断言宿主 `pi-ai` 版本与其 `coding-agent` 依赖声明一致。详见 [`docs/pitfalls.md`](pitfalls.md)。
- Managed hook：installer 不再写死 Pi 1.3.0，改为用传入 tarball 的 SHA-256 在 registry 中唯一定位记录；`scripts/managed-pi-update-artifacts.json` 登记 1.4.0（alias `native-mcp-1.4.0-9a3f27b857`）。`npm run test:managed-pi-update-hook` 由 9 项扩到 12 项并全通过，新增「按 1.4.0 自身 hash/patch 精确选中」「未登记的 1.4.1 不激活且不复用他版 artifact」「installer 接受已登记 1.4.0 并拒绝未登记 tarball」。
- 隔离 managed root 实测：用真实 1.4.0 tarball 完成离线 install → API/version 核验 → 原子切换到 `native-mcp-1.4.0-9a3f27b857`；stock `1.4.0` release 保留。真实 `~/.pi/agent` 的 `current-version` 未改动。
- Fresh packed CLI RPC smoke：真实 1.4.0 tarball 与 packed adapter 装在相互隔离目录（adapter peer omitted、无 ancestor Pi `node_modules`），用实际 `dist/bundle/cli.js`、隔离 HOME/`PI_CODING_AGENT_DIR` 和本地 stdio fixture 运行：owner assembly 中 `assembly_fixture` connected 并取得 3 项 live tools，`/mcp-adapter` prompt 被处理，`notify`/`setStatus` 发出，模型推理事件 0，EOF 后 CLI 退出码 0。未连接真实 MCP/LLM/keyring。
- 诊断文案：`management-bridge` 与 `config-mapping` 中写死「1.2.0」的降级建议改为版本中立的「安装提供完整能力的 patched Pi release」，缺 API/能力仍结构化失败。
- 未执行：真实 `pi update --all`、npm 发布、部署或打 tag；未 push；真实 managed install 未从 1.3.0 patched release 切到 1.4.0。后续命令：`npm run install:managed-pi-update-hook -- --artifact <pi-1.4.0 tarball>`。

### 2026-10-19：修复 managed 更新钩子的 resolve 缺失导入

- 现象与根因：`pi update --all` 已完成包和核心版本检查后，MCP post-update hook 输出 `resolve is not defined`。`parseHookArguments` 使用 `resolve` 但未从 `node:path` 导入；`main` 按非阻断契约捕获错误并返回 0，因此只检查退出码的既有测试漏报，前一次 reconcile 的警告也掩盖了 CLI 路径失败。
- 修复：源码与本机已部署的 `managed-pi-update-hook.mjs` 补齐 `resolve` 导入；既有 unsupported-version 回归在调用 CLI main 前清空警告，并断言 main 自身产生预期警告。不改 managed release、current-version、核心更新退出码或 pi-init。
- 验证：新增断言修改前重现同一错误；修复后 `npm run test:managed-pi-update-hook` 9 项通过。源码与本机脚本 `node --check` 通过；本机脚本使用隔离临时目录、缺失 managed root 的只读参数路径探针通过，不再出现 resolve 引用错误。
- 提交检查：最初全仓 typecheck 因开发依赖是缺少 native MCP 类型的 stock Pi 失败；校验已登记 Pi 1.3.0 patched tarball 的 SHA-256 后，仅对本仓库 node_modules 离线、no-save、无 scripts 地安装该依赖，未修改 package.json/lock 或 managed release。随后 `npm run typecheck` 和上述 9 项测试均通过，没有跳过提交检查。
- 未执行：未重新运行真实 `pi update --all`，未触发实际补丁安装/切换、未运行全量测试或构建，未发布 npm 包。后续重新安装 hook 前应使用包含该修复的来源。


### 2026-10-17：接入托管 Pi 非阻断更新 hook 并激活 1.3.0 patched release

- 用户目标：继续实现 `pi update --all` 后接入已验证 MCP patch，但无论版本未知还是 patch/cache/install/API 验证失败，都必须让 Pi 核心更新照常完成。实现只作用于 `releases-v1` managed launcher；Pi 原生 MCP 仍是唯一 owner，不引入 fallback，也不下载未经登记的远端补丁。
- 完成：新增 `scripts/managed-pi-update-hook.mjs`、`scripts/install-managed-pi-update-hook.mjs`、`scripts/managed-pi-update-launcher.sh` 与固定 artifact registry；wrapper 在原 Pi update 子进程成功后触发 reconciliation，保留原退出状态。使用独立 staging、offline npm/cache、禁用 lifecycle scripts，验证包版本、公开管理 API、bundle owner events 和 `pi --version` 后才以非 SemVer alias `native-mcp-1.3.0-67df3bb7e8` 安装并切换指针。故障只警告，不暂停/回滚/pin 核心 release；launcher 原件与 stock 1.3.0 release 保留。安装/移除与故障语义写入 README 和 [`docs/native-mcp-patch.md`](native-mcp-patch.md)，pitfall 写入 [`docs/pitfalls.md`](pitfalls.md)，决策写入 [`docs/decisions.md`](decisions.md)。CI 增加 managed update hook tests。
- 自动化验证：`npm run test:managed-pi-update-hook` 9 项通过，覆盖 self-update 命令选择、未知版本、Pi updater 锁冲突、staging 期间 current release 并发变化、固定版本激活/stock release 保留、hash/install failure 不改 core pointer、非核心更新 no-op、launcher 安装恢复与 wrapper 经 symlink 启动时的退出码保持。`node --check`（hook/installer/test）、`sh -n`（wrapper）通过。`npm pack --ignore-scripts --dry-run --json` 检查 35 文件，含四个 managed hook/manifest assets，不含 `test/**`/`node_modules/**`。
- Artifact/managed install 验证：已验证 Pi 1.3.0 tarball SHA-256 `b929058ead39f7766452aa32457f0b369b31da630165cab585614f7164c32e26` 在隔离模拟 managed root 中离线安装、核验 18 项 management capabilities 并成功原子切换。随后按用户授权将该 artifact 持久化到本机 Pi managed cache，装好 launcher wrapper 并激活独立 alias；检查原 launcher backup 与 stock release 均在。通过隔离 HOME 的本机 launcher `--version`（输出 `1.3.0`）及 alias public API import。
- 真实 CLI runtime 验证：用本机 managed patched alias 的实际 bundled CLI、隔离配置目录、packed adapter 与 local stdio fixture 运行 RPC smoke；owner connected，live catalog 有 3 tools，`/mcp-adapter` prompt handled，`notify`/`setStatus` 可见，model inference events 为 0，CLI exit 0 且 fixture 退出。未读取用户配置/keyring、未连接生产 MCP/LLM。
- 未执行真实 `pi update --all`，避免核心升级/network side effect；因此 updater 实际网络/发布行为未实测，post-update 退出状态由 fake child integration tests 验证。正在运行的旧 Pi process 不会因 `current-version` 切换而热替换，需完全退出并重启。未发布 npm、未 push、未部署或打 tag。
- Git 交付：按仓库本地身份 `CGOSU`/`dev@cgosu.com` 创建中文本地提交 `7ec2f8586e899fb8224a772f82a97794b14d68bd`（`接入托管 Pi 非阻断 MCP 补丁更新`，14 个明确归属文件）。提交后 `main` 比 `origin/main` 超前 1 个提交；未 push。

### 2026-10-17：完成 Pi 1.3.0 fresh packed CLI 原生 MCP 验证

- 背景与修复：此前 packaged CLI probe 无法在 bundled Pi built-in owner 的 snapshot 中看到 adapter programmatic server。核实 Jiti-loaded adapter 与 CLI bundle 中的 owner 不共享 module-local singleton；adapter 将当前 `pi.events` 传入 assembly installer，由内置 owner 通过内部 request/install/release event handoff 在自己的 module instance 安装同一 assembly。Management bridge 在 owner 迟到 available 时重试 discovery，并用 session generation/pending request identity 丢弃旧结果。该 seam 不扩展 public `pi.mcp-management` v1，也不引入 adapter runtime/fallback。同步更新 Pi 1.3 patch/manifest 与 source runner hash；最终 patch 为 49 paths，SHA-256 `67df3bb7e8d51dd9f15e66253869d20e5c4c0957f7a331f1a4ba82e2b54eaf33`，manifest SHA-256 `5768a010e8473a0d6d9dde557e733f5a513e42933bf15b8c61a3a4dd8339bd7e`。清洁 fixed baseline apply 与 verifier 均通过；临时诊断日志已从 staging source 移除，最终 bundle 不含该诊断代码。
- Pi 验证：在 `/tmp/pi-mcp-evidence-1.3.nbLEJX/staging/pi` 执行完整 `npm run build` 成功（normal workspace build；bundled CLI 83 files/8.9 MiB）。`npm run test --workspace=@earendil-works/pi-coding-agent -- test/mcp-owner-assembly.test.ts test/mcp-management.test.ts test/mcp-extension.test.ts test/mcp-lifecycle.test.ts`：4 files/71 tests 通过。随后清除 staging 旧 bundle 并重新构建 coding-agent bundle，最终包内 worker/WASM 等资源均存在。Pi 全量 `npm test` 和 `npm run check` 未运行。
- Adapter 验证：`npm run test:public-types -- --pi-source /tmp/pi-mcp-evidence-1.3.nbLEJX/staging/pi` 通过 typecheck、5 项 exports/package tests、packed consumer，并同步 18 个 dist files；`npm run test:patched-pi-runners` 6 项通过；`npm run test:vitest -- --run test/unit/native/management-bridge.test.ts test/unit/native/extension.test.ts test/unit/native/config-assembly.test.ts` 3 files/9 tests 通过。
- Fresh packed CLI：Pi 1.3 Pi tarball SHA-256 `b929058ead39f7766452aa32457f0b369b31da630165cab585614f7164c32e26`，adapter tarball SHA-256 `d4b6ee49f8f5d21b527779321b15e25aeeec22943a2327a9643198ef52f06428`。用实际 `dist/bundle/cli.js` 和实际 adapter tarball，在相互隔离的 package roots 中运行；adapter Pi peer 明确 omitted，且没有 ancestor runtime `node_modules`。RPC observer 取得 18 项 management capabilities，发现并订阅 handle；built-in owner snapshot 显示 programmatic `assembly_fixture` connected、catalog live 且含 3 tools，local fixture 记录 `initialize` 与 `tools/list`；`/mcp-adapter` prompt 被 handled，并实际输出 `setStatus` 与 `notify`。模型 inference events 为 0，stdin EOF 后 CLI code 0、fixture PID 已退出。此 smoke 未执行 MCP tool call，也未调用真实 LLM/生产 MCP、真实 keyring 或用户配置。Transcript、RPC requests、stderr、probe observation 和 fixture 生命周期日志保存在 `/tmp/pi-mcp-evidence-1.3.nbLEJX/runtime/packed-final/`。
- 包装检查：`npm run test:public-types -- --pi-source ...` 先验证生成物成功；随后的裸 `npm pack` 触发 `prepack`，错误解析根 `node_modules` 的 stock Pi 1.2.0 dev types，因缺管理 exports 失败。改用 `npm pack --ignore-scripts` 从已验证的 `dist/` 生成实际 adapter tarball 并完成 packed runtime smoke。该注意事项见 [`docs/pitfalls.md`](pitfalls.md)。Pi 根 `npm run build` 会在 staging 中生成模型目录并从公开模型目录服务获取 metadata；未使用凭据或执行模型推理。
- 文档与 Git：更新 Pi 1.3 patch hash/path count、owner handoff 实现边界、运行证据、changelog 与 resolver/packaging pitfalls。以上本轮归属文件按仓库本地身份 `CGOSU`/`dev@cgosu.com` 创建中文本地提交；未 push、发布、部署或替换用户活动 Pi。原始错误在当前用户安装上的状态仍未知。

### 2026-10-16：修正原生 MCP 迁移后的持续集成与旧运行时回归检查

- 背景：持续集成原先使用 npm 发布的未打补丁 Pi 1.2.0 执行 `build:public`、类型检查和公共导出检查；这些源码依赖的原生 MCP 管理 API 只存在于仓库固定补丁中。旧的子进程启动与会话重载测试还把仅用于接入原生管理方的入口 `index.ts` 当作旧运行时入口，`package.json` 依赖清单测试则仍断言 Pi 0.84.1 的依赖版本。静态导入图也需要区分原生管理方同步读取的密钥环/Bearer 令牌适配层，与应延迟加载的 OAuth 流程和旧运行时。
- 完成：保留 `.github/workflows/ci.yml`，调整为检出固定 Pi 基线 `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 并应用仓库补丁；之后运行 Pi 原生管理方定向测试、`test:public-types`、同会话集成测试、适配器 Vitest、OAuth 和协议一致性检查。产物检查完成后使用 `npm pack --ignore-scripts`，避免未打补丁的 Pi 触发 `prepack`。旧运行时的子进程启动、会话重载和 `mcpScript` 测试现在明确加载保留的 `src/extension/install.ts`；`package.json` 依赖清单测试同步到 Pi 1.2.0；启动依赖图测试注明原生凭据适配层的静态导入例外。未改动生产业务逻辑，也未删除持续集成工作流。
- 验证：安装并构建 `examples/interactive-visualizer`；本机 Node `v26.11.1` 执行 `npm run test:vitest`，119 个测试文件、1,350 项通过；本轮相关的 5 个文件、34 项测试通过；Pi 原生管理方 4 个测试文件、57 项通过；`npm run test:public-types -- --pi-source /Users/cgosu/code/JavaScript/pi-upstream-native` 的适配器类型检查、公共产物检查和声明消费者编译通过，并同步 18 个 `dist` 文件；`npm run test:patched-native-session -- --pi-source /Users/cgosu/code/JavaScript/pi-upstream-native` 的真实同会话回归 1 项通过；`npm pack --ignore-scripts --dry-run --json` 检查得到 25 个文件。`git diff --check`、`git diff --exit-code -- dist` 和 Ruby YAML 解析通过。
- Git：持续集成改动提交 `6dcb08316ee3428eecfec956ad914826acf08219`（`修复原生 MCP 迁移后的 CI 验证`）创建在本地 `main`。创建时 `origin/main...HEAD` 为 `0 1` 且工作区干净；随后另行提交了文档状态记录。当前本地 `main` 比 `origin/main` 超前 2 个提交；两项改动均未推送，远端 GitHub Actions 尚未触发。
- 未完成事项：远端持续集成尚未实际运行；本机通过不能代替远端验证。对 4 个行为与导入图测试登记了“保留”建议；`package.json` 依赖清单属于配置，审阅工具不接受它作为实现路径，因此未伪报该项审阅已经完成。

### 2026-10-16：将 README 和项目状态文档改写为中文

- 完成：将 [`README.md`](../README.md) 重写为中文，保留命令、配置键、代码示例和产品专名；移除未经核实的 npm registry 安装示例，只保留 Git 安装方式；明确区分当前 Pi 原生 MCP 入口与仅供旧运行时参考的章节，并将现代协议不支持范围写入当前契约说明。重写 [`docs/current-state.md`](current-state.md) 和 [`docs/pitfalls.md`](pitfalls.md)，并将本记录中最新的持续集成条目改为中文。当前发布包数量按已执行的打包检查记录为 25 个文件；旧的 51 个文件结果仍保留在对应历史记录中。
- 验证：README 与相关文档执行 `git diff --check` 通过；本次只改文档，未运行代码测试。
- Git：文档修改并入本地未推送的文档提交；本地 `main` 仍比 `origin/main` 超前 2 个提交。未推送。

### 2026-08-23：MCP runtime 懒加载与启动回归

- 完成：拆分启动边界；`index.ts` 使用缓存的原生 `dynamic import()` 延后 MCP runtime、命令、OAuth、脚本和执行模块；prompts、namespace tools 和 direct tools 通过共享初始化回调保持首次调用行为。新增 `direct-tool-catalog.ts`、启动导入图测试和 `benchmark:startup` 命令，并将新模块加入发布清单。
- 性能：`npm run benchmark:startup -- --runs 3` 在 Windows / Pi 0.84.2 fresh RPC 下测得 baseline main TOTAL 33ms、wall 750ms；`JITI_FS_CACHE=0` 扩展 module import 363ms、main TOTAL 390ms、wall 1475ms；Jiti 缓存扩展 module import 58ms、main TOTAL 86ms、wall 873ms。延迟 runtime 的工作转移到首次 MCP 使用，不是被消除。
- 通过：相关生命周期和集成回归 6 个文件、78 个测试；`npm run typecheck`；`npm run build:public`；`node --check scripts/benchmark-startup.mjs`；`git diff --check`。
- 环境遗留：`npm test` 在 Windows Node 24 的既有 `test-runner.mjs` 中因 `spawnSync('npm.cmd')` 返回 `EINVAL`；完整 Vitest 另有既有 Windows 配置隔离、Linux keyring、taskkill、Unix socket、symlink 和文件 mode 测试限制。未将这些环境问题伪报为通过。

### 2026-08-23：Git 安装兼容性修复

- 完成：移除 `package.json` 的安装期 `prepare`，改为 `prepack`；取消 `dist/` 的忽略并生成公共 exports 所需的 33 个 LF 文件；公共 exports 测试改为仓库内 fixture 复制，不再依赖 Windows directory symlink；CI 增加生成物一致性和 Windows production-only 安装检查。
- 通过：`npm run typecheck`；`npm run build:public`；`npm run test:vitest -- __tests__/package-manifest.test.ts`（7 个测试）；`npm run test:public-exports`（1 个测试）；`node --check public-exports.test.mjs`；`npm pack --dry-run --json`（包含 33 个 dist 文件）；临时干净副本的 `npm install --omit=dev --no-audit --no-fund` 及 `pi-mcp-adapter/config`、`metadata-cache`、`types` 公共导入。
- 遗留：本次修复尚未提交或推送；完整 `npm test` 的既有 Windows 环境限制仍见上一条记录。

### 2026-08-23：最终测试布局、性能与发布回归

- 完成：测试迁入 `test/unit`、`test/integration`、`test/node` 和 `test/fixtures`；剩余实现迁入 `src/catalog`、`src/config`、`src/auth`、`src/tools`、`src/ui`、`src/commands` 和 `src/extension`，根公共入口保留兼容 facade。更新 Vitest/Node runner、TypeScript、CI、package files 和 tracked `dist`；版本保持 `2.27.0`。
- 启动性能：同一 Windows / Pi 0.84.2 宿主执行 `npm run benchmark:startup -- --runs 3`，baseline main TOTAL `34ms`、wall `753ms`；cold `JITI_FS_CACHE=0` module import `387ms`、main TOTAL `418ms`、wall `1595ms`；warm Jiti cache module import `72ms`、main TOTAL `105ms`、wall `986ms`。5-run 复测 cold `412ms`、warm `66ms`。相对历史 `365ms` 参考值未达到 15% 改善目标；这是实际结果，不把宿主噪声伪报为通过。静态启动导入图仍排除 runtime/OAuth/UI/gateway/script/commands。
- catalog/search：`npm run benchmark:catalog -- --runs 5` 的 20×100 live shared median `20.94ms`、50×100 `75.35ms`，对应 per-server index `190.54ms`/`1064.84ms`；10,000 工具搜索脚本 5 次 median `5.10ms` 且返回 10,000 条结果。
- 通过：`npm run typecheck`；package manifest 和 startup graph 2 个文件、10 个测试；目标行为集合 40 个文件中 39 个通过、508 个测试通过；`npm run test:oauth` 141 个测试全部通过；`npm run test:public-exports`；`npm pack --dry-run --json`（180 个文件、无测试文件）；production-only 临时安装及 `config`/`metadata-cache`/`types` 公共导入；`git diff --check` 和 `src/test` trailing whitespace 检查。
- 环境遗留：行为集合唯一失败是 Windows 文件 mode 期望 `0600`、实际 `0666` 的 POSIX 权限限制；完整 Windows Vitest 仍可能受全局配置污染、symlink、taskkill、Unix socket、keyring 和 mode 假设影响。`AGENTS.md` 与 `docs/clean-code.md` 继续保持未跟踪排除；未执行 commit/push。

### 2026-08-23：最终 A/B 性能与收尾验证

- 完成：在最终 `src`/`test` 布局上复测启动、catalog、搜索、行为、public build、package manifest、生产安装和静态边界；未发现本轮领域迁移引入的可归因性能回退。版本保持 `2.27.0`，未执行 commit/push。
- 启动 A/B：当前工作树 `npm run benchmark:startup -- --runs 3` 的 cold module import median `398ms`、warm `65ms`；同一宿主从 `HEAD` 临时归档运行的基线为 `398ms`/`60ms`。当前 5-run 复测为 `465ms`/`65ms`，冷样本 `401–691ms`。历史 `365ms` 参考值的 15% 改善及 `300ms` 目标未达到，按同机 A/B 和 Windows/Jiti 噪声记录，不改变启动边界。
- Catalog/search：`npm run benchmark:catalog -- --runs 5` 的 direct/live shared median 为 5×100 `4.72ms`/`4.45ms`、20×100 `18.73ms`/`17.43ms`、50×100 `45.07ms`/`45.05ms`；旧 per-server 50×100 对照为 `989.27ms`。10,000 工具搜索 cold `50.28ms`、5 次 warm median `5.73ms`，结果正确。
- 通过：相关 catalog/package/startup/direct/namespace/proxy 行为集合 10 个文件、111 个测试；`npm run typecheck`；`npm run test:public-exports`；`npm run test:oauth` 的 141 个 Node tests；`npm pack --dry-run --json` 的 180 个文件且无测试文件；production-only tarball 安装、public subpath imports、CLI smoke test；`node --check`；`git diff --check` 与 trailing-whitespace 检查。
- 环境遗留：完整 Windows Vitest 仍可能因全局配置、Linux keyring、`taskkill`、symlink、Unix socket/file mode 和 CLI shebang 假设失败；针对性验证通过。`AGENTS.md` 与 `docs/clean-code.md` 继续保持未跟踪排除。

### 2026-08-23：五入口分块发布物最终交付检查

- 完成：删除 53 个未发布根 forwarding facade 后，公共 npm 发布边界改为五个 `dist` ESM 入口；保留每个入口的 dynamic import 分块，发布 `dist/cli.js` 以及 `mcp-script-worker.mjs`、`mcp-keyring-helper.cjs`、`app-bridge.bundle.js` 三项独立资源。版本保持 `2.27.0`，未执行 commit/push。
- 通过：`npm run build:public` 生成 45 个文件；重复构建 SHA-256 快照比较为 `deterministic=True`；`npm run typecheck`；`npm run test:public-exports` 的 5 个 Node tests；`npm run test:oauth` 的 141 个测试；生产 tarball 临时 `npm install --omit=dev`、四个独立 Node subpath imports 和 `dist/cli.js --help`；声明消费者 `tsc --noEmit`；相关 `node --check` 与 `git diff --check`。
- 发布边界：`npm pack --dry-run --json`/tarball 回归为 51 个文件，低于 60，且无 `src/**`、`test/**`、source map 或已删除 facade；动态 chunk 与三项资源的相对 URL 产物检查通过。包根入口在带开发期 Pi `typebox` peer 的 public exports 检查中通过；production-only 子路径不依赖 devDependencies。
- Lazy Load：`node scripts/benchmark-startup.mjs --runs 3` 的 source module/main/wall 中位数为 `437ms`/`475ms`/`1128ms`，bundle 为 `199ms`/`228ms`/`754ms`，未超过 15% 回退；静态启动导入图通过。
- 环境遗留：最终 `npm run test:vitest` 为 96 个文件通过、13 个文件失败（1183 个测试通过、137 个失败、12 个跳过）；失败仍集中于 Windows 全局 host 配置污染、`taskkill`/进程清理、symlink 权限、缺少 interactive visualizer 构建产物、keyring 与 POSIX 文件 mode 等既有环境限制，未发现本次发布 bundle 的模块解析失败。

### 2026-08-31：删除宿主配置导入与探测

- 完成：删除配置层的宿主专属 MCP 探测、兼容 imports、setup 采用 UI 和 CLI `init`/`--discover-host-configs`；`imports` 与 `settings.hostConfigDiscovery` 遗留字段不再生效。保留标准共享配置路径、Pi override、provenance、setup scaffold/known server/RepoPrompt/path inspection、`directTools` 写回和 token CLI；移除 `smol-toml`。
- 通过：`npm run typecheck`；`npx vitest run test/integration/commands/commands-onboarding.test.ts test/integration/ui/mcp-panel-keybindings.test.ts test/unit/support/cli.test.ts`（27 个测试）；`npx vitest run test/unit/config/config-loading-snapshot.test.ts test/integration/config/exclusive-config.test.ts test/integration/support/disabled-server.test.ts`（13 个测试）；`node cli.js --help`、`node cli.js init`、`node cli.js --discover-host-configs`（帮助与删除命令边界符合预期）；`git diff --check`。
- 通过：`npm run build:public` 生成 45 个 tracked public 文件；`npm run test:public-exports` 的 5 个 Node tests；`npm.cmd pack --dry-run --json --ignore-scripts` 发布边界为 51 个文件且不含 `src/`、`test/` 或 source map；`git diff --check`。完整相关配置测试未运行；未执行 git commit/push。

### 2026-09-01：优化 Pi 扩展显示名称

- 完成：新增 `extensions/index.js` wrapper 转发到 `dist/index.js`，并将 `package.json` 的 Pi 扩展入口和发布文件清单切换到该标准目录；更新 package manifest 与 tarball 回归断言。
- 通过：`npm run typecheck`；`npm run test:vitest -- test/unit/package/package-manifest.test.ts`（8 个测试）；`node --check extensions/index.js`；Pi 0.84.4 的紧凑扩展标签检查输出 `CGOSU/pi-mcp-adapter`；`npm run test:public-exports`（5 个 Node tests）。
- 遗留：未执行 git commit/push。

### 2026-10-13：暂停 Pi 原生 MCP 管理迁移并保存 TODO

- 完成：新增唯一详细待办 [`docs/todo.md`](todo.md)，记录已完成的 native-management-api 历史结果、五项未完成迁移任务、固定架构约束和跨电脑恢复检查；`docs/current-state.md` 增加简短索引。
- 本轮实际检查：修改前 `git status --short --branch` 显示 `main...origin/main` 和既有未跟踪 `.pi-graph/`；本轮未修改或纳入该目录。本次 TODO 位置为 `docs/todo.md`。
- 通过：`git diff --check`；文档静态核对确认 `docs/todo.md` 存在、列出 5 项后续任务，且 `current-state.md`/`session-log.md` 链接均指向该 TODO。命令提示 `docs/current-state.md` 的 LF 将在 Git 后续处理时转为 CRLF；检查退出码为 0。
- 未运行代码测试、build 或真实 MCP 操作。
- 遗留：本轮不提交、不 push。Pi 上游源码当前状态未重新核实；跨电脑继续前必须按 [`docs/todo.md`](todo.md) 检查源码/补丁是否安全可用。

### 2026-10-14：从固定 Pi 1.2.0 基线重建原生 MCP 管理 API

- 完成：按用户授权在 `/Users/cgosu/code/JavaScript/pi-upstream-native` 的固定基线 `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 重建 session-scoped 原生管理协议；历史实现未恢复。实现/导出集中于 coding-agent MCP core、原生 extension owner、runtime/config 和公开入口；补充协议及 extension 文档、API 和 owner 回归测试。adapter 已记录授权和契约。保留内置 MCP 作为连接、OAuth 和工具执行唯一 owner；其余 adapter 迁移尚未开始。
- 通过：在 `packages/coding-agent` 执行 `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/mcp-management.test.ts test/mcp-extension.test.ts`，2 个测试文件、36 个测试通过。
- 未通过：上游 `npm run check` 失败于 `tsc --noEmit`。固定基线缺少 `packages/ai/src/providers/data/`（含 `amazon-bedrock.json`），造成 AI model catalog 类型推导为 `never` 并在 AI/coding-agent 测试中出现广泛类型错误；本次 MCP 改动文件未出现在错误输出中。没有修改无关 AI model 数据；后续 `check:browser-smoke` 未运行。
- 通过：上游与 adapter 分别执行 `git diff --check` 均无输出、exit 0；新增未跟踪协议/源文件以 `grep -nE '[[:blank:]]+$'` 检查，未发现 trailing whitespace。
- 当时下一步：由 docs-commit 核对最新协议实现、直接调用方、测试结果和 adapter 契约映射，再由 architect 重规划；该审计已由下方 2026-10-14 记录完成。不得把本轮 API 任务描述为全部迁移完成。上游和 adapter 均未提交、未推送。

### 2026-10-14：原生协议与 adapter 契约映射审计

- 完成：docs-commit 在不修改生产代码的前提下，核对 adapter `ServerEntry`/`McpSettings` 全部字段、公开入口、配置来源/provenance、project trust、OAuth storage、生命周期/metadata cache、审批/工具 pipeline、status/panel/catalog，以及 native API 的当前实现、直接调用方、OAuth owner、测试和 public package boundary。发现的 confirmed facts、inferences、unconfirmed items、conflicts 和下一阶段阻塞决策见唯一审计报告 [`docs/native-mcp-evidence.md`](native-mcp-evidence.md)。
- 工作区：adapter HEAD `98a3b7952210074ef3651af2058208e1bc00a691`；Pi HEAD `06a466935536f8c9bcacb2d5efc0fc021be1bdff`。本任务只新增审计文档并更新状态索引；未改生产代码、运行测试/build、提交或推送。
- 验证边界：本轮只读定位 adapter 测试；API 定向测试 `2 files / 36 tests passed` 和上游 `npm run check` 缺失 model-data 失败均为上一阶段实际运行记录，详见审计报告，不在本轮重跑。
- 下一步：architect 依据该报告重规划生命周期、adapter entry、panel/catalog、同会话回归和补丁交付。既有 API 不重做，生命周期实现尚未开始，最终将必要上游改动作为版本化补丁与 manifest 交付在 adapter，而非复制整份 Pi 源码。

### 2026-10-14：固化 trust 与 OAuth 决策并重排剩余迁移计划

- 完成：将用户已确认的两项推荐方案写入 [`docs/decisions.md`](decisions.md)：项目级 MCP 配置（含共享 `.mcp.json`、项目 `.agents`/`.pi` 来源）统一经过真实 Pi project-trust，未信任只可脱敏展示、不连接/不执行、不注册可执行缓存工具；保留 adapter keyring 存储与既有 OAuth 登录连续性，不自动把旧凭据复制到明文文件。`docs/todo.md` 由“暂停五项待办”重写为 11 项剩余任务的实施顺序，明确前六项原生能力（生命周期、配置/trust、keyring、传输、执行策略、资源/Apps）是入口切换的前置条件；已完成 `native-management-api` 保持完成状态不重做。
- 完成：`docs/native-mcp-evidence.md` 将问题 1/2 标记为已由用户决定并指向唯一决策来源，交接结论改为引用当前计划；`docs/native-mcp-protocol.md` 状态行移除“等待 architect 重规划”的已过期表述；`docs/current-state.md` 更新迁移索引与最近更新。未改生产代码、测试或上游工作区。
- 本轮实际检查：`git diff --check`（见验证）；文档链接静态核对；确认 `docs/todo.md` 列出 11 项任务、入口迁移任务标注了前置能力依赖，且 `docs/decisions.md` 包含 trust 与 keyring 两条决定。
- 未运行代码测试、类型检查、build 或上游命令；本轮不提交、不 push。
- 遗留：前六项原生能力迁移尚未开始；`native-management-api` 的定向测试与 `npm run check` 结果仍为上一阶段实际记录，未在本轮重跑。

### 2026-10-16：确认 directTools 持久化方案并重排面板迁移前置任务

- 背景：`native-panel-status-and-live-catalog` 在实施前面发现业务契约不等价：面板既有的工具选择/保存语义是写 `ServerEntry.directTools`，而 native `setExecutionPolicy` 只更新当前 session、`setToolExposure` 持久化的是 `toolExposure`；`effectiveMcpToolExposure` 中 `directTools` 选择优先，上游 `McpServerConfigPatch`/`updateMcpServerConfig` 也只写 `enabled`/`exposure`/`toolExposure`。当事 developer-test 未自行写入配置绕过唯一 native owner，而是报告阻塞并交回架构。
- 完成：用户确认推荐方案（保留 `directTools` 选择语义，由 native owner 在真实 project-trust 与既有 provenance 门控下新增持久化能力）。已写入 [`docs/decisions.md`](decisions.md)（2026-10-16 决定）；[`docs/todo.md`](todo.md) 新增任务 8 `native-direct-tools-persistence`（含面板所需脱敏快照字段）作为面板迁移直接前置，后续任务顺延为12 项，并同步更新状态行、恢复清单与面板任务约束（不侧面写配置、不编造计数、不展示传输错误文本）；[`docs/native-mcp-protocol.md`](native-mcp-protocol.md) 新增“待实现：directTools 持久化”目标契约段，明确现状与不得冒充的要求；[`docs/native-mcp-evidence.md`](native-mcp-evidence.md) C6 补充本次核实事实与已确认边界，交接结论同步三项固定约束。
- 本轮实际检查：`git diff --check` 与新增/修改文本 trailing-whitespace 扫描；文档关键字静态核对（`decisions.md` 含 2026-10-16 决定、`todo.md` 列出 12 项任务且任务 8/9 依赖顺序正确、`native-mcp-protocol.md` 含待实现段）。
- 未运行代码测试、类型检查、build 或上游命令；未改生产代码、测试或上游工作区；本轮不提交、不 push。
- 遗留：`native-panel-status-and-live-catalog` 仍为 blocked，需先完成 `native-direct-tools-persistence` ；待迁移的 adapter 与上游工作区仍保留大量未提交改动。

### 2026-10-15：确认暂不支持原生 2026-07-28 远程 MCP 协议

- 决定：用户确认本轮迁移暂不实现 native MCP client 的 `2026-07-28` wire protocol。唯一决定见 [`docs/decisions.md`](decisions.md)；据此把 `native-transport-auth-and-request-compatibility` 的协议验收改为：显式 `2026-07-28` pin 与当前无法等价实现的 modern `auto` 协商必须在连接/执行前返回具体、可区分的结构化不支持结果，不静默退回 legacy，也不删除或改写配置。
- 事实依据（读取源码，未改任何源码）：固定 Pi 1.2.0 的 `packages/mcp/src/protocol/types.ts` 只声明到 `2025-11-25`/`2024-11-05` 支持版本，`packages/mcp/src/client.ts` 始终执行 `initialize` 握手且无 `versionNegotiation`；adapter `src/contracts/core.ts` 与 `src/runtime/server-manager.ts` 则分别支持 `legacy | auto | 2026-07-28` 并把 `auto` 映射为 `{ mode: "auto" }`、`2026-07-28` 映射为显式 pin。
- 完成：更新 [`docs/decisions.md`](decisions.md) 新增 2026-10-15 决定、[`docs/todo.md`](todo.md) 状态行与传输任务验收、[`docs/native-mcp-protocol.md`](native-mcp-protocol.md) 兼容约束、[`docs/native-mcp-evidence.md`](native-mcp-evidence.md) C9 结论、[`docs/current-state.md`](current-state.md) 最近更新。未改生产代码、测试或上游工作区。
- 本轮实际检查：`git diff --check` 与新增文本的 trailing-whitespace 扫描通过；文档关键字静态核对确认 2026-10-15 决定存在于 `decisions.md`、`todo.md` 传输任务包含“结构化不支持”验收且入口切换前六项前置能力表述未被破坏。
- 未运行代码测试、类型检查、build 或上游命令；本轮不提交、不 push。
- 遗留：`native-transport-auth-and-request-compatibility` 仍为 paused 状态，需在解决阻塞后由 developer-test 以真实身份重试；此前源码未改动，重试时仍须补齐其余传输/认证/请求能力。

### 2026-10-16：真实 patched Pi 与 adapter 同会话回归

- 完成：新增 `scripts/test-patched-native-session.mjs` 显式 `--pi-source` runner、Vitest source aliases、local stdio MCP fixture 和 `test/integration/native/patched-native-session.test.mjs`；package script 为 `test:patched-native-session`。runner 校验 Pi `1.2.0` 与固定 HEAD `06a466935536f8c9bcacb2d5efc0fc021be1bdff`，使用临时隔离的 Pi 配置目录与内存 OAuth test store。测试在同一个 Pi upstream harness session 中加载真实 patched MCP extension 与 adapter，使用本地 fixture/faux provider，覆盖 native tool/resource/prompt live catalog、显式 catalog refresh、实际 tool 调用与 MCP 错误、资源及 prompt 读取、未信任 project config 不连接且不能写入、adapter `/mcp-adapter` 与原生 `/mcp` 状态、directTools 落盘与 session-only policy 分离、写入失败、runtime 注册服务器撤回时不中途重放、OAuth adapter store 映射、session reload 后 stale handle 失效及 v1 status 清空。该 runner 验证 status/命令状态，没有声称渲染 enhanced TUI panel；UI panel 测试仍单独负责 renderer 行为。
- 通过：`npm run test:patched-native-session -- --pi-source /Users/cgosu/code/JavaScript/pi-upstream-native`；实际使用固定 Pi 1.2.0 checkout，1 个 test file / 1 个 test 通过。`node --check` 对 runner、Vitest config、fixture、integration test 全部通过；`git diff --check` 与上述任务文件 trailing-whitespace 检查通过。test-value review 对 integration test 记录 `keep`（建议仅供参考，不会修改测试）。
- 限制：没有运行全量 upstream tests/build，也没有在本任务重新运行 typecheck；runner 使用本地 fixture 与隔离内存凭据，不访问生产服务或真实 keyring。Pi 上游保持未提交，本轮没有 commit/push。adapter 工作区已有其他迁移改动，最终交付前仍须按任务归属精确筛选。

### 2026-10-16：干净基线补丁/产物交付与 adapter 文档、Git 收尾

- 完成：为最终交付新增 `docs/native-mcp-patch.md`、`patches/pi-1.2.0-native-mcp-management.patch`（48 个固定基线文件）与 manifest，新增 `scripts/test-patched-public-types.mjs`/`test-patched-native-session.mjs`/`vitest-patched-native.config.mjs`，并在 adapter 完成 native bridge、面板、状态与配置映射迁移；用户文档在 README 增加 patched Pi 前置条件、`/mcp` 与 `/mcp-adapter` 分工、trust/keyring/生命周期/缓存与在 native owner 下保留/不激活的功能边界。本记录只描述本轮实际执行结果。
- 本任务实际执行的补丁可复现性检查：用 `git clone --no-hardlinks` 创建独立 checkout 并 `git checkout --detach 06a466935536f8c9bcacb2d5efc0fc021be1bdff`，确认 Pi `1.2.0`、apply 前 `git status --short --branch` 无修改；`git apply --check` 与 `git apply` 均退出 0，`git diff --check` 无输出，变更路径与 manifest 的 48 项一致；`shasum -a 256` 得到 `d499d6fba6728dbaced2876149b362780ce4b8ef2129ec3283587a456c46c654`，与 manifest 相同。该独立 checkout 与固定开发工作区 `/Users/cgosu/code/JavaScript/pi-upstream-native` 是两个不同目录，后者未被本任务修改（`git rev-parse HEAD` 与改动路径集合核对未变）。
- 本任务实际验证：在上述干净 checkout 执行 `npm ci --ignore-scripts --no-audit --no-fund`，装 299 个包成功（仅 engine/deprecation 警告，未跑生命周期脚本）；在 `packages/coding-agent` 执行 4 个 native 测试文件（`mcp-management`、`mcp-extension`、`mcp-direct-tools-config`、`mcp-owner-assembly`）共 57 项全部通过；`npm run test:public-types -- --pi-source /tmp/pi-patch-clean-r27` 通过 adapter typecheck、5 项 public build/export/package 检查及 packed 消费者严格编译，并同步 18 个生成 `dist` 文件；`npm run test:patched-native-session -- --pi-source /tmp/pi-patch-clean-r27` 在同一 harness session 加载真实 patched native extension 与 adapter，1 个集成测试通过。adapter 侧另跑 `npx vitest run test/unit/native test/unit/config/native-config-mapping.test.ts test/unit/auth/native-oauth-credential-backend.test.ts`，10 个文件、40 项通过；`npm pack --ignore-scripts --dry-run --json` 为 25 个文件。
- 副作用与恢复：本任务曾两次在 adapter 根目录运行 `npm run build:public`（一次直接、一次经 `npm run test:public-exports`），该脚本当时先 `rm -rf dist`，随后在 stock Pi 1.2.0 下因缺少管理 API 导出而在声明发射阶段失败，导致 6 个生成文件（`*.d.ts` 与 `mcp-keyring-helper.cjs`）被删除。未尝试手工重建，而是用文档化的 `npm run test:public-types -- --pi-source <patched checkout>` 重新生成；对 `dist/` 全部文件做 SHA-256 快照对比，结果与事故前完全一致（`DIST IDENTICAL`）。已在 [`docs/pitfalls.md`](pitfalls.md) 记录。没有 tracked 文件被误删、没有写入 Pi 上游、没有使用真实凭据或生产服务。
- 限制：未运行全量上游 `npm test`/`npm run build`/`npm run check`（历史 model-data 阻塞不变，也不作为本轮结果）；stock Pi 1.2.0 下 adapter 的 `npm run typecheck` 仍然因缺少 patched 管理 API 导出而失败，这是预期的宿主前置条件，不是 patched 环境的结果。patch、manifest 与 `dist` 的上游/产物交付已完成；Pi 上游未提交、未推送、未发布、未打 tag。
- 遗留：无已知未完成的迁移实现项；未激活的 adapter 设置（`scriptMode`、`disableProxyTool`、`autoAuth`、`trace`、`oauthDir`、server 级 `debug`/`trace`）按边界保留在配置中但不生效，已在 README 与 `current-state` 说明。

### 2026-10-16：adapter 迁移提交与 push

- 完成：按用户已记录的 adapter 主仓库 commit/push 授权，使用仓库本地身份 `CGOSU`/`dev@cgosu.com` 创建中文提交 `05c4a3f1023f2d0ce7458515d1782fc72370ed69`（`迁移 MCP 扩展到 Pi 1.2.0 原生管理协议`），包含 104 个文件：迁移源码与测试、`patches/` 补丁与 manifest、`docs/native-mcp-*.md`、验证 runner、tracked `dist` 生成物及本轮文档更新。只用显式路径暂存，未包含 `.pi-graph/`、`AGENTS.md`、`docs/clean-code.md` 或任何其他协作者改动；提交时工作区无未暂存/未跟踪的迁移外文件。
- push 前核对：分支 `main` 跟踪 `origin/main`（`git@github.com:CGOSU/pi-mcp-adapter.git`），本地恰好领先 1 个提交，远端仍为 `98a3b79…`，属安全 fast-forward。
- 通过：`git push origin main` 退出 0，输出 `98a3b79..05c4a3f  main -> main`；push 后 `git ls-remote origin refs/heads/main` 与本地 `HEAD` 同为 `05c4a3f…`，`git rev-list --left-right --count origin/main...main` 为 `0 0`。未使用强推，未重放。
- 边界：Pi 上游工作区 `/Users/cgosu/code/JavaScript/pi-upstream-native` 保持 `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 且改动路径集合与本任务开始时一致，未提交、未 push；未发布、未部署、未打 tag。

### 2026-10-16：修复发布构建失败丢失 dist 的隐患

- 背景：上一轮的 `build:public` 副作用被记为运维注意事项。用户确认修复该隐患，使其不再依赖“不要跑错命令”的人为约定。
- 完成：`scripts/build-public.mjs` 去掉构建前的 `rm -rf dist`，改为在仓库内 `.tmp-public-build-*` 暂存目录完成 JS（esbuild）、声明（TypeScript）与运行资源拷贝，全部成功后才用 `rename` 把暂存目录发布为 `dist/`；发布失败会还原旧目录（还原也失败时抛出 `AggregateError` 并指明旧产物所在路径），暂存目录在 `finally` 中清理。`.gitignore` 新增 `.tmp-public-build-*`。
- 通过（developer-test 本机实际执行）：在同一 stock Pi 1.2.0 工作区运行 `npm run build:public`，仍以 `src/native/config-assembly.ts` 等 `has no exported member` 失败（exit 1）；`dist/` 保持 18 个文件，`find dist -type f -exec shasum -a 256 {} +` 与构建前快照完全一致（`DIST PRESERVED`），仓库根无 `.tmp-public-build-*` 残留。`npm run test:public-types -- --pi-source /Users/cgosu/code/JavaScript/pi-upstream-native` 通过：adapter typecheck、5 项 public exports/package 检查，同步后的 18 个 `dist` 文件与改动前逐个 SHA-256 一致。`node --check scripts/build-public.mjs` 与 `git diff --check` 通过。
- 遗留：本修复未新增自动化回归测试——`*.test.mjs` 断言需运行真实失败的构建，成本高于本次风险；失败路径已由上述真实 stock Pi 执行验证。
- Git 交付：改动全部属本次修复，工作区无迁移外文件，使用仓库本地身份 `CGOSU`/`dev@cgosu.com` 创建中文提交 `7f5cfe89583bd28331af8686fe4f1b1bdeca255c`（`修复构建失败丢失 dist 生成物的隐患`，8 个文件），并正常 push 到 `origin/main`（`f0047be..7f5cfe8`，fast-forward）。push 后 `git ls-remote origin refs/heads/main` 与本地 `HEAD` 同为 `7f5cfe8…`，`git rev-list --left-right --count origin/main...HEAD` 为 `0 0`；未强推、未重放。Pi 上游仍为 `06a466935536f8c9bcacb2d5efc0fc021be1bdff`（48 个改动文件），未提交、未 push。

### 2026-10-16：增加 Pi 1.3.0 固定基线补丁与 adapter 支持验证

- 决定与交付：按用户采用的方案保留 Pi 1.2.0 patch/manifest，并以独立版本化资产增加 Pi 1.3.0 固定 commit `71023aec1546d6d677a65669c5665c0927ce0dd0` 的 48-path patch；1.2.0 patch SHA-256 `d499d6fba6728dbaced2876149b362780ce4b8ef2129ec3283587a456c46c654` 和 manifest SHA-256 `d7507252bc0c98df8f04d33fb0bf10092a128e19ec40e2b5d31dd8f552e664c6` 未改变。1.3.0 patch SHA-256 为 `953d4911373cddaa133989515786e247369edb43aad438dfca5170d0a00d3d78`。准确路径、manifest 和限制唯一维护在 [`docs/native-mcp-patch.md`](native-mcp-patch.md)。
- 干净基线复现：在新建 detached Pi 1.3 checkout `71023aec1546d6d677a65669c5665c0927ce0dd0` 上 `git apply --check` 与 `git apply` 通过，48 个路径（22 修改、26 新增）与 manifest 一致；Pi 1.2 也在独立 fixed checkout `06a466935536f8c9bcacb2d5efc0fc021be1bdff` 上成功 apply。本任务不在既有脏 Pi 工作区切换、清理、安装依赖或应用补丁。
- 实际验证：Pi 1.3 checkout 内定向 native 测试 4 files/53 tests 通过；adapter `npm run test:public-types -- --pi-source <1.3-checkout>` 的 typecheck、5 项 public exports/package 检查、packed consumer 编译通过并同步 18 个 dist 文件；`npm run test:patched-native-session -- --pi-source <1.3-checkout>` 1 项通过。Pi 1.2 checkout 上相同 public-types/packed consumer 与 same-session runner 也通过。README、package 文件集和补丁文档更新后，1.3 与 1.2 的 `test:public-types` 又分别重跑通过（每版 5 项 exports/package 检查、packed consumer、18 个 dist 文件）。`npm run test:patched-pi-runners` 6 项通过；native adapter unit tests 2 files/9 tests 通过。`npm pack --dry-run --ignore-scripts --json` 为 31 个文件，包含两版 patch/manifest 和 README 链接文档，不含 `src/**`、`test/**` 或 source map；未发布。
- 检查过程：一次 `test:public-types` 执行的 staged tarball 检查报缺少 `docs/native-mcp-patch.md`；未改实现后同一 Pi 1.3 命令再次运行，public exports/package 检查 5 项及 packed consumer 均通过，首次失败原因未确认。另一次在 adapter 根目录直接运行 `npm run test:public-exports` 时使用 stock Pi 1.2.0 类型而因缺 patch API 导出失败；这是非 patched host 不满足构建前置条件，不把该失败记为 patched 验收通过。文档/发布清单更新后，Pi 1.3 与 1.2 的 `test:public-types` 均分别重跑成功。清理两个已用完的独立 Pi worktree 后，额外尝试再次用 1.3 worktree 路径运行该命令，因该临时路径已清理而以“checkout missing or inaccessible”退出；此后未声称它通过，先前固定 checkout 上的成功结果保持不变。
- 文档/边界：README、协议说明、patch 复现文档、current-state、pitfalls 与本记录更新为准确的双固定版本范围；peer `^1.2.0` 不被描述成任意 Pi build 的兼容承诺。检查发现 adapter 缺失 API/能力错误文案仍把 Pi 1.2.0 写作版本建议；本 docs-only 收尾任务未改源代码，并在 README 明示该提示文字限制，后续可单独更新诊断文案。文件审阅：adapter 仓库内 3 项测试价值建议均登记 keep；上游 Pi owner 文件位于项目外，review ledger 不支持其路径，未把 adapter 审阅冒充为上游源码审阅。README 共 871 行，完整人工检查后保留整体手册结构；file_review 不支持 Markdown 结构审阅登记。两个本任务创建的 Pi 临时 detached worktree 在验证完成后通过 `git worktree remove --force <exact-task-worktree>` 清理，基础迁移 checkout 保留。未运行 Pi 全量 test/build/check，未改、提交或推送 Pi 上游，未使用真实 keyring、生产 MCP/LLM 或用户配置；未 push、发布、部署或打 tag。
- Git 交付：仅将本任务 17 个明确归属文件提交为中文 adapter commit `增加 Pi 1.3.0 固定基线支持`，身份 `CGOSU`/`dev@cgosu.com`；首次交付时留在本地，未纳入其他协作者文件，也未对 Pi 上游提交。之后用户明确要求“commit push”：push 前 fetch 确认 `origin/main...HEAD` 为 `0 1` 且工作区干净，遂正常 `git push origin main`；push 后再次 fetch，差异为 `0 0`，`main` 与 `origin/main` 同步。未强推、未发布、未改 Pi 上游。
