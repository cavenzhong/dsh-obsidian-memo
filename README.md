# Obsidian MEMO

把 Obsidian 的「进行时」文件夹，变成 DSH 左侧栏入口的一面淡色便签墙（Obsidian MEMO）：阅读/编辑、AI 评论、归档、开档，全在一个面板里完成。只读写 md 文件本身，Obsidian 仍是唯一的数据主人。

## 它长什么样

```
┌─ DSH 侧栏 ─┐┌──────────── 进行时 · 便签墙 ────────────┐
│ 会话       ││ 120 张便签            [刷新] [设置]     │
│ 插件       ││ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│ 📌 便签    ││ │WORKING_NOW│ │ 无 tag   │ │🚧长期  │ │
│ 自动化任务 ││ │宋体大标题  │ │标题      │ │标题     │ │
└────────────┘│ │黑体补充   │ │补充      │ │补充     │ │
              │ │> 评论callout│ │         │ │         │ │
              │ │🔍💡⚠️✅ 归档 开档│ └─────────┘ │ │
              │ └──────────┘                          │
              │ ┌ 已选《标题》 写一句，回车追加为正文 ┐ │
              │ └────────────────────────────────────┘ │
              └────────────────────────────────────────┘
```

- **淡色便签**：按 tag（相对便签目录的第一层子文件夹）稳定分配颜色，无 tag 用纸白；开启暗色主题时所有便签自动换成同色相的深色纸与提亮墨色。
- **标题 = md 文件名**（去掉 `.md`）：卡片和阅读视图都用文件名；第一段属于正文。
- **字体对比**：标题用中文宋体（Songti SC 优先）、加大加粗；正文用系统黑体、小一号；callout 评论更小更淡。frontmatter（meta）不渲染。
- **阅读**：单击卡片从右侧推出约 1/3 宽的面板看全文（正文块 + 全部评论 + PROJECTS），面板宽度可拖拽调整。
- **编辑**：在抽屉里双击正文进入编辑态，直接改原始 Markdown（不渲染）；保存只替换正文，frontmatter 原样保留。
- **排序**：默认按文件创建时间（新→旧，菜单第一项）；右上角排序按钮可切换创建时间正序、最近修改、文件名。
- **AI 评论**：卡片 hover 行里的 emoji 按钮（默认 🔍 洞察 / 💡 延伸 / ⚠️ 风险 / ✅ 下一步），点击后后台用默认模型生成，以 Obsidian callout 追加到 md 末尾，卡片上同步显示。
- **归档**：选一个归档目录，文件移动过去；顶部小浮窗 6 秒内可「撤销」，不挡其他操作。
- **开档**：输入项目名，在开档目录下建 `<项目名>/<项目名>.md`，用可编辑的建档提示词生成结构化文档（诉求 / 现状与已知 / 调查与线索 / 下一步 / 待确认），并把链接写回源便签的 `PROJECTS`。

## 安装

```bash
# 在 DSH 里用工具安装（等价于 Plugins 页的“安装”）：
#   plugin_manager  action=install_bundle  target=link:/绝对路径/dsh-sticky-notes
```

安装后左侧栏末尾出现便签图标。首次点击面板会提示去设置里选目录。

### 可选：改代码即时生效（开发用）

在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 的 `hmr` 条目里加上本插件目录：

```yaml
- id: hmr
  name: "@deepseek-ai/dsh-hmr"
  config:
    root:
      - "."
      - /Users/cavenzhong/Documents/个人项目/memobisidian/dsh-sticky-notes
```

之后改 `lib/*.js` 会自动重载（Host 与浏览器半都生效）。

## 首次配置

面板右上角齿轮 → 设置抽屉：

| 字段 | 说明 |
|---|---|
| 仓库根目录 | Obsidian 仓库绝对路径（如 `…/Documents/2024仓库`） |
| 便签目录 | 想展示的主目录（如 `⛳️进行时&未整理`），必须是仓库子目录 |
| 开档目录 | 新的项目文件夹建在这里（如 `✅DONE_PROJECT已完成/projects`） |
| 归档目录 | 可加多个：名称 + 路径；归档按钮会弹这些目标 |
| Emoji 与提示词 | 每枚 emoji 有 emoji 字形、名称、callout 类型、提示词；可增删 |
| 建档提示词 | 「开档」时生成结构化文档的提示词 |

设置保存在插件自己的 `data/settings.json`，不写 Obsidian 仓库，也不写 DSH profile 配置。目录字段用系统目录选择器（macOS 原生对话框，可直接选 iCloud 里的 Obsidian 库）；也可以手动输入路径（支持 `~`）。

## 它怎么碰你的文件

- **只写配置目录内的 md**：便签目录、归档目录、开档目录都必须落在仓库内；越界请求直接拒绝。
- **frontmatter 原样保留**：渲染永远丢弃 meta；只有「开档写回 PROJECTS」这一处会改 frontmatter，且只改 `PROJECTS` 一个键，已有非空值时不覆盖。
- **原子写**：先在目标目录写临时文件再 `rename`，不会出现半截文件。
- **保存与评论**：保存只替换 frontmatter 之后的正文；评论追加在文末，都是纯文本拼接，不重排 frontmatter、不规范化格式。
- **与 Obsidian 并发**：没有文件锁；Obsidian 开着同一篇笔记时，外部写入会触发它的“文件被修改”提示；极少数同一秒内两边同时写的场景是最后写入者生效（和 Obsidian 自身的外部编辑行为一致）。
- **不渲染 meta**：卡片标题取第一段（或第一个标题），正文取其余块，callout 作为评论；行尾 block id（`^qa-daily-preview-…`）不显示。

## AI 评论与开档

- 用的是 DSH 当前默认模型（`agentDefaultModel`），通过 Host 的 `ctx.llm` 调用：**不占用任何会话、不写对话日志**。
- 生成是异步 job：点击后立即返回，面板显示「正在写评论…」，完成后写入 md 并自动刷新；失败会在 toast 里给出原因。
- 评论 callout 形如：

  ```markdown
  > [!quote] 🔍 洞察 · 2026-11-03 22:10
  > 这条想法真正的钩子在……
  ```

- 开档生成的项目文档带 frontmatter：

  ```markdown
  ---
  PROJECTS: "[[⛳️进行时&未整理/xxx|xxx]]"
  TODO: []
  ---
  ```

## 技术架构

- **Host 半**（`lib/index.js` + `lib/notes.js`/`lib/scan.js`/`lib/settings.js`/`lib/ai.js`）：目录扫描（mtime 缓存）、Markdown 解析、原子写入、归档/撤销、开档、设置、模型调用。
- **通道**：Host 在 web server 上注册包内已认证 RPC 前缀路由 `/sticky-notes`，复用 client-connection 的 RPC 信封协议（Client 仍用 `ctx.connection.rpc.call('/sticky-notes', endpoint, payload)`），认证复用 `ctx.connection.requestRejection`。Web GUI 与桌面 App 外壳都走同一条已认证通道，不新开端口、不需要额外的 CSRF 防护。
- **目录浏览**：设置使用系统选择器（`pickDirectory`）；`browseDirectory`（Host 进程 Node fs 列目录）作为后备能力保留。
- **Client 半**（`lib/client.js`）：单文件浏览器 bundle，注册 `sidebar.panellist` 图标与 `main` 面板；只用 React，不依赖 DSH 私有包；轮询 `state`（4 秒，页面隐藏时暂停）并按 revision 增量更新。
- **不注册模型工具、不注入提示词**：除用户主动点评论/开档外，不产生任何模型调用与会话成本。

## 已知限制

- 不做全文搜索、拖拽排序、批量选择、从面板直接打开 Obsidian。
- 编辑态保存是显式按钮（或 Cmd/Ctrl+S），退出编辑态会丢弃未保存修改。
- 归档撤销窗口 6 秒（token 服务端保留 10 分钟）；撤销前若原位置已有同名文件则拒绝恢复。
- 面板以轮询感知外部修改，不是实时监听；Obsidian 保存后通常 4 秒内刷新。
- 手动改 `package.json` 或依赖不会被 HMR 检测；改 `lib/*.js` 需要配置 hmr root 才会即时生效。

## 开发与测试

```bash
cd dsh-sticky-notes
node --check lib/*.js     # 语法检查
node --test               # 单元测试 + mock-ctx 集成测试
```

接口与 UX 规格见 `docs/CONTRACT.md`。
