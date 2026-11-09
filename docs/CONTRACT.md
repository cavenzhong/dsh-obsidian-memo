# dsh-sticky-notes · 实现契约（Host ↔ Client）

> 本文记录 Host 与 Client 的接口及当前行为。结构收敛保留单文件浏览器发布与零运行时依赖；开档任务流程的调整暂不纳入本次范围。

## 0. 一句话

Obsidian 的「进行时」文件夹 → DSH 左侧栏一个便签图标 → 中央全宽便签墙。只读写 md 文件本身，不碰 Obsidian。

**运行版本以 `package.json` 为准**。0.13 的目标是「更轻的日间视觉 + 更实用的阅读/编辑 + 更有性格的 AI 评论」；0.13.4 追加日期筛选、锁定面板恢复、卡片菜单/图片的统一处理与版本号对齐；0.13.8 追加便签墙动态加载、在 Obsidian 打开、设置里 emoji/名称/callout 样式同排；0.13.9 把日期筛选改成开关、修正 Obsidian block id 隐藏、把锁定改图钉、打开按钮紫色高亮并允许换行、顶栏标题区可拖动桌面窗口，具体 UX 见 §7。

## 1. 包结构与运行方式

- 包目录：`/Users/cavenzhong/Documents/个人项目/memobisidian/dsh-sticky-notes`
- 包名：`dsh-sticky-notes`，ESM，零运行时依赖，`package.json` 为唯一运行时版本来源。
- Host 半：`lib/index.js`（Cordis 插件，`export function apply(ctx, config)`）；`lib/files.js`（真实路径校验、内容版本、原子写入）；`lib/obsidian.js`（在 Obsidian 打开：URI 构造 + 系统打开器）。
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
interface AiBudget {
  preset: 'low' | 'medium' | 'high' | 'custom'  // 低 / 中 / 高 / 自定义
  reasoningEffort: 'off' | 'low' | 'high' | 'max' // 非自定义档由预设决定
  maxTokens: number            // 256..65536；DeepSeek 的 max_tokens 含思考 token
}

interface Settings {
  vaultPath: string            // Obsidian 仓库根目录绝对路径；'' = 未配置
  notesDir: string             // 绝对路径；'' = 未配置
  projectDir: string           // 开档目录绝对路径；'' = 未配置
  archiveTargets: { id: string; label: string; path: string }[]  // path 绝对
  emojis: { id: string; emoji: string; label: string; prompt: string; callout: string; ai: AiBudget }[]
  projectPrompt: string        // 开档结构化文档的提示词（可编辑）
  projectAi: AiBudget          // 0.13 新增：开档生成项目文档的 token 预算
  includeSubfolders: boolean   // 0.13 新增：是否扫描便签目录的子文件夹；缺省/非 false 一律 true
}
```

- **AI 预算（0.13）**：每枚评论 emoji 各一份 `ai`，开档另有全局 `projectAi`。三档预设固定映射：`low = off / 2048`、`medium = low / 4096`、`high = high / 8192`（默认档 = `high`，即「一直用 high」）。`preset !== 'custom'` 时 Host 与 Client 都以预设数值为准；`custom` 才使用自定义的 `reasoningEffort` + `maxTokens`（`maxTokens` 夹到 256..65536 并取整，effort 非法回退 `high`）。旧 settings.json 没有这些字段时补默认 `high`。
- `callout` 取值：`note | abstract | info | todo | tip | success | question | warning | failure | danger | bug | example | quote`。
- Host 保存时会规范化：空串保留；路径不是绝对路径时相对 `vaultPath` 解析；emoji 去重 id；空 prompt 用默认值。
- 默认值见 `lib/settings.js` 的 `DEFAULT_SETTINGS`（含 4 枚默认 emoji 与默认建档提示词）。
- **预设迁移（0.13）**：`readSettingsFile` 读到旧版（0.11 及更早）默认预设、且与 `LEGACY_EMOJIS` 逐字段完全一致时，整组替换为 0.13 的四个预设（😈 毒舌 / ✨ 另一面 / 🧭 落地 / 😇 真心话）。用户改过任何一项就原样保留。迁移只在读盘时发生在内存里，下次 `saveSettings` 落盘。

### 3.2 NoteSummary（卡片直接用这个）

```ts
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
  images: { source: string; alt: string; wiki: boolean }[]  // 0.13：正文图片前 3 张（不含评论 callout 里的图）
  imageCount: number   // 0.13：正文图片总数；> images.length 时卡片显示「＋N」
  commentKinds: string[] // 0.13：全部评论里出现过的 emoji 去重（按出现顺序），用于"同类评论"判断
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
  contentRevision: string // 原文件内容 SHA-256，保存时作为 expectedRevision 回传
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
  errorCode?: string     // 0.13：失败错误码（如 'llm-token-budget'），Client 据此给可操作提示
  truncated?: true       // 0.13：撞上 token 上限但仍有正文（评论/文档已写入，可能被截断）
  startedAt: number
  finishedAt?: number
  projectPath?: string   // kind === 'project' 时：目标 md 的绝对路径
  link?: 'linked' | 'non-empty' | 'added' | 'updated' | 'created'  // 开档后源便签 PROJECTS 的处理结果
}
```

Host 只保留运行中的任务和最近 2 分钟内结束的任务；Client 用 `jobs` 变化驱动刷新。

### 3.5 卡片淡色（Host 分配，Client 不自己算）

按 `tag` 稳定分配（同一 tag 恒同色），无 tag 用纸白。Host 在 `NoteSummary.color` 里给十六进制色。

0.13 把日间纸色整体往白里调两档（用户反馈"卡片颜色更偏白、更淡一些"）：

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

浅色模式墨色（0.13：正文墨色统一压到 80% 不透明度，标题 100%）：
标题 `#2b2620`、正文 `rgba(87,81,74,.8)`、评论 `rgba(107,100,92,.78)`、弱化 `rgba(138,129,119,.72)`。
暗色模式（`body[data-ds-dark-theme]`）墨色：标题 `#EDE6D8`、正文 `rgba(210,201,186,.8)`、评论 `rgba(182,172,157,.78)`、弱化 `rgba(143,135,121,.72)`；卡片用 `darkColor`，卡内白底小块（tag/mini 按钮）改为 `rgba(255,255,255,.07~.14)`。
阅读抽屉（不在卡片上）正文文字同样压到 80%：用 `color-mix(in srgb, var(--dsw-alias-label-primary) 80%, transparent)`，并在前面写一条普通 `color` 作为不支持时的回退。

## 4. RPC endpoints

所有 payload 为 JSON；返回统一为 `{ ok: true, value } | { ok: false, error: { code, message } }`。

| endpoint | payload | value | 说明 |
|---|---|---|---|
| `state` | `{ knownRevision?: string \| null }` | 见下 | 主轮询入口 |
| `note` | `{ path: string }` | `NoteFull` | 打开右侧抽屉只读视图 / 编辑前取全文 |
| `saveNote` | `{ path: string, body: string, name?: string, expectedRevision: string }` | `{ note: NoteSummary }` | 同时保存正文与文件名；拒绝同名覆盖；缺少或不匹配编辑版本返回 conflict |
| `toggleTask` | `{ path: string, sourceLine: number, checked: boolean, expectedBody: string }` | `{ note: NoteSummary }` | 只修改任务标记；内容已变化返回 conflict；不允许修改代码块 |
| `readImage` | `{ path: string, source: string, wiki?: boolean, maxBytes?: number }` | `{ dataUrl: string }` | 读取仓库内图片；默认上限 8 MB，传 `maxBytes` 时以它为准；**超过上限统一报 `too-large`**（卡片缩略图用 `LIMITS.cardImageMaxBytes` 避免把大图塞进卡片）；校验真实路径；wiki 裸附件名歧义时拒绝。附件名查找结果会缓存（以真实路径复核），避免卡片缩略图反复全库遍历 |
| `comment` | `{ path: string, emojiId: string }` | `{ jobId: string }` | 启动 AI 评论任务，立即返回 |
| `archive` | `{ path: string, targetId: string }` | `{ undoToken: string, to: string, targetId: string }` | 移动到归档目录 |
| `undoArchive` | `{ undoToken: string }` | `{ restoredTo: string }` | 撤销归档 |
| `openProject` | `{ path: string, name: string }` | `{ jobId: string, projectPath: string }` | 建目录 + 生成项目 md（异步） |
| `openInObsidian` | `{ path: string }` | `{ url: string }` | **0.13.8**：用系统打开器打开 `obsidian://open?path=<绝对路径>`（macOS `open` / Windows `cmd start` / Linux `xdg-open`）；只允许仓库内已存在的文件；失败 `open-failed` |
| `saveSettings` | `{ settings: Settings }` | `{ settings: Settings }` | 规范化后落盘并重扫 |
| `pickDirectory` | `{ initial?: string }` | `{ path: string \| null }` | 系统目录选择器（桌面原生，可能选不到 iCloud，作为兜底） |
| `rescan` | `{}` | `{ revision: string }` | 手动刷新 |

`state` 的 value：

```ts
interface StateValue {
  configured: boolean       // vaultPath 与 notesDir 都已配置且 notesDir 存在
  revision: string          // 便签集合指纹；变化时 notes 才会下发
  version: string           // 0.13：插件实际版本（package.json 的 version；旧 Host 可不带）
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

`conflict` `not-configured` `bad-request` `not-found` `fs-failed` `exists` `too-large` `llm-unavailable` `llm-failed` `llm-token-budget` `picker-unavailable` `open-failed` `busy`

`llm-token-budget`（0.13）：模型撞上 `maxTokens` 上限、且思考把预算用光导致正文为空。Host 把它写进 `Job.errorCode`，Client 弹「去设置 · AI 预算」的可操作提示，而不是只显示含糊的失败文案。

`open-failed`（0.13.8）：系统打开器执行失败（没装 Obsidian、没有 `xdg-open`、命令超时等）。Client 用 error toast 展示 `error.message`，不写任何文件。

## 5. 行为规则（Host 已实现，Client 只展示）

- **默认排序**：按文件创建时间降序（新 → 旧），前端可切换排序。
- **保存正文**：在文件写入队列内检查 `expectedRevision` 是否匹配当前原文；不匹配返回 `conflict`，不写文件。仅替换正文并保留 frontmatter 内容；仍无跨进程文件锁。
- **AI 评论**：点击后异步生成；追加在文件末尾，形如：

  ```
  > [!quote] 🔍 洞察 · 2026-11-03 22:10
  > 评论正文
  ```

  0.13：Host 在 `NoteSummary.commentKinds` 里给出已有评论的 emoji 去重集合；Client 在生成同 emoji 评论前先弹确认（见 7.7）。
- **AI 预算（0.13）**：评论按该 emoji 的 `ai`、开档按 `projectAi` 传 `maxTokens` / `reasoningEffort`。DeepSeek 的 `max_tokens` 是总输出预算，思考 token 也算：撞上限且无正文 → `llm-token-budget`（Client 提示去调设置）；撞上限但有正文 → `Job.truncated = true`，内容照常写入，Client 用同一条 toast 引导调高预算。预算在设置抽屉里按「低 / 中 / 高 / 自定义」四档选，默认高（`high` / 8192）。
- **子文件夹**：`settings.includeSubfolders === false` 时只扫描便签目录顶层 md（不再递归，tag 全为 null）；true 时递归到 5 层（隐藏目录 / `.obsidian` / 符号链接照旧跳过）。设置变化写入 revision，触发整份 notes 刷新。
- **卡片图片**：Host 从正文块里抽出前 `LIMITS.cardImages`（3）张图片的来源给 `NoteSummary.images`，并给总数量 `imageCount`；只读正文，不读评论 callout 内的图片。
- **归档**：移动文件到目标目录；同名冲突自动加 ` (2)`；返回可撤销 token（Client 展示 6 秒撤销条；token 服务端保留 10 分钟）。
- **在 Obsidian 打开（0.13.8）**：校验 `path` 在仓库内且是已存在的文件后，构造 `obsidian://open?path=<encodeURIComponent(绝对路径)>`，用 argv 形式调系统打开器（darwin `open` / win32 `cmd /c start "" <url>` / 其他 `xdg-open`；5s 超时）；成功返回 `{ url }`，失败 `open-failed`。不写任何文件。
- **开档**：`<projectDir>/<项目名>/<项目名>.md`；生成结构化文档；源便签 frontmatter 的 `PROJECTS` 为空时写回项目 wikilink（已有值不覆盖，value 里会有说明）。
- **标题 = md 文件名**（去掉 `.md`）：卡片和阅读视图都用文件名，不再取第一段；第一段属于正文。
- **保存时改名**：`saveNote` 带 `name` 时先写正文再改名；目标同名拒绝。0.13 起，仅大小写不同的改名（macOS/Windows 大小写不敏感文件系统上 `fileExists` 会命中自己）如果 `realpath` 指向同一文件则允许，不再误报 `exists`。
- **不渲染 meta**：frontmatter 不进卡片内容。
- **Obsidian block id（0.13.9）**：`^qa-daily-preview-1e5t8lm` 这类 block id 只出现在**行尾**，由 `lib/notes.js` 的 `stripBlockIds()` / `stripInline()` 去掉：先在原始行上按「行尾锚点」删除，再把段落拼成一行，因此**只删锚点本身、保留锚点后面的文字**（下一行内容不受影响）；同时不会误删行中/行内代码里的 `^`（行中的上标 `x ^2`、行内代码 `` `^abc` `` 原样保留）。0.13.8 之前只匹配字符串末尾，段落拼接后中间的 block id 会漏出来。
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
- `__test` 导出被测试的纯函数、组件和上述三个 hooks。优先验证请求顺序、草稿保留、保存和切换行为，不绑定内部函数的源码布局。独立浏览器运行所需的少量 AI 预设常量继续由漂移测试校验。

### 6.2 内部职责

Client 仍发布为一个文件，不引入构建工具或状态管理库：

- `useNotesData`：唯一的 state 请求协调器、响应代次、轮询、取消与错误处理；乐观写入也会使旧请求失效。
- `useNoteEditor`：抽屉读取、编辑草稿、内容版本与保存。切换或重开抽屉后的旧请求不能影响新草稿。
- `useSettingsDraft`：设置草稿、选择目录和保存；实时设置刷新不覆盖草稿。
- 面板本身管理筛选、布局、菜单与操作入口。

### 6.3 注册

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
  - 标题（保持 0.11 的宋体加粗，0.13 曾试过猴尊宋体但效果不好已撤回）：`"Songti SC", "STSong", "Songti TC", "SimSun", "宋体", "Noto Serif CJK SC", "Noto Serif SC", serif`
  - 正文/控件：`"PingFang SC", "Heiti SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`
- 尺寸对比要明显：标题 19–21px / 600；正文 12.5–13px / 400、行高 1.55–1.65；评论 11.5–12px；tag 10.5px、字距 .04em。
- 0.13 正文透明度：卡片摘要与抽屉正文文字统一 80% 不透明度（见 3.5）；标题保持 100%。
- **署名**：仅在面板顶栏显示 `by caven v<Host 版本>`；Host 从 `package.json` 下发版本，Client 不保留版本常量。版本缺失时只显示 `by caven`，locale 描述也不带版本。
- 整体简约、留白足；圆角 10–12px；卡片阴影很轻（`0 1px 2px rgba(0,0,0,.04)`）。

## 7. UX 规格

### 7.1 布局

- 整面板：纵向 flex，`height: 100%`，`min-height: 0`；**没有底部输入栏**，便签墙占满剩余高度。
- 顶栏（约 56px）：左侧「Obsidian MEMO」宋体 18px / 600 + 紧跟在后面的小字 `by caven v0.13.9.2`（**0.13.4 起显示完整版本（含补丁号，0.13.9.2 起支持四段版本号），由 Host 的 `state.version` 自动派生**；约 11px、透明度 .45）+ 计数（`123 张便签`，**按当前日期筛选后的数量**）；右侧从左到右：**日期筛选控件（0.13.9，操作区第一个；主按钮是开关、右侧小三角弹档位菜单）**、子文件夹开关（0.13）、排序按钮（点击弹排序菜单）、刷新按钮、设置齿轮。可加一行极小的当前目录路径（省略号截断）。
- **子文件夹开关（0.13）**：自绘 folder-tree icon 的 30×30 icon 按钮，`aria-pressed` 反映 `settings.includeSubfolders`，开启时用**统一紫色选中样式**标识（见 7.8）。点击 → 乐观更新本地 settings → `saveSettings`（整份 settings 回传）→ 成功后 `refreshNow(true)`；失败回滚并 toast。tooltip：`显示子文件夹` / `仅显示顶层`。
- 中间：可滚动便签墙。`display:grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 14px; padding: 18px 22px 28px`。卡片统一高度 208px，内容超出裁切。**0.13 明确：卡片有图片时也不加高。**
- **动态加载（0.13.8）**：便签墙首屏只渲染前 `WALL_PAGE_SIZE`（50）张；墙底放一个哨兵元素，用 `IntersectionObserver`（root = `.SN_wall`，`rootMargin: 0 0 320px 0`）在接近底部时补下一批 50 张。补批时哨兵变成一行 `.SN_loadMore`：**三点脉冲动画 + 「加载中…」11px 淡字**，高度 44px；空闲时 1px 不可见、`pointer-events:none`。排序 / 日期筛选（含开关）变化时 `visibleLimit` 重置回 50；观察器在每次补批后重建，所以首屏 50 张填不满高面板时会继续补到填满或没有更多。补批前先渲染一帧「加载中」再切下一批（data 已在内存，渲染很快时几乎不可见）。**不做虚拟列表**（不卸载已渲染卡片）。
- 默认排序 = 文件创建时间降序（新 → 旧）；排序依据 host 下发的 `note.created`，前端可切换。

### 7.2 卡片（0.13 版）

- 结构（从上到下）：tag（浮在标题右上）→ 标题（宋体加粗，clamp 3 行，**无 byline**）→ 正文摘要（黑体，clamp 3 行；**有图时 clamp 1 行、line-height 1.5**；0.13.9 起**没有正文就不渲染摘要行**，不再显示「（暂无正文）」）→ 评论条（最多 2 条；有图时最多 1 条、max-height 18px、不显示「＋N」）→ **图片条（贴卡片底部、靠左对齐）** → hover 操作区（绝对定位底部，渐变底，不挤压内容）。有图时卡片内边距/间距收紧为 `padding:10px 15px; gap:2px`，图片条再留 `margin-bottom:6px`（让缩略图和卡片下边缘之间更透气），保证 208px 内不溢出（预算 ≈ 20 + 74 + 18.75 + 18 + 64 + 6 + 6 = 206.9px）。
- **图片条（第 3 轮修正）**：`note.images` 前 3 张正方形缩略图（**64×64**、圆角 7px、间隙 6px、`object-fit:cover`），**在 DOM 中排在评论条之后，用 `margin-top:auto` 贴住卡片底部、`align-self:flex-start` 左对齐**；`imageCount > 3` 时末尾追加一枚淡色 `＋N`（N = `imageCount - 3`），只占一小段文字、不占图片位。
  - 懒加载：卡片接近视口（IntersectionObserver，root 为便签墙，提前约 200px）才请求 `readImage { path, source, wiki, maxBytes: 1500000 }`；失败/超限/非图渲染同色系淡占位，不出错误文案、不打断卡片。
  - 网络图片（http/https）直接 `<img src>`；本地图片用返回的 dataUrl。缩略图在模块内缓存（key = `path\0source`，**按字节预算 ~24MB 的 LRU**，条目上限兜底，面板卸载清空），切走再回来不重复请求。
  - **并发上限（第 3 轮）**：图片加载走模块级队列，同时最多 3 个 `readImage` 在飞；排队项在卡片卸载/abort 时取消，避免一次涌入多个 MB 级 base64 造成主线程卡顿。
  - **有图时标题不压缩**：只吃掉摘要/评论的行数，卡片高度保持 208px。
- **hover 操作区（0.13 修正版）**：hover / focus-within 时浮出：
  1. 一行：**所有 AI emoji 预设平铺**（`settings.emojis` 每枚一个 27×27 方形 icon 按钮，只画 emoji 字形，`flex-wrap` 支持最多 12 枚）。**鼠标悬停（或键盘 focus）某一枚时，在该按钮上方浮出一枚小标签显示该预设的 `label`**（如「毒舌」「另一面」「落地」「真心话」）——不是折叠菜单、不需要点击展开。点击某枚 = 对该便签发 `comment`（同 emoji 已有评论时先确认，见 7.7）。
  2. **分割线**。
  3. 一行：`归档`（弹现有归档目标菜单）/ `开档`（现有对话框）/ **`在 Obsidian 打开`（0.13.8，行内最右、`margin-left:auto`；转发 icon + 紫色高亮粗体文字，0.13.9）**。点它发 `openInObsidian { path }`，由 Host 打开 `obsidian://open?path=…`；失败只 toast，不影响其他操作。
  - **图片预览与菜单的统一规则（0.13.4）**：**只要卡片操作菜单出现（= 悬停/键盘聚焦整张卡片，或归档目标菜单打开）且这张卡有图片预览，就统一隐藏图片条**（`.SN_card[data-menu='true'] .SN_cardImages{opacity:0; pointer-events:none}`），移出卡片后恢复。不再区分「鼠标是否停在某一枚 emoji 上」，旧的 `.SN_cardScrim` 同色渐变蒙版及其 emoji 行专属 hover 状态已**删除**（0.13.4 简化）。
  - 抽屉打开时整个操作区不出现（保持现有行为）。
- 卡片有 `pending` 时：操作区位置显示 `✍️ 正在写评论…`。
- **单击卡片打开右侧抽屉**（没有选中态、没有输入栏）；键盘 Enter 也可打开。
- 空状态 / 未配置 / 出错：面板中央说明 + 主按钮（去设置 / 重试）。
- 加载中：首次 fetch 显示骨架。

### 7.3 右侧抽屉（查看 / 编辑）

- **overlay 态（未锁定）**：从面板右侧推出，宽度约面板 1/3（`width: 34%; min-width: 340px; max-width: 620px`），占满面板高度，左侧卡片区仍可见、不加遮罩。滑入动画 160–200ms。
- **可拖宽**：默认 `width: 34%`，抽屉左边缘 8px 拖拽把手（`cursor: col-resize`），未锁定范围 `[320px, min(960px, 面板宽 × 0.8)]`；宽度写入 `localStorage['dsh-sticky-notes.drawerWidth']`，双击把手恢复 34%。
- **锁定（0.13 新增）**：抽屉头部右上、关闭按钮左侧有锁定按钮（0.13.9 起为**图钉图标**：钉住 = 实心，未钉住 = 空心；`aria-pressed`）。**锁定态不显示关闭按钮**（只留锁定/解锁按钮）；解锁态才显示关闭。两种模式都可用 `Esc` 关闭（锁定态的键盘退路）。
  - 未锁定 = 上述 overlay：覆盖在便签墙之上；点空白墙 / 同一张卡片关闭。
  - 锁定 = **内联双栏**：`.SN_body` 改为 `display:flex; flex-direction:row`，便签墙 `flex:1; min-width:0`，抽屉作为普通 flex 子项（无阴影、无绝对定位），左右并排、互不遮挡；抽屉打开/切换卡片时保持锁定。
  - 状态持久化 `localStorage['dsh-sticky-notes.panelLocked'] = '1'`（默认 '0'）。锁定态点空白墙 / 同一张卡片**不关闭**，只切换内容；`Esc` 仍关闭（没有关闭按钮）；编辑态在墙上按下仍只退出编辑。
  - **锁定面板恢复（0.13.4）**：锁定态打开的那篇便签路径写入 `localStorage['dsh-sticky-notes.pinnedNote']`。切到别的面板/重进（组件重挂）时不隐藏抽屉，而是自动恢复上次打开的便签；若它已被移出当前筛选/归档/改名，或存储里没有可恢复的路径，则**自动打开当前日期筛选结果排序后的第一篇**（没有便签则保持关闭，等有便签再打开）。未锁定态仍按旧行为：便签不在列表里就关闭抽屉。
  - 拖宽两种模式都可用；锁定态上限 = `max(320, min(960, 面板宽 - 260))`（给墙留至少 260px）；双击把手恢复默认宽度。
  - 锁定按钮本身也使用统一紫色选中样式（见 7.8）。
- **查看态**：顶部标题（**双击标题进入编辑态**；标题不带到 byline）+ tag + 锁定 / 关闭按钮；`header` 分割线下方是**抽屉操作条（第 3 轮新增，见 7.3.2）**；正文区渲染 `blocks`（段落/标题/列表/引用/代码；任务项渲染复选框）+ PROJECTS；**评论固定在底部独立区域**（见下条）。
- **评论固定区（0.13）**：阅读态抽屉结构 = head / body（自己的滚动）/ comments（固定底部、`flex:none`、`max-height:42%`、`min-height:96px`、自身滚动、上边框）。正文滚动不影响评论区；评论多时只在评论区内滚。零评论时显示一行「暂无评论」占位（高度小）。**编辑态隐藏评论区**。
- **双击正文区进入编辑态**（双击按钮/空白边缘不算）：正文变成 textarea，显示 `note.body` 原始 Markdown（不渲染），工具栏出现 `保存` / `取消`；`Cmd/Ctrl+S` 保存，`Esc`/取消退出编辑态（丢弃未保存修改，若有修改 toast「已取消编辑」）。
- **编辑态标题（第 4 轮修正）**：标题编辑是**多行 textarea**，宽度 100%、自动换行（`white-space:pre-wrap`，高度随内容 24–132px 自适应），完整显示文件名，**不需要横向滚动到尾部**；文件名不允许换行，`Enter` 不插入换行（保存仍用 Cmd/Ctrl+S 或按钮）。
- **保存**：`saveNote { path, body, name, expectedRevision }`；成功后同步抽屉路径、退出编辑态，再取 `note` 并刷新 state；失败保留草稿并 toast `error.message`。**0.13.4：改名保存时先用 Host 返回的新 `NoteSummary` 乐观替换 `view.notes` 里的旧 path（`replaceNoteAtPath`），避免「打开的便签不在筛选结果里」effect 把刚保存的抽屉误关闭 / 锁定态误切到别的便签；保存请求在飞时该 effect 也会跳过。**
- **焦点规则**：
  - 抽屉查看态（overlay）：单击同一张卡片或空白墙 → 关闭；单击另一张卡片 → 切换内容。锁定态见上（不关闭）。
  - 卡片 hover 操作行在抽屉打开时不可用（不弹菜单/不响应点击）。
  - 抽屉编辑态：在左侧便签墙按下鼠标 → 只退出编辑态（丢弃未保存修改），抽屉保持打开。
  - 点击抽屉内部不关闭；关闭按钮 / `Esc`（查看态）关闭。
- 切换卡片：抽屉打开时单击另一张卡片可直接切换内容。

### 7.3.2 抽屉操作条（第 3 轮新增）

- 阅读态抽屉在 header 分割线正下方渲染一行 `.SN_drawerActions`，**锁定与否都显示**；编辑态隐藏整条。
- 一行两段；空间不足时允许换行（0.13.9：右侧第三枚按钮可落到下一行）：
  - **左侧**：所有 AI emoji 评论按钮（与卡片同款 27×27 `.SN_aiBtn`，hover/focus 时按钮上方浮出 label 小标签）。点击 = 对当前打开的便签生成评论（同 emoji 已有评论先确认，见 §7.7）；pending 时左侧替换为 `✍️ 正在写评论…`。
  - **右侧**：`归档`（点击弹出归档目标下拉，选目标后执行归档，成功后关闭抽屉）与 `开档`（打开开档对话框），**最右是「在 Obsidian 打开」**（0.13.8，同款 forwarding icon + 紫色高亮粗体文字，调 `openInObsidian`）。为容纳第三个按钮，`.SN_drawerActions` 允许换行（`row-gap:6px`）；0.13.9 起 `.SN_drawerActionRight` 也允许换行（`flex-wrap:wrap; justify-content:flex-end`），空间不足时「归档 / 开档」留在上一行、「在 Obsidian 打开」落到下一行并靠右，不再强制挤成一行。窄布局由抽屉实际宽度判定：`drawerActionsNarrow(width)` = 宽度已知且 `< 430px`（`DRAWER_ACTIONS_NARROW_WIDTH`）；右侧组结构 = `.SN_drawerActionPair`（归档 / 开档）+ Obsidian 按钮，窄布局时右侧组 `flex-direction:column`、Obsidian 按钮落到下一行并靠右（`data-narrow="true"`）。
- 归档目标下拉锚定在操作条下方、右对齐；点外部 / `Esc` 关闭。不要复用卡片内的 `.SN_menu` 定位。
- 抽屉打开时卡片 hover 操作区仍不出现（避免重复入口）。

### 7.3.1 排序菜单

- 顶栏排序按钮（自绘 icon，`aria-label`），点击弹出小菜单（绝对定位在按钮下方，点击外部关闭）：
  - `文件创建时间 · 新→旧`（默认，排第一）
  - `文件创建时间 · 旧→新`
  - `最近修改 · 新→旧`
  - `文件名 · A→Z`
- 当前选项打勾；选择后立即重排并记住（`localStorage` 键 `dsh-sticky-notes.sort.v2`，读不到时用默认）。

### 7.3.1b 日期筛选开关 + 档位菜单（0.13.9，源自 0.13.4）

- 顶栏操作区**第一个**是日期筛选控件，结构 = **主按钮（自绘日历，开关） + 小三角（档位菜单）**：
  - **主按钮 = 开关**：`aria-pressed` + `data-active` 反映开关状态，点亮（统一紫色样式）时按当前档位过滤；熄灭时**显示全部便签**。点击立即切换并记住（`localStorage['dsh-sticky-notes.dateFilterEnabled.v1'] = '1'/'0'`，**默认 '1'**）。`aria-label` / `title` 说明当前状态与点击后果（`date.toggleOn` / `date.toggleOff` 文案，带当前档位名）。
  - **小三角**：`aria-haspopup="menu"` + `aria-expanded`，点击打开档位菜单（与排序菜单同款小菜单，绝对定位在按钮下方、点外部 / `Esc` 关闭）。
  - 这套「主按钮开关 + 小三角菜单」与子文件夹开关的「点亮 = 开启」语义统一；以后文件夹若也要选择显示哪个目录，可复用同一结构。
- 菜单**四档**单选，默认今天：`今天` / `3 天` / `本周` / `本月`。点选 = 更新档位 + **自动点亮开关**（开关熄灭时菜单项不显示勾选）。`全部` 已从菜单移除（熄灭开关就是全部）；旧版 `dateFilter.v1 === 'all'` 迁移为「档位 today + 开关熄灭」。档位持久化 `localStorage['dsh-sticky-notes.dateFilter.v1']`，非法值回退 `today`。
- 菜单底部用分割线隔开一个**勾选项**：`日期截止按真实时间`（`role="menuitemcheckbox"`，状态写入 `localStorage['dsh-sticky-notes.dateRealtime.v1'] = '1'/'0'`，**默认不勾**）。
  - **勾选**：按每日 00:00 作为分界点（真实日期）——今天 = 本地 0 点；3 天 = 含今天的最近 3 个自然日；本周 = 本周一 0 点；本月 = 本月 1 号 0 点。
  - **不勾（默认）**：以**最新一篇便签（全部便签里 created 最大者）的时间**为标准界线往前滚动——今天 = 锚点前 24h；3 天 = 72h；本周 = 7×24h；本月 = 30×24h。没有便签时退回当前时间作锚。
- 时间口径：一律按**文件创建时间**（`note.created`；缺失或为 0 时回退 `mtime`）。
- 过滤只发生在前端（Host 仍返回全部便签）；计数显示过滤后的数量（开关熄灭 = 全部数量）；有便签但开关点亮且当前范围为空时，中央空态提示「这个时间范围里没有便签」+ `换日期范围` 按钮（点击打开档位菜单，选择后自动点亮开关）。
- 边界在每轮渲染按当前时间计算；面板每分钟刷新一次参考时间，跨午夜无需重开面板。
- 纯函数 `filterNotesByDate(notes, filterId, realtime, now, anchor, enabled)`：`enabled === false` 时直接返回全部（浅拷贝）；`filterId === 'all'` 保留为旧值兼容（不设下界）。

### 7.4 设置抽屉

- 从右侧滑入/覆盖面板的抽屉，宽 380–440px，带半透明遮罩；Esc/点遮罩取消（有未保存改动时可不拦，简单点）。
- 字段：
  1. 仓库根目录：文本框 + `选择…`（系统目录选择器 `pickDirectory`，macOS 原生对话框可直接选 iCloud）
  2. 便签目录：同上；旁边显示解析后的绝对路径提示
  3. 开档目录：同上
  4. 归档目录：列表（label + path），每行可删除；`添加归档目录` 同样走系统选择器，选完自动用 basename 作为 label
  5. 手动输入框始终可编辑（支持 `~` 展开）；系统选择器取消返回 null 时什么都不改。
  6. Emoji 与提示词（0.13.8 重排）：每枚 AI 角色一行 = `emoji 输入`（54×34）+ `名称输入`（flex:1，占剩余宽度）+ **`callout 样式按钮`** + `删除`；callout 样式按钮与 emoji 输入同高（34px），文字固定写成 `callout样式-<样式名>`（如 `callout样式-引用`，10.5px，超宽省略)，点开是一枚 13 项菜单（`role="menu"` + `menuitemradio`）：当前项打勾并高亮，点选后关闭并回写 `callout`；点外部关闭。提示词 textarea 在下一行；底部 `添加 emoji`。
  7. AI 预算（0.13）：每枚 emoji 组内多一行紧凑控件——`AI 预算` 下拉（低 / 中 / 高 / 自定义）；选「自定义」时再露出「思考档位」下拉（不思考/低/高/最高）+「输出上限」数字框（256–65536，失焦或回车提交）。三档固定映射 `low=off/2048`、`medium=low/4096`、`high=high/8192`；默认高。建档提示词下方放同款控件（`projectAi`）。
  8. 建档提示词：多行 textarea（默认值来自 Host，可改）
  9. 底部：`保存`（主按钮）/ `取消`
- `保存` → `saveSettings`；成功 toast「设置已保存」；`configured` 变化后重新取 state。
- 保存前做轻量校验：仓库/便签目录为空时允许保存但提示「尚未配置，面板不可用」；emoji 至少保留 1 枚，否则阻止保存。
- 目录选择走 `pickDirectory`；用户取消（path null）什么都不做。

### 7.5 Toast / 撤销

- 面板顶部居中浮出小条（绝对定位，不挡操作），多个时叠放，4–6 秒自动消失。
- 归档成功：`已归档到「设计」  [撤销]`，撤销按钮调 `undoArchive`，成功后 toast「已恢复」。
- 错误 toast 用 `state-error-primary` 左边条，文案直接来自 `error.message`。
- **预算提示（0.13）**：`Job.errorCode === 'llm-token-budget'` 时用 error toast；`Job.truncated` 时用 info toast。两种都复用现有 toast 样式，带 `去设置` / `知道了` 两个动作（延迟 12 秒自动消失）；点「去设置」直接打开设置抽屉并滚到第一个「AI 预算」控件（AI 预算就在各 emoji 行与建档提示词下方）。

### 7.6 无障碍 & 细节

- 按钮用 `<button type="button">`；图标按钮有 `aria-label`；开关类按钮用 `aria-pressed`。
- 卡片可键盘聚焦（`tabIndex=0`），Enter 选中。
- 不要拦截全局快捷键（Esc 仅在右侧抽屉/设置抽屉/菜单打开时处理）。
- 文本禁止选中拖拽问题：卡片正文 `user-select: text` 便于复制。
- **窗口拖拽（0.13.9）**：`.SN_head` 设 `-webkit-app-region: drag`（同时写 `app-region:drag`），在 **DSH 桌面版**（Electron frameless 窗口）里按住「Obsidian MEMO」标题 / 目录小字 / 顶栏空白即可拖动整个窗口；`.SN_headActions` 及其所有后代显式 `no-drag`，保证按钮、菜单照常点击。Web GUI 浏览器会忽略该属性，行为不变。

### 7.7 同类评论确认（0.13）

- 点击卡片上的某个预设生成评论前，若 `note.commentKinds` 已包含该预设的 `emoji`，先弹确认框（与开档对话框同风格）：
  - 标题：`已有同类评论`
  - 正文：`这张便签已经有一条「<预设名>」评论，要再生成一条吗？`
  - 按钮：`再生成一条`（主）/ `取消`（次）
- 确认后才发 `comment`；取消则什么都不做。确认框打开时 `Esc` 只关确认框。
- 自定义预设同样按 emoji 判断；`commentKinds` 缺失（旧 Host）时不做确认、直接生成。

### 7.8 统一 icon 选中样式 + 性能与轮询（第 3 轮）

- **统一 icon 选中样式**：`--sn-accent:#8B5CF6`（暗色主题 `#A78BFA`）。所有 30×30 `.SN_iconBtn` 在选中/激活态用 `data-active="true"`：**浅紫半透明底 + 紫色图标**（`color-mix(in srgb, var(--sn-accent) 10%, transparent)`，前置 rgba 兜底；hover 14%），不要品牌蓝深色块。至少覆盖：日期筛选开关（点亮）、子文件夹开关（开）、锁定/图钉按钮（已锁定）、排序按钮（排序菜单打开）、设置齿轮（设置抽屉打开）。
- **轮询自适应退避**：base 4s；一次响应 `unchanged` 时下一次 delay = `min(30000, round(prev * 1.5))`；有变化或用户主动操作（刷新/rescan/保存/评论等）重置回 4s。纯函数 `nextPollDelay(prevDelay, unchanged)` 导出到 `__test`。
- **不可见时暂停**：面板不可见（`panelRef.current.getClientRects().length === 0` 或 `document.hidden`）时不发 `state` RPC，按约 15s 继续调度；`visibilitychange` 变可见立即跑一次并重置 delay。
- **无变化不重渲染**：`mergeState` 在 `unchanged` 且 configured/error/revision、settings 签名、jobs 签名、notes 引用都相同时**返回 prev 对象**（不新建 view）。
- **卡片 memo**：`NoteCard` 用 `React.memo`；`t` 与全部回调收进稳定 `actionsRef`（卡片调用 `props.actions.current.xxx`），面板因 toast/菜单/轮询重渲染时未变化的卡片跳过重渲染。
- **图片加载**：并发 ≤3 的模块级队列 + 按字节预算的 LRU 缓存（~24MB，条目上限兜底），卸载/abort 清理。
- **Host 侧配套**：扫描单飞（同一设置指纹下并发请求复用同一个 scan，scanEpoch 防止写后旧结果回写）；`readImage` wiki 附件名 miss 负缓存 60s；`DSH_STICKY_NOTES_DEBUG=1` 时输出 scan/readImage/state 计时日志（默认静默）。

## 8. 维护边界

文件操作的边界规则集中在 `files.js`；解析、扫描、设置、模型处理各自维护。RPC 和 UI 变更须同步更新本文相关契约与行为测试。

## 9. 验收清单（Client）

- [ ] 侧栏出现便签图标，点击切到面板，选中态正确
- [ ] 顶栏显示 Host 下发的完整版本；版本缺失时只显示署名；卡片与抽屉不带署名。
- [ ] 便签墙渲染 title/excerpt/comments/tag/color，meta 不出现；日间卡片色很淡（#FDFAF4 系）
- [ ] 正文与卡片摘要是 80% 墨色
- [ ] 有图卡片：3 张方图贴卡片底部、左对齐（＋N 跟随）；标题不压缩、摘要/评论行数被压缩、卡片仍 208px
- [ ] 卡片 hover：所有 AI emoji 平铺一行，悬停某枚时上方浮出文字标题；分割线下是归档/开档；**hover/聚焦整张卡（菜单出现）且有图预览时统一隐藏图片条**，移出恢复
- [ ] 卡片图片 64×64，贴在卡片左下角；有图卡片 208px 不溢出
- [ ] 抽屉 header 分割线下有操作条：左 emoji 评论、右 归档/开档；锁定/未锁定都在
- [ ] 锁定态没有关闭按钮，只能解锁后关闭或 Esc；解锁恢复关闭按钮；锁定按钮是图钉（钉住实心 / 未钉住空心）
- [ ] 日期筛选/子文件夹/锁定/排序/设置五个 icon 激活态统一为紫色高亮（浅紫底+紫图标）
- [ ] 空闲轮询会退避（4s→最长 30s），面板不可见时不请求；无变化时不整墙重渲染
- [ ] 已有同类评论时点击 emoji → 弹「再生成一条？」确认；确认后才生成
- [ ] 单击卡片推出抽屉；点左侧卡片区关闭；编辑态点左侧只退出编辑
- [ ] 抽屉内双击标题或正文进入编辑：标题为多行 textarea（完整换行显示、无横向滚动），正文为原始 Markdown textarea；保存只替换正文、frontmatter 不动
- [ ] 有图卡片缩略图与卡片下边缘之间留出更明显空隙（图片条 margin-bottom 6px）
- [ ] 抽屉阅读态评论固定在下方面板内，正文滚动不影响评论
- [ ] 抽屉锁定 → 变成右侧内联双栏、不遮挡；解锁恢复 overlay；刷新后锁定状态记住
- [ ] 顶栏子文件夹 icon 切换：关闭后墙只剩顶层便签，刷新后状态记住；激活态是紫色高亮
- [ ] 排序按钮与菜单（默认创建时间新→旧），刷新后记住
- [ ] 日期筛选是顶栏操作区第一个，且是「开关 + 档位菜单」：主按钮点亮=按今天/3 天/本周/本月筛选，熄灭=显示全部；小三角菜单四档（无「全部」，默认今天）并自动点亮开关；勾选项「日期截止按真实时间」（勾选=每日 00:00 分界，不勾=以最后一篇为界）；刷新后开关/档位/勾选都记住；计数随筛选变化
- [ ] 锁定面板重进不隐藏：恢复上次打开的便签；它不在当前筛选里时自动打开筛选排序后的第一篇
- [ ] 菜单出现时图片预览统一隐藏（不再只在 emoji 上才隐藏）
- [ ] 卡片 hover 操作行第三项是「在 Obsidian 打开」（转发 icon + 紫色高亮粗体文字、行内靠右）；右侧抽屉操作条窄到放不下时归档/开档在上、它换到下一行并靠右；点它系统打开 Obsidian 对应笔记，失败 toast
- [ ] 没有正文的卡片不显示「（暂无正文）」占位
- [ ] 正文/摘要里的 `^qa-daily-preview-…` block id 不显示，且不影响锚点后面的文字
- [ ] 桌面版 DSH 里按住顶栏「Obsidian MEMO」标题区可以拖动整个窗口，右侧按钮/菜单仍可点击（Web GUI 不受影响）
- [ ] 便签墙首屏 50 张；滚到底自动补 50 张；补批时墙底出现三点加载动画 + 「加载中…」；排序/日期筛选变化回到 50 张
- [ ] 设置里每枚 emoji 一行：emoji + 名称 + callout 样式按钮 + 删除；样式按钮显示「callout样式-xx」，点开 13 项菜单、当前项打勾
- [ ] 顶栏显示 Host 下发的完整版本（当前 0.13.9.2），locale 描述不写版本
- [ ] 设置里目录字段走系统选择器，能直接选 iCloud 里的 Obsidian 库（也可手动输入 `~` 路径）
- [ ] emoji 评论：pending 态 → callout 出现在卡片与 md
- [ ] 归档 → toast + 撤销 → 文件移动/恢复
- [ ] 开档 → 对话框 → 进度 → 生成 md 与 PROJECTS 链接（Host 侧完成，Client 展示结果）
- [ ] 设置抽屉：目录点选、emoji 增删改、保存后即时生效
- [ ] 未配置/空目录/错误 三种空态
- [ ] 深浅主题下都可读；字体对比明确；无 console 报错

## 10. 内容与路径边界

所有便签、附件和写入目标都校验用户路径与真实位置；尚未创建的路径解析最近的已有父目录。悬空符号链接不视作新建目录。归档撤销也须符合当前仓库与便签目录边界。

AI 输入使用去掉 frontmatter 后的原始 Markdown（含已有评论），不复用展示 blocks；输入总上限 12000 字符，裁切时向模型附加明确提示。评论与开档输出上限分别为 4000 和 24000 字符；字符裁切与 token 截断均设置 `Job.truncated`。开档目标占用、任务去重、部分完成和卸载策略保持原状。
