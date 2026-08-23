# 设计决策

本文件记录已经确认且会影响后续实现的决定。临时想法和普通操作记录不写入此处。

## 记录格式

每项决策应包含日期、决定、原因和约束。如果后续改变决定，应注明被替代条目，而不是删除历史。

## 已确认决策

### 2026-08-23：以动态模块边界降低 Pi 扩展启动成本

- 决定：把 metadata cache、Schema 和注册所需代码留在 `index.ts` 启动闭包；把 MCP runtime、连接、OAuth、命令、脚本、proxy/direct 执行和 UI runtime 改为缓存的原生 `dynamic import()`，由共享初始化 Promise 在首次需要时加载。
- 原因：Pi 的 `module import` 计时覆盖入口的 Jiti 转换和静态依赖闭包，而不是 MCP 连接初始化；缩小静态闭包可以降低冷启动导入成本。
- 约束：有效全 lazy 缓存不得后台导入完整 runtime；首次 MCP 使用承担延迟加载成本；eager、keep-alive、冷缓存、直接工具、重试、generation 和 runtime owner 生命周期继续沿用既有语义。

### 2026-08-23：使 Git 版 Pi 包在 production-only 安装下可用

- 决定：移除安装期 `prepare` 编译，改由 `prepack` 在 npm 打包前执行 `build:public`；将 `tsconfig.public.json` 生成的 `dist` 文件纳入仓库，并以 LF 保持生成结果稳定。
- 原因：Pi 更新 Git 扩展时执行 `npm install --omit=dev`，安装阶段没有 TypeScript、Node 类型和 Pi 开发类型包，原 `prepare` 必然失败；Git 扩展入口本身不需要安装期编译，而公共 Node exports 仍需要可用的预构建文件。
- 约束：不得把编译器或开发类型包移入运行时 dependencies；CI 必须检查 `dist` 无漂移，并覆盖 Windows production-only 安装和公共 exports 加载。
