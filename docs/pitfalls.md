# 开发踩坑记录

本文件记录容易复发且不直观的问题。一次性报错、普通开发流水和未经验证的猜测不写入此处。

## 记录格式

每条记录包含：

- 日期：发现或最后验证日期；
- 现象：可观察到的错误或异常行为；
- 根因：经过确认的直接原因；
- 修复：已验证有效的处理方法；
- 验证：复现、测试或检查命令及结果。

## 已知问题

- 日期：2026-08-23；
  现象：启动基准的 Jiti 缓存命中与冷缓存结果差异很大，若只运行普通 warm import，不能代表冷启动的 `module import` 成本；
  根因：Jiti 会复用文件系统缓存，`PI_TIMING=1` 只负责显示计时，不会自动清除缓存；
  修复：冷样本显式设置 `JITI_FS_CACHE=0`，并让 `npm run benchmark:startup` 为每次样本启动 fresh Pi RPC、隔离配置目录，同时分别报告冷/缓存中位数；
  验证：`npm run benchmark:startup -- --runs 3` 实测冷 module import 中位数 363ms、缓存命中中位数 58ms。

- 日期：2026-08-23；
  现象：Windows 宿主的完整 Vitest 仍可能出现全局配置污染、Linux keyring、taskkill、Unix socket、symlink 或文件 mode 失败；本次针对性行为集合中唯一失败是期望 POSIX `0600`、实际 Windows mode `0666`；
  根因：部分测试断言 Unix 权限/进程语义，另有测试读取宿主 HOME 下的 Codex/OpenCode/Penpot 配置；这些不是源码目录迁移造成的失败；
  修复：Node runner 改用 npm 的真实 `npm_execpath`，public export fixture 改为复制布局，避免 Windows `.cmd`/symlink 限制；其余平台差异保留为测试环境边界，使用针对性 Vitest、typecheck、public build、静态导入图和独立 benchmark 验证代码；
  验证：`npm run test:oauth` 141 个测试通过，`npm run test:public-exports` 通过；最终 tarball 回归为 51 个文件，行为集合和完整结果记录于 [`docs/session-log.md`](session-log.md)。

- 日期：2026-08-23；
  现象：通过 Git 安装 Pi 包时，`npm install --omit=dev` 在 `npm run build:public` 处失败，并报告大量缺少 Node/Pi 类型的 TypeScript 错误；
  根因：npm 会对 Git 依赖执行 `prepare`，但 production-only 安装不会安装 TypeScript、`@types/node` 或 Pi 开发类型包；
  修复：删除安装期 `prepare`，改用 `prepack`，并将公共 `dist` 构建纳入仓库；CI 增加生成物一致性和 Windows production-only 安装验证。发布测试同时必须检查 tarball 不含 `test/` 或 `__tests__/`；
  验证：最终 tarball 回归为 51 个文件且无 `src/**`/`test/**`；临时干净副本执行 `npm install --omit=dev --no-audit --no-fund` 成功，并成功导入四个独立公共 Node subpaths；包根入口由带 Pi peer 的 public exports 测试覆盖。

- 日期：2026-08-23；
  现象：原生 keyring fallback 测试在 Windows 上把 POSIX `/tmp/...` 字符串与实现生成的 Windows 路径比较，导致平台无关的 fallback 逻辑被误报失败；
  根因：测试 stub 的 `require.resolve` 返回值和 native binding 路径没有使用宿主路径规则；
  修复：使用 `join(tmpdir(), ...)` 构造 package.json 与 native binding 路径，保留 fallback 分支和错误链断言不变；
  验证：`npm run test:oauth` 的 141 个 Node tests 全部通过。

- 日期：2026-09-01；
  现象：Pi 的包扩展紧凑标签显示为 `包源:dist`，而不是包源名称；
  根因：Pi 会把包根下 `dist/index.js` 的父目录作为扩展标识的一部分；
  修复：使用 `extensions/index.js` 作为 manifest 入口，并由 wrapper 转发到构建产物；
  验证：Pi 0.84.4 紧凑标签检查输出 `CGOSU/pi-mcp-adapter`，发布 tarball 包含 wrapper。

- 日期：2026-10-16（当日已修复）；
  现象：在 adapter 根目录执行 `npm run build:public`（或经 `npm run test:public-exports` 间接执行）在 stock Pi 1.2.0 工作区失败，并丢失 `dist/` 中的生成文件；
  根因：`scripts/build-public.mjs` 曾在构建之前就 `rm -rf dist`，而 `src/native/*.ts` 引用 patched Pi 才有的管理 API 导出；在 stock 1.2.0 下声明发射阶段报 TS2305，且因为清空发生在失败之前，`dist/*.d.ts` 与 `mcp-keyring-helper.cjs` 被删除；
  修复：构建脚本改为先在仓库内 `.tmp-public-build-*` 暂存目录完成 JS、声明与运行资源构建，全部成功后才用 `rename` 原子替换 `dist/`；替换失败会把旧目录还原，暂存目录在 `finally` 中清理；已加 `.gitignore` 条目。事故当时的恢复方式是改用 `npm run test:public-types -- --pi-source <patched-Pi-checkout>` 重新生成（它在临时副本中按 patched Pi 构建并仅在校验全部通过后同步生成文件）；该 runner 至今仍是重新生成发布产物的推荐途径；
  验证：2026-10-16 修复后在同一 stock Pi 1.2.0 工作区重跑 `npm run build:public`，仍以 `has no exported member` 失败（exit 1），但 `dist/` 保持 18 个文件且逐个 SHA-256 与构建前快照完全一致，仓库根无 `.tmp-public-build-*` 残留；`npm run test:public-types -- --pi-source /Users/cgosu/code/JavaScript/pi-upstream-native` 仍成功构建并通过 5 项产物检查。
