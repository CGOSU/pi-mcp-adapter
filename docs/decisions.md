# 设计决策

本文件记录已经确认且会影响后续实现的决定。临时想法和普通操作记录不写入此处。

## 记录格式

每项决策应包含日期、决定、原因和约束。如果后续改变决定，应注明被替代条目，而不是删除历史。

## 已确认决策

### 2026-08-23：以动态模块边界降低 Pi 扩展启动成本

- 决定：把 metadata cache、Schema 和注册所需代码留在 `index.ts` 启动闭包；把 MCP runtime、连接、OAuth、命令、脚本、proxy/direct 执行和 UI runtime 改为缓存的原生 `dynamic import()`，由共享初始化 Promise 在首次需要时加载。
- 原因：Pi 的 `module import` 计时覆盖入口的 Jiti 转换和静态依赖闭包，而不是 MCP 连接初始化；缩小静态闭包可以降低冷启动导入成本。
- 约束：有效全 lazy 缓存不得后台导入完整 runtime；首次 MCP 使用承担延迟加载成本；eager、keep-alive、冷缓存、直接工具、重试、generation 和 runtime owner 生命周期继续沿用既有语义。
