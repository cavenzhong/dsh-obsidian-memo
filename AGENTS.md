# 开发导航

- 包管理优先使用 `pnpm`；需要 Python 工具时优先使用 `uv`。
- 先读 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，按功能定位模块，再读相关测试与 [实现契约](docs/CONTRACT.md)。
- 浏览器源码在 `src/client/`。`lib/client.js` 是提交到仓库的生成文件，修改源码后运行 `pnpm build`；开发时可运行 `pnpm dev`。
- Host 从 `lib/index.js` 组合 `lib/host/` 服务；Markdown、文件边界、扫描和配置格式等基础能力仍在 `lib/`。
- 新功能放入对应职责模块。手写生产文件以 500 行为上限；接近上限时先检查能否按职责拆分，生成文件不受此限制。
- 模块通过显式导入和参数传递协作。共享可变状态应由所属服务或 hook 持有，Host 服务按每次 `apply` 创建，配置通过 `getSettings()` 读取当前值。
- 保持现有 RPC、Markdown/frontmatter、localStorage 键与路径边界兼容。行为变化同步更新契约和对应测试。
- 验证顺序：`pnpm install --frozen-lockfile` → `pnpm build` → `pnpm test`。`pnpm test` 会检查生成文件是否同步；`pnpm pack` 会自动构建。
- 测试按功能位于 `test/client/`、`test/host/`、`test/notes/`、`test/settings/`；共享测试运行器在 `test-support/`，测试只访问临时仓库。
