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

- 日期：2026-10-16（数据损失问题已修复；未打补丁的 Pi 仍不能完成构建）；
  现象：在适配器根目录执行 `npm run build:public`，或执行会间接触发它的 `npm run test:public-exports`，在未打补丁的 Pi 1.2.0 下会因缺少原生管理 API 类型而失败；旧构建脚本还会在失败前删除 `dist/` 中的文件；
  原因：适配器的 `src/native/*.ts` 使用了仓库固定补丁新增的 Pi API，而 npm 发布版的 Pi 1.2.0 不含这些导出；原构建脚本先清空 `dist/`，再开始可能失败的步骤；
  处理：`scripts/build-public.mjs` 现在先在 `.tmp-public-build-*` 暂存目录构建 JavaScript、声明和运行资源，全部成功后才替换 `dist/`；替换失败会尝试恢复旧目录，并在 `finally` 中清理暂存目录。恢复或更新产物时，使用 `npm run test:public-types -- --pi-source <已打补丁的 Pi 源码目录>`。持续集成必须检出固定 Pi 基线并应用仓库补丁后再构建；产物验证完成后，使用 `npm pack --ignore-scripts`，避免在未打补丁的宿主上触发 `prepack`；
  验证：修复后在未打补丁的 Pi 1.2.0 下重跑 `npm run build:public`，命令仍因缺少导出而以非零状态退出，但 `dist/` 的 18 个文件 SHA-256 全部不变，且没有暂存目录残留。`npm run test:public-types -- --pi-source /Users/cgosu/code/JavaScript/pi-upstream-native` 通过，产物检查 5 项通过。后续持续集成已改为使用打过补丁的固定基线；远端 GitHub Actions 尚未运行。
