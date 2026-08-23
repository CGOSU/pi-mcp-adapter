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
  现象：当前 Windows 宿主执行完整 `npm test` 或 public export 测试会遇到与本次代码无关的 `spawnSync npm.cmd EINVAL`、symlink `EPERM` 及平台专属测试失败；
  根因：既有测试 runner 未为 Windows `.cmd` shim 使用 shell，public export 测试需要创建 node_modules symlink，另有 Linux/Unix 权限和 mode 假设；
  修复：本次不扩大范围修改既有测试基础设施；使用针对性 Vitest、typecheck、public build、静态导入图和独立启动基准验证本次变更，并保留完整失败结果；
  验证：`npm test`、`npm run test:public-exports` 和串行完整 Vitest 的真实结果记录于 [`docs/session-log.md`](session-log.md)。
