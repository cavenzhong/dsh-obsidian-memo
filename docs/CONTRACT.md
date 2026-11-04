# dsh-sticky-notes · 实现契约（Host ↔ Client）

> 这是并行开发的唯一接口真相。0.12 起 Host 端 `lib/notes.js`、`lib/settings.js`、`lib/scan.js`、`lib/ai.js`、`lib/index.js` 与 `lib/shared.js` 由 Lead / host-core 实现；`lib/client.js` 由 client-ui 实现；`test/` 由 verifier 实现。任何一方需要改契约，先在共享任务/消息里说，不要单方面改。

## 0. 一句话

Obsidian 的「进行时」文件夹 → DSH 左侧栏一个便签图标 → 中央全宽便签墙。只读写 md 文件本身，不碰 Obsidian。

**当前版本：0.12.0**。0.12 的目标是「更轻的日间视觉 + 更实用的阅读/编辑 + 更有性格的 AI 评论」，具体 UX 见 §7。

## 1. 包结构与运行方式

- 包目录：`/Users/cavenzhong/Documents/个人项目/memobisidian/dsh-sticky-notes`
- 包名：`dsh-sticky-notes`，ESM，零运行时依赖，`package.json` 版本 `0.12.0`。
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
  includeSubfolders: boolean   // 0.12 新增：是否扫描便签目录的子文件夹；缺省/非 false 一律 true
}
```

- `callout` 取值：`note | abstract | info | todo | tip | success | question | warning | failure | danger | bug | example | quote`。
- Host 保存时会规范化：空串保留；路径不是绝对路径时相对 `vaultPath` 解析；emoji 去重 id；空 prompt 用默认值。
- 默认值见 `lib/settings.js` 的 `DEFAULT_SETTINGS`（含 4 枚默认 emoji 与默认建档提示词）。
- **预设迁移（0.12）**：`readSettingsFile` 读到旧版（0.11 及更早）默认预设、且与 `LEGACY_EMOJIS` 逐字段完全一致时，整组替换为 0.12 的四个预设（😈 毒舌 / ✨ 另一面 / 🧭 落地 / 😇 真心话）。用户改过任何一项就原样保留。迁移只在读盘时发生在内存里，下次 `saveSettings` 落盘。

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
  images: { source: string; alt: string; wiki: boolean }[]  // 0.12：正文图片前 3 张（不含评论 callout 里的图）
  imageCount: number   // 0.12：正文图片总数；> images.length 时卡片显示「＋N」
  commentKinds: string[] // 0.12：全部评论里出现过的 emoji 去重（按出现顺序），用于"同类评论"判断
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

0.12 把日间纸色整体往白里调两档（用户反馈"卡片颜色更偏白、更淡一些"）：

| 名字 | 浅色 card.color | 深色 card.darkColor |
|---|---|---|
| 纸白（无 tag） | `#FDFAF4` | `#2C2721` |
| 苔绿 | `#F5F9F4` | `#232B24` |
| 杏 | `#FDF7F3` | `#2E2622` |
| 雾蓝 | `#F4F8FC` | `#222A33` |
| 藕荷 | `#FAF5FA` | `#2A242C` |
| 米 | `#FAF8F2` | `#2B2822` |
| 胭脂 | `#FDF5F6` | `#2E2426` |
| 青瓷 | `#F5F9F7` | `#222C29` |

浅色模式墨色（0.12：正文墨色统一压到 80% 不透明度，标题 100%）：
标题 `#2b2620`、正文 `rgba(87,81,74,.8)`、评论 `rgba(107,100,92,.78)`、弱化 `rgba(138,129,119,.72)`。
暗色模式（`body[data-ds-dark-theme]`）墨色：标题 `#EDE6D8`、正文 `rgba(210,201,186,.8)`、评论 `rgba(182,172,157,.78)`、弱化 `rgba(143,135,121,.72)`；卡片用 `darkColor`，卡内白底小块（tag/mini 按钮）改为 `rgba(255,255,255,.07~.14)`。
阅读抽屉（不在卡片上）正文文字同样压到 80%：用 `color-mix(in srgb, var(--dsw-alias-label-primary) 80%, transparent)`，并在前面写一条普通 `color` 作为不支持时的回退。

## 4. RPC endpoints

所有 payload 为 JSON；返回统一为 `{ ok: true, value } | { ok: false, error: { code, message } }`。

| endpoint | payload | value | 说明 |
|---|---|---|---|
| `state` | `{ knownRevision?: string \| null }` | 见下 | 主轮询入口 |
| `note` | `{ path: string }` | `NoteFull` | 打开右侧抽屉只读视图 / 编辑前取全文 |
| `saveNote` | `{ path: string, body: string, name?: string }` | `{ note: NoteSummary }` | 同时保存正文与文件名，拒绝同名覆盖 |
| `renameNote` | `{ path: string, name: string }` | `{ note: NoteSummary }` 或不变时 `{ path, name }` | 保留的独立 Host 改名接口，编辑器统一走 saveNote |
| `toggleTask` | `{ path: string, sourceLine: number, checked: boolean, expectedBody: string }` | `{ note: NoteSummary }` | 只修改任务标记；内容已变化返回 conflict；不允许修改代码块 |
| `readImage` | `{ path: string, source: string, wiki?: boolean, maxBytes?: number }` | `{ dataUrl: string }` | 读取仓库内图片；默认上限 8 MB，传 `maxBytes` 时以它为准；**超过上限统一报 `too-large`**（卡片缩略图用 `LIMITS.cardImageMaxBytes` 避免把大图塞进卡片）；校验真实路径；wiki 裸附件名歧义时拒绝。附件名查找结果会缓存（以真实路径复核），避免卡片缩略图反复全库遍历 |
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

`not-configured` `bad-request` `not-found` `fs-failed` `exists` `too-large` `llm-unavailable` `llm-failed` `picker-unavailable` `busy`

## 5. 行为规则（Host 已实现，Client 只展示）

- **默认排序**：按文件创建时间降序（新 → 旧），前端可切换排序。
- **保存正文**：只替换 frontmatter 之后的正文（原子写盘），frontmatter 原样保留；Obsidian 会看到外部修改。
- **AI 评论**：点击后异步生成；追加在文件末尾，形如：

  ```
  > [!quote] 🔍 洞察 · 2026-11-03 22:10
  > 评论正文
  ```

  0.12：Host 在 `NoteSummary.commentKinds` 里给出已有评论的 emoji 去重集合；Client 在生成同 emoji 评论前先弹确认（见 7.7）。
- **子文件夹**：`settings.includeSubfolders === false` 时只扫描便签目录顶层 md（不再递归，tag 全为 null）；true 时递归到 5 层（隐藏目录 / `.obsidian` / 符号链接照旧跳过）。设置变化写入 revision，触发整份 notes 刷新。
- **卡片图片**：Host 从正文块里抽出前 `LIMITS.cardImages`（3）张图片的来源给 `NoteSummary.images`，并给总数量 `imageCount`；只读正文，不读评论 callout 内的图片。
- **归档**：移动文件到目标目录；同名冲突自动加 ` (2)`；返回可撤销 token（Client 展示 6 秒撤销条；token 服务端保留 10 分钟）。
- **开档**：`<projectDir>/<项目名>/<项目名>.md`；生成结构化文档；源便签 frontmatter 的 `PROJECTS` 为空时写回项目 wikilink（已有值不覆盖，value 里会有说明）。
- **标题 = md 文件名**（去掉 `.md`）：卡片和阅读视图都用文件名，不再取第一段；第一段属于正文。
- **保存时改名**：`saveNote` 带 `name` 时先写正文再改名；目标同名拒绝。0.12 起，仅大小写不同的改名（macOS/Windows 大小写不敏感文件系统上 `fileExists` 会命中自己）如果 `realpath` 指向同一文件则允许，不再误报 `exists`。
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
- 0.12 新增的纯函数必须挂到 `module.exports.__test`，供 verifier 单测：`APP_VERSION`、`PINNED_KEY` / `readStoredPinned` / `storePinned`、`cardImages(note)`（返回 `{ items, more }`）、`drawerWidthBounds(panelWidth, pinned)`。

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
  - 标题（保持 0.11 的宋体加粗，0.12 曾试过猴尊宋体但效果不好已撤回）：`"Songti SC", "STSong", "Songti TC", "SimSun", "宋体", "Noto Serif CJK SC", "Noto Serif SC", serif`
  - 正文/控件：`"PingFang SC", "Heiti SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`
- 尺寸对比要明显：标题 19–21px / 600；正文 12.5–13px / 400、行高 1.55–1.65；评论 11.5–12px；tag 10.5px、字距 .04em。
- 0.12 正文透明度：卡片摘要与抽屉正文文字统一 80% 不透明度（见 3.5）；标题保持 100%。
- 0.12 署名：**只在面板顶栏大标题「Obsidian MEMO」之后**跟一枚小字 `by caven v0.12`（约 11px、非常淡、透明度约 45%、baseline 对齐、不换行）；**卡片与抽屉标题不再带 byline**。版本号由 Client 常量 `APP_VERSION = '0.12'` 提供，与 `package.json` 的 `0.12.0` 对齐。
- 整体简约、留白足；圆角 10–12px；卡片阴影很轻（`0 1px 2px rgba(0,0,0,.04)`）。

## 7. UX 规格

### 7.1 布局

- 整面板：纵向 flex，`height: 100%`，`min-height: 0`；**没有底部输入栏**，便签墙占满剩余高度。
- 顶栏（约 56px）：左侧「Obsidian MEMO」宋体 18px / 600 + 紧跟在后面的小字 `by caven v0.12`（约 11px、透明度 .45）+ 计数（`123 张便签` 次要色）；右侧从左到右：**子文件夹开关（0.12 新增）**、排序按钮（点击弹排序菜单）、刷新按钮、设置齿轮。可加一行极小的当前目录路径（省略号截断）。
- **子文件夹开关（0.12）**：自绘 folder-tree icon 的 30×30 icon 按钮，`aria-pressed` 反映 `settings.includeSubfolders`，开启时用品牌色/淡底标识。点击 → 乐观更新本地 settings → `saveSettings`（整份 settings 回传）→ 成功后 `refreshNow(true)`；失败回滚并 toast。tooltip：`显示子文件夹` / `仅显示顶层`。
- 中间：可滚动便签墙。`display:grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 14px; padding: 18px 22px 28px`。卡片统一高度 208px，内容超出裁切。**0.12 明确：卡片有图片时也不加高。**
- 默认排序 = 文件创建时间降序（新 → 旧）；排序依据 host 下发的 `note.created`，前端可切换。

### 7.2 卡片（0.12 版）

- 结构（从上到下）：tag（浮在标题右上）→ 标题（宋体加粗，clamp 3 行，**无 byline**）→ 正文摘要（黑体，clamp 3 行；**有图时 clamp 1 行**）→ 评论条（最多 2 条；有图时最多 1 条且不显示「＋N」）→ **图片条（贴卡片底部、靠左对齐）** → hover 操作区（绝对定位底部，渐变底，不挤压内容）。有图时卡片内边距/间距略收紧（`padding:12px 15px; gap:4px`），保证 208px 内不溢出。
- **图片条（0.12 修正）**：`note.images` 前 3 张正方形缩略图（52×52、圆角 7px、间隙 6px、`object-fit:cover`），**在 DOM 中排在评论条之后，用 `margin-top:auto` 贴住卡片底部、`align-self:flex-start` 左对齐**；`imageCount > 3` 时末尾追加一枚淡色 `＋N`（N = `imageCount - 3`），只占一小段文字、不占图片位。
  - 懒加载：卡片接近视口（IntersectionObserver，root 为便签墙，提前约 200px）才请求 `readImage { path, source, wiki, maxBytes: 1500000 }`；失败/超限/非图渲染同色系淡占位，不出错误文案、不打断卡片。
  - 网络图片（http/https）直接 `<img src>`；本地图片用返回的 dataUrl。缩略图在模块内缓存（key = `path\0source`，LRU 上限 160 条，面板卸载清空），切走再回来不重复请求。
  - **有图时标题不压缩**：只吃掉摘要/评论的行数，卡片高度保持 208px。
- **hover 操作区（0.12 修正版）**：hover / focus-within 时浮出：
  1. 一行：**所有 AI emoji 预设平铺**（`settings.emojis` 每枚一个 27×27 方形 icon 按钮，只画 emoji 字形，`flex-wrap` 支持最多 12 枚）。**鼠标悬停（或键盘 focus）某一枚时，在该按钮上方浮出一枚小标签显示该预设的 `label`**（如「毒舌」「另一面」「落地」「真心话」）——不是折叠菜单、不需要点击展开。点击某枚 = 对该便签发 `comment`（同 emoji 已有评论时先确认，见 7.7）。
  2. **分割线**。
  3. 一行：`归档`（弹现有归档目标菜单）/ `开档`（现有对话框）。
  - **同色渐变蒙版**：emoji 行被悬停 / 键盘 focus，或归档目标菜单打开时，卡片内容之上覆盖一层 `.SN_cardScrim`（`background: linear-gradient(to top, var(--sn-card-bg) 52%, transparent)`，位于操作区之下、内容之上），让上方标签和按钮清楚可读。
  - 抽屉打开时整个操作区不出现（保持现有行为）。
- 卡片有 `pending` 时：操作区位置显示 `✍️ 正在写评论…`。
- **单击卡片打开右侧抽屉**（没有选中态、没有输入栏）；键盘 Enter 也可打开。
- 空状态 / 未配置 / 出错：面板中央说明 + 主按钮（去设置 / 重试）。
- 加载中：首次 fetch 显示骨架。

### 7.3 右侧抽屉（查看 / 编辑）

- **overlay 态（未锁定）**：从面板右侧推出，宽度约面板 1/3（`width: 34%; min-width: 340px; max-width: 620px`），占满面板高度，左侧卡片区仍可见、不加遮罩。滑入动画 160–200ms。
- **可拖宽**：默认 `width: 34%`，抽屉左边缘 8px 拖拽把手（`cursor: col-resize`），未锁定范围 `[320px, min(960px, 面板宽 × 0.8)]`；宽度写入 `localStorage['dsh-sticky-notes.drawerWidth']`，双击把手恢复 34%。
- **锁定（0.12 新增）**：抽屉头部右上、关闭按钮左侧有锁定按钮（锁/解锁图标，`aria-pressed`）。
  - 未锁定 = 上述 overlay：覆盖在便签墙之上；点空白墙 / 同一张卡片关闭。
  - 锁定 = **内联双栏**：`.SN_body` 改为 `display:flex; flex-direction:row`，便签墙 `flex:1; min-width:0`，抽屉作为普通 flex 子项（无阴影、无绝对定位），左右并排、互不遮挡；抽屉打开/切换卡片时保持锁定。
  - 状态持久化 `localStorage['dsh-sticky-notes.panelLocked'] = '1'`（默认 '0'）。锁定态点空白墙 / 同一张卡片**不关闭**，只切换内容；关闭按钮 / `Esc` 仍关闭；编辑态在墙上按下仍只退出编辑。
  - 拖宽两种模式都可用；锁定态上限 = `max(320, min(960, 面板宽 - 260))`（给墙留至少 260px）；双击把手恢复默认宽度。
- **查看态**：顶部标题（**双击标题进入编辑态**；标题不带到 byline）+ tag + 锁定 / 关闭按钮；正文区渲染 `blocks`（段落/标题/列表/引用/代码；任务项渲染复选框）+ PROJECTS；**评论固定在底部独立区域**（见下条）。
- **评论固定区（0.12）**：阅读态抽屉结构 = head / body（自己的滚动）/ comments（固定底部、`flex:none`、`max-height:42%`、`min-height:96px`、自身滚动、上边框）。正文滚动不影响评论区；评论多时只在评论区内滚。零评论时显示一行「暂无评论」占位（高度小）。**编辑态隐藏评论区**。
- **双击正文区进入编辑态**（双击按钮/空白边缘不算）：正文变成 textarea，显示 `note.body` 原始 Markdown（不渲染），工具栏出现 `保存` / `取消`；`Cmd/Ctrl+S` 保存，`Esc`/取消退出编辑态（丢弃未保存修改，若有修改 toast「已取消编辑」）。
- **保存**：`saveNote { path, body, name }`；成功后同步抽屉路径、退出编辑态，再取 `note` 并刷新 state；失败保留草稿并 toast `error.message`。
- **焦点规则**：
  - 抽屉查看态（overlay）：单击同一张卡片或空白墙 → 关闭；单击另一张卡片 → 切换内容。锁定态见上（不关闭）。
  - 卡片 hover 操作行在抽屉打开时不可用（不弹菜单/不响应点击）。
  - 抽屉编辑态：在左侧便签墙按下鼠标 → 只退出编辑态（丢弃未保存修改），抽屉保持打开。
  - 点击抽屉内部不关闭；关闭按钮 / `Esc`（查看态）关闭。
- 切换卡片：抽屉打开时单击另一张卡片可直接切换内容。

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

- 按钮用 `<button type="button">`；图标按钮有 `aria-label`；开关类按钮用 `aria-pressed`。
- 卡片可键盘聚焦（`tabIndex=0`），Enter 选中。
- 不要拦截全局快捷键（Esc 仅在右侧抽屉/设置抽屉/菜单打开时处理）。
- 文本禁止选中拖拽问题：卡片正文 `user-select: text` 便于复制。

### 7.7 同类评论确认（0.12）

- 点击卡片上的某个预设生成评论前，若 `note.commentKinds` 已包含该预设的 `emoji`，先弹确认框（与开档对话框同风格）：
  - 标题：`已有同类评论`
  - 正文：`这张便签已经有一条「<预设名>」评论，要再生成一条吗？`
  - 按钮：`再生成一条`（主）/ `取消`（次）
- 确认后才发 `comment`；取消则什么都不做。确认框打开时 `Esc` 只关确认框。
- 自定义预设同样按 emoji 判断；`commentKinds` 缺失（旧 Host）时不做确认、直接生成。

## 8. 文件所有权

| 文件 | 所有者 |
|---|---|
| `lib/client.js` | client-ui（唯一写入者） |
| `test/*` | verifier（唯一写入者） |
| `lib/index.js`、`lib/notes.js`、`lib/settings.js`、`lib/scan.js`、`lib/ai.js` | host-core |
| `lib/shared.js` | Lead（0.12：色板 / 预设 / LIMITS 已由 Lead 先改好，host-core 只读） |
| `docs/CONTRACT.md`、`package.json`、`cordis.patch.yml`、`locale/*`、`icon.svg`、`README.md` | Lead |
| `package.json` 版本号 / byline 常量 | Lead |

任何需要改契约的请发消息给 Lead，由 Lead 改契约后再动代码。

## 9. 验收清单（Client）

- [ ] 侧栏出现便签图标，点击切到面板，选中态正确
- [ ] 顶栏「Obsidian MEMO」是宋体加粗，后面跟小字 by caven v0.12；卡片/抽屉标题没有 byline
- [ ] 便签墙渲染 title/excerpt/comments/tag/color，meta 不出现；日间卡片色很淡（#FDFAF4 系）
- [ ] 正文与卡片摘要是 80% 墨色
- [ ] 有图卡片：3 张方图贴卡片底部、左对齐（＋N 跟随）；标题不压缩、摘要/评论行数被压缩、卡片仍 208px
- [ ] 卡片 hover：所有 AI emoji 平铺一行，悬停某枚时上方浮出文字标题；分割线下是归档/开档；emoji 行 hover 时同色渐变蒙版
- [ ] 已有同类评论时点击 emoji → 弹「再生成一条？」确认；确认后才生成
- [ ] 单击卡片推出抽屉；点左侧卡片区关闭；编辑态点左侧只退出编辑
- [ ] 抽屉内双击标题或正文进入编辑，原始 Markdown textarea；保存只替换正文、frontmatter 不动
- [ ] 抽屉阅读态评论固定在下方面板内，正文滚动不影响评论
- [ ] 抽屉锁定 → 变成右侧内联双栏、不遮挡；解锁恢复 overlay；刷新后锁定状态记住
- [ ] 顶栏子文件夹 icon 切换：关闭后墙只剩顶层便签，刷新后状态记住
- [ ] 排序按钮与菜单（默认创建时间新→旧），刷新后记住
- [ ] 设置里目录字段走系统选择器，能直接选 iCloud 里的 Obsidian 库（也可手动输入 `~` 路径）
- [ ] emoji 评论：pending 态 → callout 出现在卡片与 md
- [ ] 归档 → toast + 撤销 → 文件移动/恢复
- [ ] 开档 → 对话框 → 进度 → 生成 md 与 PROJECTS 链接（Host 侧完成，Client 展示结果）
- [ ] 设置抽屉：目录点选、emoji 增删改、保存后即时生效
- [ ] 未配置/空目录/错误 三种空态
- [ ] 深浅主题下都可读；字体对比明确；无 console 报错
