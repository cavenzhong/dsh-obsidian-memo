# 代码结构与修改入口（0.16.6）

先按下表定位功能，再读目标文件的导入、参数和导出。RPC 与用户交互行为以 [CONTRACT.md](CONTRACT.md) 为准；历史修复见 [CHANGELOG.md](CHANGELOG.md)，暂缓事项见 [KNOWN_ISSUES.md](KNOWN_ISSUES.md)。

## 运行与源码

```text
Harness Host → lib/index.js → lib/host/ 服务 → lib/ 基础能力 → 本地仓库
Harness Web  → lib/client.js（生成）
                    ↑ pnpm build / pnpm dev
              src/client/index.js → 面板、组件与 hooks
                    ↓ 已认证 RPC /sticky-notes
                Host RPC 路由
```

- Host 使用原生 ES 模块，入口只创建服务并注册 endpoint。
- Client 按 ES 模块维护。esbuild 仅作为开发依赖，把源码生成 Harness `window.__ModuleLoader__.load` 所需的一个文件；运行时只从宿主读取 React 和 ReactDOM。发布包包含生成文件，使用者无需构建。
- `lib/client.js` 随源码一同提交，便于直接 `link:` 安装。生成文件带来源模块注释；修改应回到 `src/client/`。构建没有时间戳或机器路径，`pnpm build:check` 检查是否与源码一致。
- `src/client/testing.js` 集中组装已有 `__test` 调试接口；业务模块不依赖测试入口。

## Host：业务组合与状态所有权

`lib/index.js` 的 endpoint 表是 RPC 名称到实现的唯一映射。每次 `apply` 创建一套独立服务，队列、缓存、任务和撤回 token 不跨插件实例共享。

| 修改内容 | 入口 | 状态与边界 |
| --- | --- | --- |
| 认证、请求大小、信封协议 | `lib/host/rpc.js` | 只处理传输；不读写笔记 |
| endpoint 调度、操作串行化 | `lib/host/dispatch.js`、`writes.js` | 配置/删除队列与逐文件写锁保持原有顺序 |
| 用户配置、外部变更、切换 JSON | `lib/host/configuration.js` | 持有当前设置、位置、签名和配置队列；通过 `getSettings()` 提供最新值 |
| 扫描单飞与写后失效 | `lib/host/scanning.js` | 持有 scanner、epoch 与扫描队列；旧扫描不会回写新状态 |
| state/settings 响应、复合 revision | `lib/host/state.js` | 组合扫描、配置与任务快照 |
| 便签读写、新建、改名、待办 | `lib/host/notes.js` | 复用文件边界、内容版本和扫描失效 |
| 当前仓库与便签路径 | `lib/host/vault.js` | 读取最新配置并校验真实路径 |
| 全文与模型输入读取 | `lib/host/note-content.js` | 读原始 Markdown，不复用展示摘要 |
| 本地图片读取与附件查找 | `lib/host/images.js` | 持有命中/负缓存；切库和删除后清理 |
| AI 评论与开档 | `lib/host/ai-jobs.js` | 使用同一份任务表与写锁，保留现有并发/部分完成策略 |
| 评论删除与撤回 | `lib/host/comments.js`、`lib/comments.js` | 按序号定位 callout；撤回 token 与删除前原文由实例 session 持有 |
| 任务、撤回 token、过期回收 | `lib/host/session.js` | 持有当前实例的 jobs、归档与删除 token |
| 归档、删除、撤回、系统回收站 | `lib/host/mutations.js` | 复用现有独占移动与整组回滚 |
| 目录浏览、新建、系统选择 | `lib/host/folders.js` | 保持仓库和符号链接边界 |
| 版本、安装位置、调试日志 | `lib/host/environment.js` | 版本只读 `package.json`，旧配置仍从包根目录迁移 |

配置服务在接受新设置后通过 `onSettingsChange(next, previous)` 通知组合入口。只有扫描范围变化才重置 scanner，仓库或便签目录变化才清理图片缓存；AI/图片参数变化不会清空整库摘要。

## Client：按功能定位

| 功能 | 源码目录或文件 | 对应测试 |
| --- | --- | --- |
| 插件注册、样式/字典生命周期 | `src/client/index.js`、`runtime.js` | `test/client/registration.test.mjs` |
| 主面板组合 | `src/client/panel.js` | reader-layout、drag-sessions |
| 顶栏与全局快捷键 | `src/client/panel/` | preferences、reader-layout |
| 数据读取、响应代次与轮询 | `src/client/data/` | data、editor |
| 卡片、排序筛选、分页、笔记操作 | `src/client/wall/` | preferences、wall-rendering、note-actions、drag-sessions |
| 阅读块、抽屉编辑、宽度、钉住恢复、评论区折叠/拖高/删除 | `src/client/reader/` | editor、reader-layout |
| 快速记录、图片编码、输入快捷键 | `src/client/capture/` | capture、images |
| 拖拽浮层、动作栏、动画与会话 | `src/client/drag/` | drag-motion、drag-sessions |
| 图片队列、LRU、视口加载 | `src/client/images/` | images |
| 评论确认、开档对话框、任务通知 | `src/client/ai/` | ai、notifications |
| 设置组件、草稿、配置文件与回收站 | `src/client/settings/` | settings-ui、settings-draft、settings-config |
| 图标、通用对话框与 toast | `src/client/components/` | ai、reader-layout、notifications |
| localStorage 兼容与抽屉尺寸约束 | `src/client/preferences.js` | preferences、reader-layout |
| 中英文文案 | `src/client/i18n/` | registration、settings-ui、ai |
| 样式和主题变量 | `src/client/styles/` | styles、wall-rendering |

`panel.js` 组合数据、编辑、设置与交互 hooks，并把明确的回调交给视图。每个 hook 持有自己创建的 state/ref/effect；异步任务继续通过 `aliveRef`、请求代次和会话代次拒绝过期回调。高频拖拽移动仍只更新浮层 transform，不经过整墙渲染。

样式按 base → capture → wall → reader → settings → overrides 顺序组合。最后一层保留原有覆盖与深色规则；拆分时不调整 CSS 层叠顺序。

## 基础能力

`lib/files.js` 管路径、内容版本和原子/独占文件操作；`filename.js` 管文件名规则；`notes.js` 管 Markdown 解析与写回；`comments.js` 管评论汇总与删除纯函数；`scan.js` 管摘要和全文缓存；`capture.js` 管新建笔记、模板和附件；`settings.js` 管配置格式与持久化；`ai.js` 管模型请求/输出；`trash.js` 管回收组；`obsidian.js`、`config-picker.js` 管系统交互。业务服务调用这些能力，基础模块不依赖 Host 或浏览器组合层。

## 开发与验证

```bash
pnpm install --frozen-lockfile
pnpm build              # 修改浏览器源码后更新 lib/client.js
pnpm dev                # 持续构建，配合 Harness HMR
pnpm build:check        # 只检查产物一致性，不改写文件
pnpm test               # 一致性、架构边界和全部回归
node --test test/client/drag-sessions.test.mjs
node --test test/host/configuration.test.mjs
pnpm bench              # 临时数据性能基准
pnpm pack               # 自动构建并生成可安装的 tgz
```

先构建再运行定向浏览器测试，保证测试的是当前源码生成的发布文件。浏览器行为测试仍执行真正的 bundle，少量历史结构断言读取手写源码。`test-support/client.mjs` 提供 React/hook 运行器；`test-support/host.mjs` 提供临时仓库与认证 RPC 运行器，每个测试进程独立隔离。

新增代码应保持静态模块依赖无环，浏览器仅允许 React/ReactDOM 外部依赖，基础模块不反向依赖组合层，手写生产文件不超过 500 行。`test/architecture.test.mjs` 自动检查这些边界；超出时应重新划分职责，生成文件单独排除。
