# dsh-sticky-notes · 实现契约（Host ↔ Client）

> 这是并行开发的唯一接口真相。Host 端 `lib/notes.js`、`lib/settings.js`、`lib/scan.js`、`lib/ai.js`、`lib/index.js` 由 Lead 实现；`lib/client.js` 由 client-ui 实现；`test/` 由 verifier 实现。任何一方需要改契约，先在共享任务/消息里说，不要单方面改。

## 0. 一句话

Obsidian 的「进行时」文件夹 → DSH 左侧栏一个便签图标 → 中央全宽便签墙。只读写 md 文件本身，不碰 Obsidian。

## 1. 包结构与运行方式

- 包目录：`/Users/cavenzhong/Documents/个人项目/memobisidian/dsh-sticky-notes`
- 包名：`dsh-sticky-notes`，ESM，零运行时依赖。
- Host 半：`lib/index.js`（Cordis 插件，`export function apply(ctx, config)`）。
- Client 半：`lib/client.js`，单文件浏览器 bundle（`window.__ModuleLoader__.load({ id: 'dsh-sticky-notes', factory(require) { ... } })`）。
- 设置：`data/settings.json`（插件目录内，运行时生成，HMR 已忽略 `data`）。绝不写 Obsidian 仓库里的配置文件。

## 2. 通信通道

Host 插件在 web server 上注册包内已认证 RPC 路由 `/sticky-notes`（前缀），并复用 client-connection 的 RPC 信封协议：

```
POST /sticky-notes/<endpoint>
body: {"type":"client-request","rpcId":"...","method":"<endpoint>","payload":{...}}
resp: {"type":"server-response","rpcId":"...","result":{"ok":true,"value":...}}
```

认证复用 `ctx.connection.requestRejection({ headers })`（Host/Origin 检查 + 浏览器 Cookie / API Peer），因此 Web GUI 与桌面外壳都可用，也不需要自己处理 CSRF。Host 侧不使用 `ctx.connection.rpc.handle`：当前 DSH 版本里它在 effect 上下文取不到 `webServer`。

Client 通过客户端连接服务调用（同一条已认证通道，Web GUI 与桌面 App 都可用）：

```js
// inject = ['slots', 'locale', 'connection']
const result = await ctx.connection.rpc.call('/sticky-notes', 'state', payload, signal)
// result: { ok: true, value: unknown } | { ok: false, error: { code: string, message: string } }
```

- `endpoint` 只能是单段（`[A-Za-z0-9_$.-]`）。
- Client 必须捕获 rejection（网络/通道失败）与 `ok:false` 两种失败。
- 连续调用需串行或带 AbortController；页面卸载后停止轮询。

## 3. 数据形状

### 3.1 Settings（面板设置抽屉编辑后整份回传）

```ts
interface Settings {
  vaultPath: string            // Obsidian 仓库根目录绝对路径；'' = 未配置
  notesDir: string             // 绝对路径；'' = 未配置
  projectDir: string           // 开档目录绝对路径；'' = 未配置
  archiveTargets: { id: string; label: string; path: string }[]  // path 绝对
  emojis: { id: string; emoji: string; label: string; prompt: string; callout: string }[]
  projectPrompt: string        // 开档结构化文档的提示词（可编辑）
}
```

- `callout` 取值：`note | abstract | info | todo | tip | success | question | warning | failure | danger | bug | example | quote`。
- Host 保存时会规范化：空串保留；路径不是绝对路径时相对 `vaultPath` 解析；emoji 去重 id；空 prompt 用默认值。
- 默认值见 `lib/settings.js` 的 `DEFAULT_SETTINGS`（含 4 枚默认 emoji 与默认建档提示词）。

### 3.2 NoteSummary（卡片直接用这个）

```ts
interface BrowseValue {
  path: string
  parent: string | null
  home: string
  crumbs: { name: string; path: string }[]
  entries: { name: string; path: string; isDirectory: boolean; hidden: boolean }[]
  truncated: boolean
  shortcuts: { label: string; path: string }[]   // 主目录 / 文稿 / Obsidian 配置里登记的库（含 iCloud）
  error?: string   // 列目录失败（如 macOS 拒绝 iCloud 容器父目录 EPERM）时给 UI 展示；此时 entries 为空但 shortcuts 仍可用
}

interface NoteSummary {
  path: string          // md 绝对路径（操作时回传）
  relPath: string       // 相对 vaultPath
  name: string          // 文件名去掉 .md
  title: string         // md 文件名（去掉 .md），Host 直接给
  darkColor: string     // 暗色模式卡片底色（同一 tag 同一色相）
  excerpt: string       // 正文摘要（含第一段；已去 meta、callout、markdown 记号；~360 字）
  tag: string | null    // 相对 notesDir 的第一层子文件夹名；顶层文件为 null
  color: string         // 卡片淡色底（见 3.5）
  comments: Comment[]   // 最多 6 条，按文中顺序
  commentCount: number
  created: number      // 文件创建时间（birthtime，默认排序依据：新 → 旧）
  mtime: number
  size: number
  pending: { emoji: string; label: string } | null   // 该便签有一个 AI 评论任务在跑
}

interface Comment {
  type: string          // callout 类型，未知时 'note'
  emoji: string         // 标题里识别出的 emoji；没有则 ''
  label: string         // 例如 '洞察'；没有则标题原文
  title: string         // callout 标题原文（可能含时间）
  time: string          // 识别出的 'YYYY-MM-DD HH:mm' 或 ''
  text: string          // callout 正文（多段用 \n；单条截断 500 字）
}
```

### 3.3 NoteFull（右侧抽屉查看/编辑用）

```ts
interface NoteFull extends NoteSummary {
  body: string          // 原始正文（不含 frontmatter，编辑模式直接编辑它）
  blocks: { kind: 'p' | 'h' | 'li' | 'quote' | 'code' | 'hr' | 'image'; text: string; checked?: boolean; sourceLine?: number; source?: string; alt?: string; wiki?: boolean }[]  // sourceLine 为去掉 frontmatter 后正文的零基行号；image 带 source/alt/wiki
  comments: Comment[]   // 全部评论（最多 30 条）
  projects: string | null  // frontmatter 里 PROJECTS 的值（原文）
}
```

### 3.4 Job

```ts
interface Job {
  id: string
  kind: 'comment' | 'project'
  path: string
  emojiId?: string
  status: 'running' | 'done' | 'error'
  error?: string
  startedAt: number
  finishedAt?: number
  projectPath?: string   // kind === 'project' 时：目标 md 的绝对路径
  link?: 'linked' | 'non-empty' | 'added' | 'updated' | 'created'  // 开档后源便签 PROJECTS 的处理结果
}
```

Host 只保留运行中的任务和最近 2 分钟内结束的任务；Client 用 `jobs` 变化驱动刷新。

### 3.5 卡片淡色（Host 分配，Client 不自己算）

按 `tag` 稳定分配（同一 tag 恒同色），无 tag 用纸白。Host 在 `NoteSummary.color` 里给十六进制色。

| 名字 | 浅色 card.color | 深色 card.darkColor |
|---|---|---|
| 纸白（无 tag） | `#FBF3DF` | `#2C2721` |
| 苔绿 | `#EEF3EA` | `#232B24` |
| 杏 | `#F6EDE7` | `#2E2622` |
| 雾蓝 | `#EBF1F7` | `#222A33` |
| 藕荷 | `#F4EDF4` | `#2A242C` |
| 米 | `#F3F0E4` | `#2B2822` |
| 胭脂 | `#F7EDEE` | `#2E2426` |
| 青瓷 | `#EDF3F0` | `#222C29` |

浅色模式墨色：标题 `#2b2620`、正文 `#57514a`、评论 `#6b645c`、弱化 `#8a8177`。
暗色模式（`body[data-ds-dark-theme]`）墨色：标题 `#EDE6D8`、正文 `#D2C9BA`、评论 `#B6AC9D`、弱化 `#8F8779`；卡片用 `darkColor`，卡内白底小块（tag/mini 按钮）改为 `rgba(255,255,255,.07~.14)`。

## 4. RPC endpoints

所有 payload 为 JSON；返回统一为 `{ ok: true, value } | { ok: false, error: { code, message } }`。

| endpoint | payload | value | 说明 |
|---|---|---|---|
| `state` | `{ knownRevision?: string \| null }` | 见下 | 主轮询入口 |
| `note` | `{ path: string }` | `NoteFull` | 打开右侧抽屉只读视图 / 编辑前取全文 |
| `saveNote` | `{ path: string, body: string, name?: string }` | `{ note: NoteSummary }` | 同时保存正文与文件名，拒绝同名覆盖 |
| `renameNote` | `{ path: string, name: string }` | `{ note: NoteSummary }` 或不变时 `{ path, name }` | 保留的独立 Host 改名接口，编辑器统一走 saveNote |
| `toggleTask` | `{ path: string, sourceLine: number, checked: boolean, expectedBody: string }` | `{ note: NoteSummary }` | 只修改任务标记；内容已变化返回 conflict；不允许修改代码块 |
| `readImage` | `{ path: string, source: string, wiki?: boolean }` | `{ dataUrl: string }` | 读取仓库内不超过 8 MB 的图片；校验真实路径；wiki 裸附件名歧义时拒绝 |
| `comment` | `{ path: string, emojiId: string }` | `{ jobId: string }` | 启动 AI 评论任务，立即返回 |
| `archive` | `{ path: string, targetId: string }` | `{ undoToken: string, to: string, targetId: string }` | 移动到归档目录 |
| `undoArchive` | `{ undoToken: string }` | `{ restoredTo: string }` | 撤销归档 |
| `openProject` | `{ path: string, name: string }` | `{ jobId: string, projectPath: string }` | 建目录 + 生成项目 md（异步） |
| `saveSettings` | `{ settings: Settings }` | `{ settings: Settings }` | 规范化后落盘并重扫 |
| `pickDirectory` | `{ initial?: string }` | `{ path: string \| null }` | 系统目录选择器（桌面原生，可能选不到 iCloud，作为兜底） |
| `browseDirectory` | `{ path?: string }` | `BrowseValue` | 应用内目录浏览能力（Host 保留；当前设置 UI 使用系统选择器） |
| `rescan` | `{}` | `{ revision: string }` | 手动刷新 |

`state` 的 value：

```ts
interface StateValue {
  configured: boolean       // vaultPath 与 notesDir 都已配置且 notesDir 存在
  revision: string          // 便签集合指纹；变化时 notes 才会下发
  unchanged?: true          // 传入的 knownRevision 与当前一致：本次不含 notes
  notes: NoteSummary[]
  jobs: Job[]
  settings: Settings
  error?: string            // 例如 notesDir 不存在、没有权限
}
```

- Client 每次带上次的 `revision`；`unchanged` 时只合并 `jobs`/`settings`。
- 任何写操作（saveNote/comment/archive/openProject/saveSettings）之后 Client 主动 `state` 一次；`revision` 变了就整份替换 notes。

### 4.1 错误码

`not-configured` `bad-request` `not-found` `fs-failed` `exists` `llm-unavailable` `llm-failed` `picker-unavailable` `busy`

## 5. 行为规则（Host 已实现，Client 只展示）

- **默认排序**：按文件创建时间降序（新 → 旧），前端可切换排序。
- **保存正文**：只替换 frontmatter 之后的正文（原子写盘），frontmatter 原样保留；Obsidian 会看到外部修改。
- **AI 评论**：点击后异步生成；追加在文件末尾，形如：

  ```
  > [!quote] 🔍 洞察 · 2026-11-03 22:10
  > 评论正文
  ```

- **归档**：移动文件到目标目录；同名冲突自动加 ` (2)`；返回可撤销 token（Client 展示 6 秒撤销条；token 服务端保留 10 分钟）。
- **开档**：`<projectDir>/<项目名>/<项目名>.md`；生成结构化文档；源便签 frontmatter 的 `PROJECTS` 为空时写回项目 wikilink（已有值不覆盖，value 里会有说明）。
- **标题 = md 文件名**（去掉 `.md`）：卡片和阅读视图都用文件名，不再取第一段；第一段属于正文。
- **不渲染 meta**：frontmatter 不进卡片内容。
- **文件监听**：Client 轮询 `state`（默认 4 秒，页面隐藏时暂停）；Obsidian 编辑会在数秒内反映。

## 6. Client 半技术要求

### 6.1 格式

```js
window.__ModuleLoader__.load({
  id: 'dsh-sticky-notes',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')   // 需要 portal 时才用
    const h = React.createElement
    // ...
    return { inject: ['slots', 'locale', 'connection'], apply, __test? }
  },
})
```

- 只允许 `require('react')` / `require('react-dom')`。**不要** require `@deepseek-ai/*` 包（ui-primitives 也不行）。
- 不用 JSX（手写 `h(...)`），不用 TypeScript。
- 不读写别人的 DOM；不向 `document.body` 挂节点（自己的浮层都挂在面板容器内）。
- 样式用 `ctx.effect` 注入一个 `<style data-plugin="sticky-notes">`，卸载时移除。

### 6.2 注册

```js
function apply(ctx) {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'sticky-notes: dictionaries')
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: 'sticky-notes', order: 3, label: () => t('nav.label') },
    PanelIcon,
  ))
  ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: 'sticky-notes' },
    StickyNotesPanel,
  ))
}
```

- `PanelIcon` 只画 icon：`function PanelIcon({ size, active })`，SVG 尺寸用 `size`，`aria-hidden`。不要绑点击（侧栏外壳负责按钮与选中）。
- 主面板组件 `StickyNotesPanel` 自己负责取数据、轮询、全部交互。
- 提交输入框回车时 `preventDefault` + `stopPropagation`（避免触发宿主快捷键）。

### 6.3 主题与字体

- 面板背景/边框/主文字用 token：`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-border-l1`、`--dsw-alias-label-primary/secondary`、`--dsw-alias-brand-primary`、`--dsw-alias-state-error-primary`。不要写死面板色。
- 卡片颜色用 `NoteSummary.color`（淡色纸），卡上文字用固定墨色（见 3.5），浅色卡片在深浅主题下都好看。
- 字体：
  - 标题：`"Songti SC", "STSong", "Noto Serif SC", "SimSun", serif`
  - 正文/控件：`"PingFang SC", "Heiti SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`
- 尺寸对比要明显：标题 19–21px / 600；正文 12.5–13px / 400、行高 1.55–1.65；评论 11.5–12px；tag 10.5px、字距 .04em。
- 整体简约、留白足；圆角 10–12px；卡片阴影很轻（`0 1px 2px rgba(0,0,0,.04)`）。

## 7. UX 规格

### 7.1 布局

- 整面板：纵向 flex，`height: 100%`，`min-height: 0`；**没有底部输入栏**，便签墙占满剩余高度。
- 顶栏（约 56px）：左侧「进行时」宋体 18px + 计数（`123 张便签` 次要色）；右侧：排序按钮（点击弹排序菜单）、刷新按钮、设置齿轮。可加一行极小的当前目录路径（省略号截断）。
- 中间：可滚动便签墙。`display:grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 14px; padding: 18px 22px 28px`。卡片统一高度约 208px，内容超出裁切。
- 默认排序 = 文件创建时间降序（新 → 旧）；排序依据 host 下发的 `note.created`，前端可切换。

### 7.2 卡片

- 结构（从上到下）：tag（浮在标题右上）→ 标题（宋体，clamp 3 行）→ 正文摘要（黑体，clamp 3 行，次要墨色）→ 评论条（最多 2 条）→ hover 操作行（绝对定位底部，渐变底，不挤压内容）。
- 操作行按钮：每枚 emoji（`🔍 洞察`）→ `comment`；`归档` → 目标目录菜单；`开档` → 开档对话框。
- 卡片有 `pending` 时：操作行位置显示 `✍️ 正在写评论…`。
- **单击卡片打开右侧抽屉**（没有选中态、没有输入栏）；键盘 Enter 也可打开。
- 空状态 / 未配置 / 出错：面板中央说明 + 主按钮（去设置 / 重试）。
- 加载中：首次 fetch 显示骨架。

### 7.3 右侧抽屉（查看 / 编辑）

- 从面板右侧推出，宽度约面板 1/3（`width: 34%; min-width: 340px; max-width: 620px`），占满面板高度，左侧卡片区仍可见、不加遮罩。滑入动画 160–200ms。
- **可拖宽**：默认 `width: 34%`（`min-width: 340px; max-width: 620px` 起步），抽屉左边缘 8px 拖拽把手（`cursor: col-resize`），拖动范围 `[320px, min(960px, 面板宽 × 0.8)]`；宽度写入 `localStorage['dsh-sticky-notes.drawerWidth']`，双击把手恢复 34%。
- **查看态**：顶部标题（文件名）+ tag + 关闭按钮；正文区渲染 `blocks`（段落/标题/列表/引用/代码；任务项渲染复选框）+ 评论 callout + PROJECTS；可滚动。
- **双击正文区进入编辑态**（双击按钮/空白边缘不算）：正文变成 textarea，显示 `note.body` 原始 Markdown（不渲染），工具栏出现 `保存` / `取消`；`Cmd/Ctrl+S` 保存，`Esc`/取消退出编辑态（丢弃未保存修改，若有修改 toast「已取消编辑」）。
- **保存**：`saveNote { path, body, name }`；成功后同步抽屉路径、退出编辑态，再取 `note` 并刷新 state；失败保留草稿并 toast `error.message`。
- **焦点规则**：
  - 抽屉查看态：单击同一张卡片或空白墙 → 关闭；“失去焦点返回”。单击另一张卡片 → 切换内容。
  - 卡片 hover 操作行在抽屉打开时不可用（不弹菜单/不响应点击）。
  - 抽屉编辑态：在左侧便签墙按下鼠标 → 只退出编辑态（丢弃未保存修改），抽屉保持打开。
  - 点击抽屉内部不关闭；关闭按钮 / `Esc`（查看态）关闭。
- 切换卡片：抽屉打开时双击另一张卡片可直接切换内容（可选，不强制）。

### 7.3.1 排序菜单

- 顶栏排序按钮（自绘 icon，`aria-label`），点击弹出小菜单（绝对定位在按钮下方，点击外部关闭）：
  - `文件创建时间 · 新→旧`（默认，排第一）
  - `文件创建时间 · 旧→新`
  - `最近修改 · 新→旧`
  - `文件名 · A→Z`
- 当前选项打勾；选择后立即重排并记住（`localStorage` 键 `dsh-sticky-notes.sort.v2`，读不到时用默认）。

### 7.4 设置抽屉

- 从右侧滑入/覆盖面板的抽屉，宽 380–440px，带半透明遮罩；Esc/点遮罩取消（有未保存改动时可不拦，简单点）。
- 字段：
  1. 仓库根目录：文本框 + `选择…`（系统目录选择器 `pickDirectory`，macOS 原生对话框可直接选 iCloud）
  2. 便签目录：同上；旁边显示解析后的绝对路径提示
  3. 开档目录：同上
  4. 归档目录：列表（label + path），每行可删除；`添加归档目录` 同样走系统选择器，选完自动用 basename 作为 label
  5. 手动输入框始终可编辑（支持 `~` 展开）；系统选择器取消返回 null 时什么都不改。
  5. Emoji 与提示词：每行 `emoji 输入` + `名称输入` + `callout 下拉` + `提示词 textarea` + 删除；底部 `添加 emoji`
  6. 建档提示词：多行 textarea（默认值来自 Host，可改）
  7. 底部：`保存`（主按钮）/ `取消`
- `保存` → `saveSettings`；成功 toast「设置已保存」；`configured` 变化后重新取 state。
- 保存前做轻量校验：仓库/便签目录为空时允许保存但提示「尚未配置，面板不可用」；emoji 至少保留 1 枚，否则阻止保存。
- 目录选择走 `pickDirectory`；用户取消（path null）什么都不做。

### 7.5 Toast / 撤销

- 面板顶部居中浮出小条（绝对定位，不挡操作），多个时叠放，4–6 秒自动消失。
- 归档成功：`已归档到「设计」  [撤销]`，撤销按钮调 `undoArchive`，成功后 toast「已恢复」。
- 错误 toast 用 `state-error-primary` 左边条，文案直接来自 `error.message`。

### 7.6 无障碍 & 细节

- 按钮用 `<button type="button">`；图标按钮有 `aria-label`。
- 卡片可键盘聚焦（`tabIndex=0`），Enter 选中。
- 不要拦截全局快捷键（Esc 仅在右侧抽屉/设置抽屉/菜单打开时处理）。
- 文本禁止选中拖拽问题：卡片正文 `user-select: text` 便于复制。

## 8. 文件所有权

| 文件 | 所有者 |
|---|---|
| `lib/client.js` | client-ui（唯一写入者） |
| `test/*` | verifier（唯一写入者） |
| `lib/index.js`、`lib/notes.js`、`lib/settings.js`、`lib/scan.js`、`lib/ai.js`、`lib/shared.js` | Lead |
| `package.json`、`cordis.patch.yml`、`locale/*`、`icon.svg`、`README.md` | Lead |

任何需要改契约的请发消息给 Lead，由 Lead 改契约后再动代码。

## 9. 验收清单（Client）

- [ ] 侧栏出现便签图标，点击切到面板，选中态正确
- [ ] 便签墙渲染 title/excerpt/comments/tag/color，meta 不出现
- [ ] 双击卡片从右侧推出约 1/3 抽屉，点左侧卡片区关闭；编辑态点左侧只退出编辑
- [ ] 抽屉内双击正文进入编辑，原始 Markdown textarea；保存只替换正文、frontmatter 不动
- [ ] 排序按钮与菜单（默认创建时间新→旧），刷新后记住
- [ ] 设置里目录字段走系统选择器，能直接选 iCloud 里的 Obsidian 库（也可手动输入 `~` 路径）
- [ ] emoji 评论：pending 态 → callout 出现在卡片与 md
- [ ] 归档 → toast + 撤销 → 文件移动/恢复
- [ ] 开档 → 对话框 → 进度 → 生成 md 与 PROJECTS 链接（Host 侧完成，Client 展示结果）
- [ ] 设置抽屉：目录点选、emoji 增删改、保存后即时生效
- [ ] 未配置/空目录/错误 三种空态
- [ ] 深浅主题下都可读；字体对比明确；无 console 报错
