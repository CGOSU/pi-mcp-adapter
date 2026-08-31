# 设计决策

本文件记录已经确认且会影响后续实现的决定。临时想法和普通操作记录不写入此处。

## 记录格式

每项决策应包含日期、决定、原因和约束。如果后续改变决定，应注明被替代条目，而不是删除历史。

## 已确认决策

### 2026-08-31：仅保留标准 MCP 配置来源

- 决定：删除宿主专属 MCP 配置探测、兼容导入、setup 采用流程和 CLI `init`；`imports` 与 `settings.hostConfigDiscovery` 遗留字段在配置边界被忽略。标准共享文件、Pi override、provenance、setup 写入和 token CLI 保留。
- 原因：宿主配置格式和路径不是稳定的 MCP 配置契约；保留探测或兼容入口会让启动、诊断和交互流程继续读取用户未明确选择的宿主文件。
- 约束：不得扫描 Cursor、Claude、Codex、OpenCode、Windsurf、VS Code 等宿主路径；共享来源的 `directTools` 写回仍必须落到 Pi-owned 文件；不引入迁移或兼容层。

### 2026-08-23：公共 npm 包采用五入口 ESM code splitting

- 决定：包根、`types`、`config`、`metadata-cache`、`oauth` 五个公共入口分别构建为 ESM，并在各自入口内部保留 native `dynamic import()` 与延迟 chunks；发布 `dist`、`dist/cli.js` 及 script worker、keyring helper、AppBridge 三项独立运行资源。
- 原因：将源码直接聚合成单 JS 会提升 MCP runtime、OAuth、命令和 UI 的启动导入成本，破坏已有 Lazy Load；分别构建入口又能避免某个公共 subpath 的共享依赖被提升到 Pi 扩展入口。
- 约束：依赖和 Pi host peer 保持 external；禁止 `inlineDynamicImports`；构建必须由 `npm run build:public` 可重复生成，`prepack` 可更新 npm 发布物但 production-only 安装不得编译；发布 tarball 不超过 60 个文件且不包含 `src/**`、`test/**` 或 source map。

### 2026-08-23：以动态模块边界降低 Pi 扩展启动成本

- 决定：把 metadata cache、Schema 和注册所需代码留在 `index.ts` 启动闭包；把 MCP runtime、连接、OAuth、命令、脚本、proxy/direct 执行和 UI runtime 改为缓存的原生 `dynamic import()`，由共享初始化 Promise 在首次需要时加载。
- 原因：Pi 的 `module import` 计时覆盖入口的 Jiti 转换和静态依赖闭包，而不是 MCP 连接初始化；缩小静态闭包可以降低冷启动导入成本。
- 约束：有效全 lazy 缓存不得后台导入完整 runtime；首次 MCP 使用承担延迟加载成本；eager、keep-alive、冷缓存、直接工具、重试、generation 和 runtime owner 生命周期继续沿用既有语义。

### 2026-08-23：使 Git 版 Pi 包在 production-only 安装下可用

- 决定：移除安装期 `prepare` 编译，改由 `prepack` 在 npm 打包前执行 `build:public`；将 `tsconfig.public.json` 生成的 `dist` 文件纳入仓库，并以 LF 保持生成结果稳定。
- 原因：Pi 更新 Git 扩展时执行 `npm install --omit=dev`，安装阶段没有 TypeScript、Node 类型和 Pi 开发类型包，原 `prepare` 必然失败；Git 扩展入口本身不需要安装期编译，而公共 Node exports 仍需要可用的预构建文件。
- 约束：不得把编译器或开发类型包移入运行时 dependencies；CI 必须检查 `dist` 无漂移，并覆盖 Windows production-only 安装和公共 exports 加载。

### 2026-08-23：以领域目录和兼容 facade 作为最终源码布局

- 决定：实现按职责固定在 `src/contracts`、`src/catalog`、`src/config`、`src/runtime`、`src/auth`、`src/tools`、`src/ui`、`src/commands` 和 `src/extension`；根目录只保留公共入口、CLI 和一行兼容 facade。测试按 `test/unit`、`test/integration`、`test/node` 与 `test/fixtures` 组织。
- 原因：让内部依赖指向精确领域路径，避免公共聚合入口扩大启动闭包，并让 npm 发布边界可以通过 `src`、公共 facade 和 tracked `dist` 明确验证。
- 约束：内部模块不得反向依赖公共 facade；新增模块不得通过 barrel export 回到启动入口；根兼容入口、公共 exports、Pi extension entry 和工具行为保持不变。

### 2026-08-23：性能验收记录同机分布而非绝对门禁

- 决定：启动性能只比较同一宿主、同一 benchmark 的 cold/warm 中位数，同时保留真实结果；不因单次宿主噪声引入绝对时间门禁或改变懒加载边界。
- 原因：Windows/Pi/Jiti 的文件系统缓存和进程启动成本会显著影响 fresh RPC 样本。最终 3-run cold module import 为 `387ms`、warm 为 `72ms`，静态启动导入图仍满足边界；catalog 与 10,000 工具搜索回归保持线性/低毫秒级表现。
- 约束：后续性能变化必须用 `npm run benchmark:startup` 和 `npm run benchmark:catalog` 的同机中位数复测，并明确记录未达历史参考值的结果，不得把延迟 runtime 成本描述为消失。

### 2026-08-23：以 HEAD A/B 结果判定领域迁移未造成启动回退

- 决定：不为未达到 `300ms` 的绝对冷启动目标引入额外懒加载或聚合优化；以同一 Windows/Pi 0.84.2 宿主、同一 3-run fresh RPC benchmark 与 `HEAD` 临时归档进行 A/B 判定。
- 原因：当前工作树 cold module import median `398ms`、warm `65ms`，HEAD 基线分别为 `398ms` 和 `60ms`；5-run 当前 cold `465ms` 且样本为 `401–691ms`，说明 fresh Jiti/进程启动噪声显著。当前结果未显示本轮领域迁移造成可归因回退。
- 约束：文档必须保留未达到历史 `365ms`/`300ms` 目标的真实结果；后续性能优化须先有同机 A/B 证据，不得为绝对门禁改变已确认的启动边界。
