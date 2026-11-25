# 0.16.8 便签标题模式 · 设计稿

- 状态：已与用户确认方向；已按首轮 spec 审查修订
- 目标版本：`0.16.8`
- 涉及端：Host（`lib/`）、Client（`src/client/`）、配置、文档与测试

## 1. 背景与目标

当前便签标题固定等于 `.md` 文件名：

- 卡片、阅读抽屉的标题都来自 `NoteSummary.title`，Host 直接给文件名；
- 快速记录输入框的内容直接当文件名，正文不写入标题；
- 编辑抽屉的标题框实际改的是文件名，保存时可能重命名文件。

0.16.8 允许用户在设置里选择标题来源，共三种模式：

1. `filename`：文件名即标题（**默认，保持现有行为**）；
2. `firstLine`：正文第一行是标题；
3. `heading`：正文第一个 `#` 一级标题是标题。

后两种模式需要自动生成文件名（用户用模板定义），不再由标题决定文件名。

### 非目标

- 不改变归档、删除/撤回、图片处理、AI 评论、开档、在 Obsidian 打开的现有语义。
- 不新增搜索、不新增按标题重命名文件、不批量迁移已有文件名。
- 不引入新的运行时依赖，不引入 Host 与 Client 之外的新进程/服务。

## 2. 设置

### 2.1 新增字段

```ts
interface Settings {
  // ...既有字段
  titleMode: 'filename' | 'firstLine' | 'heading'  // 默认 'filename'
  fileNamePattern: string                          // 默认 '{date}-{time}'；仅 titleMode 非 filename 时使用
}
```

- 旧 `config.json` / 旧 Host 没有字段时按默认值处理，行为完全不变。
- `normalizeSettings` 规范化：
  - `titleMode` 不在白名单 → `'filename'`；
  - `fileNamePattern` 去首尾空白、去 NUL；空串 → 默认值；最多 120 个字符（`LIMITS.fileNamePatternChars`，超出截断）。
- 工厂默认值写入 `DEFAULT_SETTINGS`；`portableSettings`、`settingsEqual`、配置指纹沿用现有通用逻辑。

### 2.2 切换模式的影响

- `titleMode` 变化会让扫描缓存失效（`scanKey` 包含模式），并触发整库重新解析；已有文件内容不改、文件名不改。
- `fileNamePattern` 只影响**之后新建**的便签，不影响已有文件。
- `compositeRevision` 已混入 `settingsFingerprint()`（`lib/host/state.js`），因此模式切换会让 `state.revision` 变化并由客户端整份刷新，不需要额外失效逻辑。

## 3. 标题推导（Host）

### 3.1 模块拆分与依赖方向

`lib/notes.js` 已 458 行，且 `stripInline()`（`lib/notes.js:153`）是标题去 Markdown 记号的现成实现。若 `lib/title.js` 反向 import `notes.js` 会形成循环，违反 `test/architecture.test.mjs`。因此：

- 新增 `lib/markdown.js`：迁出 `normalizeText`、`stripInline`、`stripBlockIds`，并导出 `INVISIBLE_CHARS`（NUL/C0、零宽与双向控制符字符类，见 §3.3）；不依赖任何其他模块；
- `lib/notes.js` 从 `lib/markdown.js` import 并**重新导出**三者，保持 `test/notes/frontmatter.test.mjs`、`test/notes/comments-and-text.test.mjs` 等既有 import 不变；
- 新增 `lib/title.js`：import `stripInline`，不 import `notes.js`；
- `lib/notes.js` import `findTitleLine` / `titleLineFor` 等来自 `lib/title.js`，依赖方向为 `notes.js → title.js → markdown.js`，无环。

`lib/title.js` 纯函数、无 IO：

```js
export const TITLE_MODES = ['filename', 'firstLine', 'heading']
export const DEFAULT_TITLE_MODE = 'filename'
export function normalizeTitleMode(value)                 // 非法 → 'filename'
export function findTitleLine(lines, mode)                // → { title, index, marker }
export function titleLineFor(mode, title, marker = '')    // → 写入正文的标题行（单行）
export function sanitizeTitleText(value)                  // 正文标题写回前的清洗
export function stripTitleLine(body, mode)                // 复制用：去掉标题行
```

约定：

- `lines` 是去掉 frontmatter、去 BOM、统一 `\n` 后的正文行数组；
- `mode === 'filename'` 时 `findTitleLine` 返回 `{ title: '', index: -1, marker: '' }`，正文不特殊处理。

### 3.2 三种模式

| 模式 | 标题 | 识别规则 |
| --- | --- | --- |
| `filename` | 文件名 | 不解析正文，保留现有行为 |
| `firstLine` | 正文第一个非空行 | `trim()` 后非空；若是 ATX 标题行则取标题文字并记录 `marker`；行内 Markdown 记号去掉 |
| `heading` | 正文第一个一级标题 | `/^ {0,3}#\s+(.+)$/`，跳过代码围栏（反引号 ×3 或 `~~~`）内的行；标题文字去行内记号 |

具体规则：

- `firstLine` 的「第一个非空行」就是字面第一行，**不跳过代码围栏**。排除判断必须基于**原始 trim 行**，不能基于 `stripInline` 结果（后处理会把三个反引号压成一个，也会把 `***` 压成 `*`）：
  - 代码围栏开头：trim 后以 3 个以上反引号或 `~` 开头（允许带 info string，如三个反引号后跟 `js`）；
  - 分隔线：`/^(?:-{3,}|\*{3,}|_{3,})$/`；
  - 对原始行做 `stripInline` 后为空（例如整行只有图片或注释）——这一步只判断「没有可读文字」，不用于识别围栏/分隔线。
  命中任一 → 视为取不到标题，回退文件名，且**不置空该行**（避免把代码块围栏删掉后，围栏内容被当成评论 callout 解析）。
- `firstLine` 与 `heading` 共用 ATX 识别 `/^ {0,3}(#{1,6})\s+(.+)$/`；`marker` = 第一组（如 `##`）。
- `firstLine` 的转义与写回算法（精确规则，避免 `stripInline` 破坏反引号）：
  1. 取第一个非空原始行 `raw`（trim 后）；
  2. 若 `raw` 命中围栏/分隔线：取不到标题，回退文件名，且不置空该行；
  3. 否则若 `raw` 命中 ATX：`text` = ATX 第二组 trim；
     - 若 `text` 以单个反斜杠开头且 `text.slice(1)` 命中围栏/分隔线：标题 = `text.slice(1)`，**逐字返回**（不再 `stripInline`）；
     - 否则标题 = `stripInline(text)`；`marker` = ATX 第一组；
  4. 否则若 `raw` 以单个反斜杠开头且 `raw.slice(1)` 命中围栏/分隔线：标题 = `raw.slice(1)`，**逐字返回**；
  5. 否则标题 = `stripInline(raw)`，`marker = ''`。
- `titleLineFor('firstLine', title, marker)`：
  - `clean` 命中围栏/分隔线时先转义为 `\${clean}`（在标题前加一个反斜杠），否则 `escaped = clean`；
  - `marker` 非空时返回 `${marker} ${escaped}`，否则返回 `escaped`。
  - 因此「三个反引号」「`---`」「带 `##` 标记的三反引号标题」都能往返；**例外**（明确归一化）：用户标题本身以 `\` 紧跟围栏/分隔线（如字面量 `\---`）时，反斜杠会被消费，读取回来是 `---`。这是极端输入，文档与测试都按归一化处理。
- `heading` 跳过代码围栏：围栏行用 `/^\s*(```|~~~)(.*)$/` 识别，闭合行以相同标记开头；围栏内的 `#` 不算。
- `heading` 遇到空的一级标题（只有 `#`）继续找下一个带文字的一级标题。
- `marker` 是标题行原有的 ATX 前缀（如 `##`），仅用于客户端编辑时保留格式；取不到标题时为 `''`。
- 取不到标题：`title = ''`，由调用方回退文件名。**返回给客户端的标题永远不会为空**。

### 3.3 标题文字清洗

`sanitizeTitleText(value)`（Host 与 Client 各一份，parity 测试约束）：

1. `String(value ?? '')`，Unicode NFC；
2. 把 `\r\n?`、`\n` 统一替换为单个空格；
3. 去掉 NUL/C0 控制符、零宽与双向控制符：使用 `lib/markdown.js` 导出的 `INVISIBLE_CHARS` 字符类（Host）；Client 在 `title-line.js` 里用同一字符类（parity fixture 覆盖 `'a\u200bb\u202ec\u0000'`）。`lib/filename.js` 的 `INVALID_NAME_CHARS` 仍保留自己的、包含路径与 Markdown 特殊字符的更大字符类，两者用途不同；
4. `trim()`，不折叠中间空格、不去 Markdown 记号、不截断。

`sanitizeTitleText` **不负责**文件名合法性（`/\:*?"<>|#^[]` 等）：正文标题允许任意可读文字，只有进入 `{title}` → 文件名时才走文件名清洗与 240 字节截断。

### 3.4 不重复渲染标题行

阅读视图里标题已经显示在抽屉顶部，正文不再重复显示同一行：

- `parseNote(text, { titleMode })` 在解析 blocks / excerpt 之前，把标题行在行数组里**置为空字符串**；
- 行数不变，`withRanges` 的评论行号仍与源文件对齐；`removeCommentAt` / `deleteComment` 也必须带当前 `titleMode`，否则「首行恰好是 callout」的正文模式便签会按旧模式数错评论序号；
- 只有 `title` 非空且 `index >= 0` 时才置空；
- `titleMode` 缺省仍是 `'filename'`，`parseNote` 的旧标题行为（第一个 h/p 块）保持不变，老测试不受影响。

`parseNote` 返回的 `title`：

- `filename` 模式：沿用旧逻辑（第一个 h/p 块文字），由扫描层用文件名覆盖；
- 正文模式：`findTitleLine` 的结果（可能为 `''`）。

### 3.5 扫描与读取

- `NotesScanner.scan(settings)` 读取 `settings.titleMode`，写入 `scanKey`（`vault\0notes\0subfolders\0titleMode`），并传入 `parseNote`；
- `NotesScanner` 记住当前 `titleMode`，`readFull()` 重解析时使用同一个模式；`reset()` 恢复默认；
- **`buildSummary` 的标题必须按模式分开**，不能无条件使用 `parsed.title || entry.name`：
  - `filename`：`title: entry.name`（与今天一致，`test/scan.test.mjs:121` 依赖）；
  - 正文模式：`title: clip(parsed.title, LIMITS.titleChars) || entry.name`；
- **展示用标题必须有上限**：正文模式的首行可能是很长的正文（文件上限 2 MB），而 `NoteSummary` 会随每次 `state` 轮询整库下发。新增 `LIMITS.titleChars = 200`，在 `buildSummary`、`readFullNote`、`readModelSource` 用 `clip()` 截断展示标题；正文与写回仍用完整原始行（`full.body`），不截断。
- `name` 始终是文件名；
- `readFullNote(filePath, titleMode)` 与 `readModelSource(filePath, titleMode)` 同样按模式派生标题并回退文件名；`filename` 模式直接 `basename`；
- `endpointNote` 把 `getSettings().titleMode` 传给 `readFullNote`；`ai-jobs` 传给 `readModelSource`；
- `endpointToggleTask` 用当前模式解析（避免把正文里不显示的标题行任务当成合法任务）；
- `onSettingsChange` 在 `titleMode` 变化时重置 scanner。

## 4. 新建（快速记录）

`endpointCreateNote` 把当前设置一起交给 `createCapturedNote`。新建内容组成：

```
[frontmatter]

[标题行]        ← 仅 firstLine / heading

[正文]

[图片嵌入]
```

### 4.1 标题校验

- 所有模式都要求标题非空（客户端提交按钮已禁用空标题；Host 仍校验，防止直接 RPC）。
- `filename`：与现在完全一致，走 `sanitizeNoteFileName`（240 字节、特殊字符、保留名），失败返回 `bad-request` / `exists`。
- `firstLine` / `heading`：标题只走 `sanitizeTitleText`（折叠换行、去控制符、trim），**不做文件名长度与字符校验**；正文里的标题行不截断（只有 `NoteSummary` / `note` / `readModelSource` 的展示标题按 §3.5 截到 200 字符，编辑写回与复制全文都用完整正文重新推导）。
- 正文模式下标题行：
  - `firstLine`：`titleLineFor('firstLine', title)` → 标题纯文本；
  - `heading`：`titleLineFor('heading', title)` → `# 标题`。

### 4.2 文件名模板

```js
// lib/filename.js
export const DEFAULT_FILE_NAME_PATTERN = '{date}-{time}'
export function expandFileNamePattern(pattern, { title = '', now = new Date() } = {})
export function truncateNoteName(name, maxBytes = LIMITS.noteNameBytes)
```

支持 token（其余文字原样保留，未识别的 `{...}` 原样保留）：

| token | 示例 | 说明 |
| --- | --- | --- |
| `{title}` | `我的想法` | 正文标题；过长/非法字符按文件名校验处理 |
| `{date}` | `2026-11-13` | 本地日期 `YYYY-MM-DD` |
| `{time}` | `1924` | 本地时间 `HHmm` |
| `{timestamp}` | `20261113-192435` | 本地时间 `YYYYMMDD-HHmmss`，默认唯一性兜底 |

生成流程：

1. 展开 token；
2. 用 `sanitizeNoteFileName` 清洗（特殊字符替换空格、去首尾点、NFC、Windows 保留名等）；
3. `too-long` → 按 UTF-8 字节在码点边界截断到 240 字节（不报错）；
4. `empty` → 回退 `note-{timestamp}`；
5. `reserved` → 加 `note-` 前缀后再次清洗。

日期格式化复用 `lib/datetime.js` 的 `formatTemplateMoment`（从 `lib/capture.js` 抽出；`capture.js` 继续 re-export，保持 `formatTemplateMoment` / `expandTemplateVariables` 的旧导出不变）。

### 4.3 重名

- 正文模式：先选一个不存在的名字；发布时若仍 `EEXIST`（并发），重新选 `-2`、`-3`… 再试，最多 5 次；仍失败才返回 `exists`。
- 后缀在 240 字节上限内拼接。
- `filename` 模式不自动加后缀，保持「同名便签已存在」的提示。

### 4.4 Default Template 兼容

- 目录模板匹配用**实际生成的文件名**（`{原目录}/{fileStem}.md`），不是正文标题；
- frontmatter 的 `{{title}}` 仍替换为正文标题（用户可读的标题）；
- 碰撞重试（§4.3）**不重新解析模板**：模板在一次新建开始时按第一个候选文件名解析一次，之后只更换目标文件名。同目录规则在重试中不会变化，避免模板内容与最终文件路径不一致。

## 5. 阅读、编辑、复制、排序（Client）

### 5.1 阅读态

- 抽屉标题仍用 Host 下发的 `title`；正文 blocks 已不含标题行。
- 卡片标题、排序键使用 `title`（`title || name`），文件名模式下与现在相同。
- 只有标题、没有正文的正文模式便签：`blocks` 为空，保持现有「双击正文编辑」提示（`drawer.editHint`），不新增空态分支。

### 5.2 编辑态（用户选定方案 B）

编辑抽屉仍是「标题 textarea + 正文 textarea」，但模式为 `firstLine` / `heading` 时：

- 进入编辑：
  - `bodyDraft = full.body`；
  - `titleDraft = deriveTitle(full.body, mode)`（客户端纯函数，**不是** `full.title`，否则无标题行时会显示文件名，见 §7）；
  - 记录本次编辑使用的 `titleMode`（编辑期间设置变化不打断当前会话）；
  - 标题输入框显示 `placeholder`：`deriveTitle` 为空时展示文件名回退说明（`drawer.titleEmptyHint`）。
- 改标题框：
  - `clean = sanitizeTitleText(next)`；
  - `clean === ''`：删掉已定位的标题行（没有则正文不变）；不写 `#`、不留空标签行；
  - `heading`：替换/插入为 `# ${clean}`；
  - `firstLine`：用 `titleLineFor('firstLine', clean, marker)` 生成（原行有 `marker` 时保留 `##`；标题本身像围栏/分隔线时按 §3.2 加反斜杠转义）；
  - 原正文没有标题行：在正文第一行位置插入标题行（仅当用户真正改动标题框，避免打开编辑就改文件）；
  - 写回后同步更新 `bodyDraft`。
  - 已知归一化：`firstLine` 模式里输入以 `#` 开头的标题会被视为 ATX 标题，保存后标题显示为 `#` 后面的文字；这是该模式「首行是标题」的预期行为，不做转义。
- 改正文：`titleDraft = deriveTitle(nextBody, mode)`（可能为空），保持两处一致。
- 保存：
  - `firstLine` / `heading`：只发 `body` + `expectedRevision`，**不发 `name`**，不重命名文件；
  - `filename`：完全保持现有行为（发 `name`、可改名、空标题拦截）。
- 保存成功：
  - 正文模式：`titleDraft = deriveTitle(刚保存的 body, mode)`；
  - 文件名模式：`titleDraft = savedNote.name`。
- 取消 / 关闭时的「已取消编辑」判断：
  - 正文模式只比较 `bodyDraft` 与原文（标题改动已经写进草稿）；
  - 文件名模式比较正文与标题。
- 编辑态标题输入框：
  - `filename` 模式保持 `maxLength: 60`、`aria-label` 用 `drawer.titleAria`（「便签文件名」）；
  - 正文模式不设 `maxLength`（标题是正文文字，不截断），`aria-label` 用 `drawer.titleAriaBody`（「便签标题」）；
  - 正文模式在标题下方渲染一行 `SN_noteDrawerTitleHint`：`标题保存在正文第一行` / `标题保存在正文第一个一级标题`；没有标题行时显示 `未检测到标题，保存后显示文件名`。

### 5.3 复制全文

- 文件名模式：`title + '\n' + body`（现状）。
- 正文模式：`deriveTitle(full.body, mode) || full.title || note.title || note.name` 作为标题，加上 `stripTitleLine(full.body, mode)`（去掉正文里的标题行并去首部空行），避免标题出现两遍。**不能直接用 `full.title`**：它按 §3.5 截到 200 字符，长标题会丢尾部；`deriveTitle` 用完整正文，得到未截断标题。

### 5.4 排序

- `sortNotes` 的 `name-asc` 改为按展示标题排序（`title || name`）；
- 菜单文案「文件名 · A→Z」改为「标题 · A→Z」（中英文，key `sort.nameAsc` 不变）。

### 5.5 开档对话框

避免正文模式下插件操作对话框预填为时间戳文件名：应优先使用 `note.title`，再回退 `note.name`。

### 5.6 模块与一致性

- 浏览器不能 import Host 模块（架构测试约束），所以编辑用纯函数放在 `src/client/reader/title-line.js`：
  - `normalizeTitleMode`、`findTitleLine`、`titleLineFor`、`sanitizeTitleText`、`deriveTitle`、`replaceTitleLine`、`stripTitleLine`；
  - `TITLE_MODES` / `DEFAULT_TITLE_MODE` 只在 `src/client/constants.js` 定义，`title-line.js` 与设置组件都从这里 import（同一浏览器运行环境，允许）；
- 与 `lib/title.js` 用同一组 fixture 做 parity 测试（`test-support/title-parity-fixtures.mjs`），覆盖三种模式、代码围栏、空 H1、marker、空标题、清洗、写回；
- Host 始终是最终权威：客户端只负责草稿编辑，保存后以 Host 返回的 `title` 为准。

## 6. 设置 UI

### 6.1 标签

顺序改为：**文件夹 / 便签 / AI / 管理与关于**。

- 原「图片」标签改名「便签」（`settings.tab.notes`，删除 `settings.tab.images`）；
- 面板设置抽屉与官方设置页（复用同一组件）同步生效；
- 默认打开标签仍是「文件夹」。

### 6.2 「便签」页内容

第一块：**便签标题**

- 块标题 + 一行说明（影响便签墙、阅读面板与新建便签）。
- 一行 3 张等宽大选择卡，容器 `role="radiogroup"` + `aria-label`，卡片 `role="radio"`、`aria-checked`：
  - 上方约 52px 自绘便签纸插画：① 文件名标签贴在纸上；② 正文首行高亮；③ 大号 `#` 与标题高亮；高亮用主题紫，其余线条用弱化墨色；
  - 下方标题：「文件名」「正文首行」「一级标题」；
  - 再下一行 10px 小注，各一句话解释；
  - 选中态：紫色描边 + 浅紫底 + 右上角勾；hover/focus 有轻微边框反馈；
  - 与普通按钮明显区分：更大、竖向布局、带插画与说明；
  - 键盘：`roving tabindex`（选中卡 `tabIndex=0`，其余 `-1`），左右/上下方向键切换模式并移动焦点；`disabled`（保存中）时 `aria-disabled` 且不响应。
- 选 `filename`：卡片下方一行灰色小字，提前告知文件名限制——不能包含 `\ / : * ? " < > | # ^ [ ]` 等字符，最长 240 字节，重名会提示。
- 选 `firstLine` / `heading`：显示「文件名模板」：
  - 受控文本输入，`maxLength={120}`，`disabled` 跟随保存状态；
  - token 按钮 `{title}` `{date}` `{time}` `{timestamp}`，点击插入到光标处（`selectionStart`/`selectionEnd`），插入后恢复光标；
  - 实时预览（用当前时间；`{title}` 用「标题示例」占位），显示**清洗与截断后的** `.md` 文件名；
  - 小字说明：特殊字符会被替换为空格、超过 240 字节自动截断、重名自动加 `-2`、只影响之后新建的便签；空模板按默认 `{date}-{time}` 保存。

第二块：**图片处理**（原「图片」页内容原样下移）

- 自动压缩 WebP、质量、分辨率；
- 图片文件夹路径；
- 现有组件与样式不改，只调整所在标签。

实现文件：

- `src/client/settings/note-title.js`：卡片、插画、提示、模板输入与预览（组件）；
- `src/client/settings/note-title-pattern.js`：纯函数 `expandFileNamePattern` / `sanitizeGeneratedName` / `truncateNoteName` / `resolveFileNamePattern` / `insertPatternToken` / `buildPreviewName` / `nextTitleMode`（无 React、无 DOM，可直接单测）；
- 与 `lib/filename.js` 用同一组 fixture（`test-support/title-pattern-fixtures.mjs`）做 parity 测试。

### 6.3 状态与默认值

- `src/client/constants.js` 新增 `TITLE_MODES`、`DEFAULT_TITLE_MODE`、`FILE_NAME_PATTERN_MAX`（120），并把 `titleMode` / `fileNamePattern` 加入 `EMPTY_SETTINGS`；
- 客户端所有读取（panel、抽屉、复制、开档、设置草稿）缺字段时按 `filename` 处理，与 Host 默认一致；
- 设置草稿继续走 `useSettingsDraft`；打开设置时若 Host 没有新字段，客户端补默认值；
- 切换模式只改草稿，点「保存」后才写入配置并触发重扫；取消恢复原状。

## 7. 错误处理与边界

| 场景 | 行为 |
| --- | --- |
| 旧配置无新字段 | 默认文件名模式，零行为变化 |
| 模板展开后为空 | 回退 `note-{timestamp}`，不阻塞新建 |
| 模板展开后过长 | 在码点边界截断到 240 字节 |
| 模板里全是非法字符 | 清洗后为空 → 回退 |
| 正文模式标题为空（直接 RPC） | `bad-request`；客户端提交按钮已禁用空标题 |
| 正文模式标题超过 200 字符 | 正文行允许完整保留；`NoteSummary` 展示标题截到 200 字符；只有 `{title}` 进入文件名时按 240 字节截断 |
| 正文模式标题清空后保存 | 允许；标题行被删除，保存后按规则重新推导或回退文件名 |
| 正文模式文件名并发重名 | 自动 `-2`…重试，最多 5 次 |
| 文件名模式重名 | 保持现有 `exists` 错误与提示 |
| 模式 2/3 下用户想改文件名 | 面板不提供；进 Obsidian 改名，标题不受影响 |
| 无标题行的正文模式便签 | 标题框为空 + 提示；用户输入标题时才插入标题行 |

## 8. 模块与文件清单

### Host

- 新增 `lib/markdown.js`：`normalizeText` / `stripInline` / `stripBlockIds` / `INVISIBLE_CHARS`；`notes.js` 重新导出前三者。
- 新增 `lib/title.js`：模式常量、模式规范化、标题行定位、标题文字清洗、`titleLineFor`、`stripTitleLine`。
- 新增 `lib/datetime.js`：`formatTemplateMoment`（从 capture 抽出，capture re-export）。
- `lib/filename.js`：模板展开、生成文件名清洗/截断、默认模板常量。
- `lib/settings.js`：新字段默认值与规范化。
- `lib/notes.js`：`parseNote` 接受 `titleMode`，按模式置空标题行、返回派生标题；默认行为不变；改从 `lib/markdown.js` 导入/导出。
- `lib/scan.js`：`scanKey` / `readFull` / 摘要标题按模式分支。
- `lib/host/notes.js`：`endpointCreateNote` 传设置；`toggleTask` 传模式；`readFullNote` 传模式。
- `lib/capture.js`：标题校验分支、标题行、模板文件名、重名重试、Default Template 用实际文件名；`formatTemplateMoment` 改为 re-export。
- `lib/host/note-content.js`：`readFullNote` / `readModelSource` 接受模式。
- `lib/host/ai-jobs.js`：模型输入用派生标题。
- `lib/comments.js` / `lib/host/comments.js`：`removeCommentAt` / `deleteComment` 接受 `titleMode`，按当前展示顺序定位评论。
- `lib/index.js`：`onSettingsChange` 纳入 `titleMode`。
- `lib/shared.js`：`LIMITS.fileNamePatternChars = 120`、`LIMITS.titleChars = 200`。

### Client

- 新增 `src/client/reader/title-line.js`：客户端标题纯函数（见 §5.6）。
- 新增 `src/client/settings/note-title.js`：三卡选择、提示、模板编辑与预览、`TitleModeIcon` 插画。
- 新增 `src/client/settings/note-title-pattern.js`：模板展开/预览/插入/截断纯函数。
- `src/client/settings/settings-drawer.js`：标签顺序/名称，便签页接入新组件。
- `src/client/settings/use-settings-draft.js`：补默认字段。
- `src/client/reader/use-note-editor.js`：标题双向同步、保存不带 name、成功回填、按模式判断脏状态。
- `src/client/reader/note-drawer.js`：标题编辑条件 `maxLength`、i18n aria-label、模式小字提示。
- `src/client/panel.js`：把 `titleMode` 传给抽屉、复制、开档与输入岛。
- `src/client/capture/composer.js`：按模式切换标题 aria-label（`capture.title` / `capture.titleBody`）。
- `src/client/wall/use-note-actions.js`：复制去重。
- `src/client/wall/model.js`：按展示标题排序。
- 表单中的便签名称默认值：优先 `note.title`，再回退 `note.name`。
- `src/client/constants.js`：模式常量、`EMPTY_SETTINGS` 新字段。
- `src/client/i18n/zh.js`、`en.js`：新增设置、模式、模板、提示、排序与编辑提示文案，包括 `drawer.titleAria` / `drawer.titleAriaBody` / `drawer.titleEmptyHint`、`capture.titleBody`。
- `src/client/styles/settings.js`：三卡与模板区样式（沿用主题变量）。
- `src/client/styles/reader.js`：标题来源小字样式。
- `src/client/testing.js`：导出用于测试的纯函数。

### 测试辅助

- 新增 `test-support/title-parity-fixtures.mjs`：Host/Client 标题行为 fixture。
- 新增 `test-support/title-pattern-fixtures.mjs`：文件名模板展开/清洗 fixture。

## 9. 测试计划

- `test/notes/title.test.mjs`（新）：三种模式、frontmatter、BOM、代码围栏、空 H1、无标题回退、标题行不进入 blocks/excerpt、`withRanges` 行号不变、`titleLineFor` 写回、`stripTitleLine`；` ``` `/` ```js `/`~~~`/`***`/`___`/`---` 及其带 `##` 标记的往返、字面量 `\---` 的归一化。
- `test/filename.test.mjs`：模板展开、未识别 token、特殊字符、保留名、240 字节截断、空模板回退、`{title}` 过长、Default Template 文件名。
- `test/settings/normalization.test.mjs`：默认值、非法模式、空模板、超长模板、旧配置升级。
- `test/scan.test.mjs`：模式切换后标题刷新、`name` 不变、摘要标题分支、readFull 用同一模式。
- `test/host/capture.test.mjs`：正文模式写入标题行、模板文件名、重名后缀、Default Template 目录匹配、文件名模式回归、正文模式标题超长不报错。
- `test/host/editing.test.mjs`：正文模式保存不重命名、空标题回退、标题行任务不可勾选；文件名模式回归。
- `test/notes/comments-and-text.test.mjs` / `test/host/comments.test.mjs`：首行 callout 在正文模式里是标题而非评论，删除序号按当前模式定位。
- `test/client/editor.test.mjs`：标题 ↔ 正文双向同步、无标题行插入、清空标题删行、保存 payload 不含 name、成功回填、空标题重新打开。
- `test/client/settings-ui.test.mjs`：四标签顺序与 id、「便签」页、三卡 `role=radio`/radiogroup、方向键切换与 roving tabindex、条件提示、模板预览与 `maxLength`、token 按钮插入、保存中禁用、旧「图片」页不再存在。
- `test/client/wall-rendering.test.mjs` / `note-actions.test.mjs`：按标题排序、复制去重；复制 >200 字符标题时剪贴板包含完整标题（不丢尾部）。
- `test/client/ai.test.mjs`：开档默认名优先展示标题。
- `test/title-parity.test.mjs`（新）：直接 import `lib/title.js` 与 `src/client/reader/title-line.js`，消费 `test-support/title-parity-fixtures.mjs`，逐项比较模式识别、标题文字、marker、写回与 `sanitizeTitleText`（含不可见字符 fixture）。
- `test/client/note-title-pattern.test.mjs`（新）：`expandFileNamePattern` / `sanitizeGeneratedName` / `truncateNoteName` / `resolveFileNamePattern` / `insertPatternToken` / `buildPreviewName` / `nextTitleMode`，并与 `lib/filename.js` 消费同一份 `test-support/title-pattern-fixtures.mjs` 做 parity。
- `test/client/images.test.mjs`：新增 `FILE_NAME_PATTERN_MAX === LIMITS.fileNamePatternChars` 的跨端限额断言。
- `test/architecture.test.mjs`：新文件行数、依赖方向、无环。
- `test/capture.test.mjs`：`lib/datetime.js` 抽出后 `formatTemplateMoment` 行为与旧导出不变；模板 `{{title}}` 替换为正文标题。
- `test/host/editing.test.mjs`：增加 `readModelSource` / `endpointNote` 回退标题（无缓存时）与 `createNote` 正文模式空标题 `bad-request`。
- `test/client/editor.test.mjs`：增加正文模式「只改正文时脏状态 / 取消提示」用例。
- `test/client/settings-draft.test.mjs`：旧 Host 缺少 `titleMode` / `fileNamePattern` 时草稿补默认值。

## 10. 文档与发布

- `package.json` 版本升到 `0.16.8`；
- `docs/CHANGELOG.md` 增加 0.16.8 摘要；
- `docs/CONTRACT.md` 更新：
  - Settings 字段；
  - `NoteSummary.title`（§3.2 附近，当前写死为文件名）；
  - `createNote`（`title` 在正文模式是内容标题）/ `saveNote`（正文模式不发 `name`，不重命名）；
  - 复制约定（当前 `title + '\n' + body`）；
  - 标题规则（当前「标题 = md 文件名」）；
  - 设置标签与排序文案；
  - 新增 0.16.8 行为约定小节；
- `docs/ARCHITECTURE.md` 增加 `lib/markdown.js`、`lib/title.js`、`lib/datetime.js`、`src/client/reader/title-line.js`、`src/client/settings/note-title.js`、`src/client/settings/note-title-pattern.js` 的定位；
- `README.md` / `README.en.md`：标题模式、设置页说明、快速记录与编辑/复制/排序行为；
- 验证顺序：`pnpm install --frozen-lockfile` → `pnpm build` → `pnpm test`。
