# 会话记录

本文件按时间追加每次工作的完成内容、实际验证和遗留问题，不记录敏感信息或未经验证的结果。

## 记录格式

每次记录应包含日期、完成内容、实际执行的验证及遗留问题。

## 会话

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
