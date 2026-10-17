# 开发踩坑记录

本文件记录容易复发、且不直观的问题；不收录一次性报错、普通操作过程或未经验证的猜测。

## 记录格式

每条记录应包含日期、现象、原因、处理方法和实际验证结果。

## 已知问题

- 日期：2026-08-23；
  现象：Pi 启动基准在缓存命中和冷启动时差异很大；只测普通缓存命中无法代表冷启动时的模块导入成本；
  原因：Jiti 会复用文件系统缓存，`PI_TIMING=1` 只显示计时，不会清理缓存；
  处理：冷启动样本显式设置 `JITI_FS_CACHE=0`，每个样本启动新的 Pi RPC 并隔离配置目录，同时分别报告冷启动和缓存命中的中位数；
  验证：`npm run benchmark:startup -- --runs 3` 测得冷启动模块导入中位数 363ms、缓存命中 58ms。

- 日期：2026-08-23；
  现象：Windows 上运行完整 Vitest 时，可能出现全局配置污染、Linux 系统密钥环、`taskkill`、Unix 套接字、符号链接或文件权限模式相关失败；曾有用例期望 POSIX `0600`，而 Windows 返回 `0666`；
  原因：部分用例断言 Unix 专属权限或进程行为，另有用例读取运行机器 `HOME` 下的 Codex、OpenCode、Penpot 配置；这些环境差异不等同于源码布局回归；
  处理：Node 测试运行器使用 npm 实际的 `npm_execpath`；公共导出测试夹具改为复制目录布局，避免依赖 Windows 目录符号链接。其余平台差异应使用针对性测试、类型检查、公共构建、静态导入图和独立基准分别核验，不要把未运行的完整测试套件说成通过；
  验证：`npm run test:oauth` 的 141 项测试通过，`npm run test:public-exports` 通过；当时的发布包检查为 51 个文件。各次测试范围见 [`docs/session-log.md`](session-log.md)。

- 日期：2026-08-23；
  现象：以 Git 依赖安装 Pi 扩展时，`npm install --omit=dev` 会在 `npm run build:public` 阶段失败，并报告缺少 Node.js 或 Pi 类型；
  原因：npm 安装 Git 依赖时会执行 `prepare`，而仅安装生产依赖不会安装 TypeScript、`@types/node` 或 Pi 开发类型包；
  处理：移除安装阶段的 `prepare`，改为打包前执行 `prepack`，并把已构建的公共 `dist` 纳入仓库。发布包测试还应确认没有 `test/` 或 `__tests__/`；
  验证：当时的发布包包含 51 个文件且不含 `src/**`/`test/**`；干净副本通过 `npm install --omit=dev --no-audit --no-fund`，并成功导入四个独立公共子路径。包根入口由带 Pi peer 的公共导出测试覆盖。

- 日期：2026-08-23；
  现象：Windows 上的系统密钥环回退测试把 POSIX `/tmp/...` 字符串与实现生成的 Windows 路径比较，错误地报告回退逻辑失败；
  原因：测试替身中的 `require.resolve` 返回路径和本机 binding 路径没有使用当前系统的路径规则；
  处理：使用 `join(tmpdir(), ...)` 构造 `package.json` 和本机 binding 路径，保留回退分支及错误链断言；
  验证：`npm run test:oauth` 的 141 项 Node 测试全部通过。

- 日期：2026-09-01；
  现象：Pi 紧凑视图中的扩展标签显示为“包源:dist”，而非包源名称；
  原因：Pi 会把包根目录下 `dist/index.js` 的父目录加入扩展标识；
  处理：将 `extensions/index.js` 设为清单入口，由它转发到构建产物；
  验证：Pi 0.84.4 的紧凑标签检查显示 `CGOSU/pi-mcp-adapter`，发布包包含该转发入口。

- 日期：2026-10-16（数据损失问题已修复；stock Pi 1.2.0/1.3.0 仍不满足 adapter build 前置条件）；
  现象：在适配器根目录执行 `npm run build:public`，或执行会间接触发它的 `npm run test:public-exports`，在缺少补丁 API 的 Pi host 下会因原生管理 API 类型缺失而失败；旧构建脚本还会在失败前删除 `dist/` 中的文件；
  原因：适配器的 `src/native/*.ts` 使用固定补丁新增的 Pi API，而 stock Pi 包不含这些导出；原构建脚本先清空 `dist/`，再开始可能失败的步骤；
  处理：`scripts/build-public.mjs` 现在先在 `.tmp-public-build-*` 暂存目录构建 JavaScript、声明和运行资源，全部成功后才替换 `dist/`；替换失败会尝试恢复旧目录，并在 `finally` 中清理暂存目录。恢复或验证产物时，只对照 [`docs/native-mcp-patch.md`](native-mcp-patch.md) 中已应用对应版本补丁的固定 checkout，运行 `npm run test:public-types -- --pi-source <patched-Pi-checkout>`。持续集成必须检出固定 Pi 基线并应用对应仓库补丁后再构建；产物验证完成后，使用 `npm pack --ignore-scripts`，避免在 stock host 上触发 `prepack`；
  验证：历史上在 stock Pi 1.2.0 下的 `npm run build:public` 因缺少导出以非零状态退出，但 `dist/` 的 18 个文件 SHA-256 全部不变，且没有暂存目录残留。之后在固定 patched Pi checkout 上运行 `npm run test:public-types` 通过；最新 1.2.0/1.3.0 固定 checkout 的公共产物验证见 [`docs/native-mcp-patch.md`](native-mcp-patch.md)。远端 GitHub Actions 尚未由本轮运行。

- 日期：2026-10-16；
  现象：将新版本的上游源码补丁作为 `*.patch` 交付文件暂存后，在 adapter 仓库执行普通 `git diff --cached --check` 会报告补丁内容中的空格缩进和尾随空白；
  原因：Git 把补丁文件自身作为新增文本检查，补丁又逐字包含上游源文件格式，诊断针对的是 artifact 内容而非 adapter 的源码/文档/测试差量；直接格式化补丁会改变其 SHA-256 并破坏与固定基线的对应；
  处理：不要规范化或重写已校验的上游 patch。对 adapter 其他 staged 文件运行 `git diff --cached --check -- . ':(exclude)patches/*.patch'`，并分别核对 patch hash、固定基线 `git apply --check` 及 apply 后上游源码差量；
  验证：Pi 1.3 patch 的 adapter staged diff 出现上述 artifact 诊断；其 SHA-256 与 manifest 一致，固定 Pi 1.3.0 独立 checkout 的 apply 与上游 `git diff --check` 已通过。

- 日期：2026-10-17；
  现象：packed Pi CLI 与 adapter runtime test 即使 adapter app 使用 `npm install --omit=peer`，仍可能加载到 Pi peer，导致 extension 使用另一个旧 package instance，错误表现为 adapter assembly 未进入 bundled built-in owner；
  原因：Node/Jiti 会沿实际模块路径向父目录搜索 `node_modules`；peer omitted 只保证 adapter app 自身没有该依赖，不能屏蔽 ancestor `node_modules`。此外，在临时 app 子目录没有自己的 `package.json` 时，`npm install` 可能向更上层 package root 安装依赖；
  处理：给每个 isolated app 建立独立 `package.json`，把 CLI host 和 adapter 安装在不同目录，确认 adapter peer 缺失且没有任何 ancestor Pi `node_modules`。需要确认 resolver 时，可用 `JITI_DEBUG=1` 核对 `@earendil-works/pi-coding-agent` 命中 bundle 的 virtual module；最终证明仍以真实 packed CLI 运行观察为准；
  验证：第一次 RPC test 在 ancestor `/tmp/.../runtime/node_modules` 存在 Pi package 时拿到空 owner snapshot；删除该目录并让 Pi 内置 owner通过事件总线请求/接收 assembly 后，fresh packed CLI 返回 programmatic fixture 的 connected/live catalog，且 EOF 后 fixture 退出。

- 日期：2026-10-17；
  现象：给 Pi managed install 增加独立 patched release 后，若 release 目录名仍是纯 SemVer，Pi 自己的更新清理可能把它视为旧版本并删除；另一个独立问题是 npm v12 把 user/global config 都指定成同一个 `/dev/null` 会报重复加载配置，导致离线安装失败；
  原因：Pi managed release pruning 只把 SemVer 目录纳入版本保留/清理；npm config loader 会拒绝同一 config 文件被 user/global scope 同时加载；
  处理：补丁 release 使用稳定非 SemVer alias（原 stock release 保留），只在新 release 完整安装与 API/bundle/CLI 验证后切换 `current-version`；离线 npm install 在独立 staging 创建两个不同的空 config 文件，禁用 lifecycle scripts 并强制 offline/cache；
  验证：真实 Pi 1.3.0 tarball 在隔离 managed-root 模拟中成功离线安装、验证并原子切换；本机 launcher/current pointer 验证与实际 patched release RPC smoke 通过；真实 `pi update --all` 未运行，详见 [`docs/native-mcp-patch.md`](native-mcp-patch.md) 和 [`docs/session-log.md`](session-log.md)。

- 日期：2026-10-17；
  现象：在 adapter 根目录直接 `npm pack` 会重新执行 `prepack`，并因管理 API 类型不存在而在 `build:public` 失败，即使 `test:public-types -- --pi-source <patched checkout>` 刚刚验证过 patched build；
  原因：当前根 `node_modules` 的 development Pi 仍是 stock 1.2.0，缺少 patch 才增加的 public MCP management types；裸 `npm pack` 的生命周期脚本不会自动复用 `test:public-types` 的隔离 patched-Pi build；
  处理：先对明确的固定 patched Pi checkout 运行 `npm run test:public-types -- --pi-source <patched-Pi-checkout>`，随后从该成功 build 的 `dist/` 使用 `npm pack --ignore-scripts`；不得跳过 fresh public-types/artifact verification 或对未验证 `dist` 直接打包；
  验证：本轮裸 `npm pack` 的 `prepack` 因 stock 1.2.0 缺少 MCP management exports 失败；其后 `test:public-types` 的 typecheck、5 项 exports/package tests 和 packed consumer 通过，`npm pack --ignore-scripts` 生成 adapter tarball，SHA-256 `d4b6ee49f8f5d21b527779321b15e25aeeec22943a2327a9643198ef52f06428`。
