# 0.16.8 便签标题模式 · 设计稿

- 状态：已与用户确认方向，待 spec 审查
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
  - `fileNamePattern` 去首尾空白、去 NUL；空串 → 默认值；最多 120 个字符（超出截断）。
- 工厂默认值写入 `DEFAULT_SETTINGS`；`portableSettings`、`settingsEqual`、配置指纹沿用现有通用逻辑。

### 2.2 切换模式的影响

- `titleMode` 变化会让扫描缓存失效（`scanKey` 包含模式），并触发整库重新解析；已有文件内容不改、文件名不改。
- `fileNamePattern` 只影响**之后新建**的便签，不影响已有文件。

## 3. 标题推导（Host）

新增 `lib/title.js`（`lib/notes.js` 已 458 行，接近 500 行上限），纯函数、无 IO：

```js
export const TITLE_MODES = ['filename', 'firstLine', 'heading']
export const DEFAULT_TITLE_MODE = 'filename'
export function normalizeTitleMode(value)                 // 非法 → 'filename'
export function findTitleLine(lines, mode)                // → { title, index, marker }
export function sanitizeTitleText(value)                  // 正文标题写回前的清洗
```

约定：

- `lines` 是去掉 frontmatter、去 BOM、统一 `\n` 后的正文行数组；
- `mode === 'filename'` 时返回 `{ title: '', index: -1, marker: '' }`，正文一首行不特殊处理。

### 3.1 三种模式

| 模式 | 标题 | 识别规则 |
| --- | --- | --- |
| `filename` | 文件名 | 不解析正文，保留现有行为 |
| `firstLine` | 正文第一个非空行 | `trim()` 后非空；若是 ATX 标题行则取标题文字；行内 Markdown 记号去掉 |
| `heading` | 正文第一个一级标题 | `/^ {0,3}#\s+(.+)$/`，跳过代码围栏内的行；标题文字去行内记号 |

- `firstLine` 第一行是代码围栏（``` / ~~~）时按「取不到标题」处理，避免标题变成反引号。
- `heading` 遇到空的一级标题（只有 `#`）继续找下一个带文字的一级标题。
- 取不到标题：`title = ''`，由调用方回退文件名。**任何模式下标题都不会为空**。
- `marker` 是标题行原有的 ATX 前缀（如 `##`），仅用于客户端编辑时保留格式；取不到标题时为 `''`。

### 3.2 不重复渲染标题行

阅读视图里标题已经显示在抽屉顶部，正文不再重复显示同一行：

- `parseNote(text, { titleMode })` 在解析 blocks / excerpt 之前，把标题行在行数组里**置为空字符串**；
- 行数不变，`withRanges` 的评论行号仍与源文件对齐（评论删除依赖行号）；
- 只有 `title` 非空且 `index >= 0` 时才置空；
- `titleMode` 缺省仍是 `'filename'`，`parseNote` 的旧标题行为（第一个 h/p 块）保持不变，老测试不受影响。

`parseNote` 返回的 `title`：

- `filename` 模式：沿用旧逻辑（第一个 h/p 块文字），由扫描层用文件名覆盖；
- 正文模式：`findTitleLine` 的结果（可能为 `''`）。

### 3.3 扫描与读取

- `NotesScanner.scan(settings)` 读取 `settings.titleMode`，写入 `scanKey`（`vault\0notes\0subfolders\0titleMode`），并传入 `parseNote`；
- `NotesScanner` 记住当前 `titleMode`，`readFull()` 重解析时使用同一个模式；`reset()` 恢复默认；
- `buildSummary` 的 `title = parsed.title || entry.name`；`name` 始终是文件名；
- `readFullNote(filePath, titleMode)` 与 `readModelSource(filePath, titleMode)` 同样派生标题并回退文件名；
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

- `filename`：与现在完全一致（文件名 = 清洗后的标题；重名报 `exists`；不写标题行）。
- `firstLine`：标题行 = 标题纯文本（保留用户输入的多行中的换行已折叠为空格）。
- `heading`：标题行 = `# 标题`。
- 正文标题不清洗 Markdown 记号以外的东西，不截断；只去掉换行、控制字符与首尾空白。

### 4.1 文件名模板

```js
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

### 4.2 重名

- 正文模式：先选一个不存在的名字；发布时若仍 `EEXIST`（并发），重新选 `-2`、`-3`… 再试，最多 5 次；仍失败才返回 `exists`。
- 后缀在 240 字节上限内拼接。
- `filename` 模式不自动加后缀，保持「同名便签已存在」的提示。

### 4.3 Default Template 兼容

- 目录模板匹配用**实际生成的文件名**（`{原目录}/{fileStem}.md`），不是正文标题；
- frontmatter 的 `{{title}}` 仍替换为正文标题（用户可读的标题）。

## 5. 阅读、编辑、复制、排序（Client）

### 5.1 阅读态

- 抽屉标题仍用 Host 下发的 `title`；正文 blocks 已不含标题行。
- 卡片标题、排序键使用 `title`（`title || name`），文件名模式下与现在相同。

### 5.2 编辑态（用户选定方案 B）

编辑抽屉仍是「标题 textarea + 正文 textarea」：

- 进入编辑：`bodyDraft = full.body`，`titleDraft = full.title || full.name`，并记录本次编辑使用的 `titleMode`；
- 改标题框：实时把正文草稿里的标题行替换为新标题（heading 模式写 `# 标题`；firstLine 模式保留原行的 ATX 标记，没有标记则写纯文本）；
- 改正文：实时从正文草稿反推标题，更新标题框；
- 本来没有标题行：**只有用户实际改动标题框时**才在正文最前面插入标题行，打开编辑不会自动改文件；
- 正文里删掉标题行：标题框清空，保存后按「取不到标题」回退文件名，不报错；
- 正文模式保存：只发 `body` + `expectedRevision`，**不发 `name`**，不重命名文件；标题清空也允许保存；
- 文件名模式：完全保持现有行为（标题即文件名，可改名，空标题拦截）；
- 保存成功后标题框取 `savedNote.title`（正文模式）或 `savedNote.name`（文件名模式）；
- 编辑态在标题框下方显示一行小字：`标题保存在正文第一行` / `标题保存在正文第一个一级标题`（仅正文模式）。

### 5.3 复制全文

- 文件名模式：`title + '\n' + body`（现状）。
- 正文模式：`title + '\n' + 去掉标题行的 body`，避免标题出现两遍。

### 5.4 排序

- `sortNotes` 的 `name-asc` 改为按展示标题排序（`title || name`）；
- 菜单文案「文件名 · A→Z」改为「标题 · A→Z」（中英文）。

### 5.5 边界

- 浏览器不能 import Host 模块（架构测试约束），所以编辑用纯函数放在 `src/client/reader/title-line.js`，与 `lib/title.js` 行为一致；
- 两份实现用同一组 fixture 做 parity 测试（同一输入、同一模式、同一标题行定位与标题文字）；
- Host 始终是最终权威：客户端只负责草稿编辑，保存后以 Host 返回的 `title` 为准。

## 6. 设置 UI

### 6.1 标签

顺序改为：**文件夹 / 便签 / AI / 管理与关于**。

- 原「图片」标签改名「便签」（`settings.tab.notes`）；
- 面板设置抽屉与官方设置页（复用同一组件）同步生效；
- 默认打开标签仍是「文件夹」。

### 6.2 「便签」页内容

第一块：**便签标题**

- 块标题 + 一行说明（影响便签墙、阅读面板与新建便签）。
- 一行 3 张等宽大选择卡（`role="radio"`，`aria-checked`）：
  - 上方约 52px 自绘便签纸插画：① 文件名标签贴在纸上；② 正文首行高亮；③ 大号 `#` 与标题高亮；高亮用主题紫，其余线条用弱化墨色；
  - 下方标题：「文件名」「正文首行」「一级标题」；
  - 再下一行 10px 小注，各一句话解释；
  - 选中态：紫色描边 + 浅紫底 + 右上角勾；hover/focus 有轻微边框反馈；
  - 与普通按钮明显区分：更大、竖向布局、带插画与说明。
- 选 `filename`：卡片下方一行灰色小字，提前告知文件名限制——不能包含 `\ / : * ? " < > | # ^ [ ]` 等字符，最长 240 字节，重名会提示。
- 选 `firstLine` / `heading`：显示「文件名模板」：
  - 文本输入框（受控，绑定 `fileNamePattern`）；
  - token 按钮：`{title}` `{date}` `{time}` `{timestamp}`，点击插入到光标处；
  - 实时预览（用当前时间；`{title}` 用「标题示例」占位），格式 `2026-11-13-1924.md`；
  - 小字说明：特殊字符会被替换为空格、超过 240 字节自动截断、重名自动加 `-2`、只影响之后新建的便签。

第二块：**图片处理**（原「图片」页内容原样下移）

- 自动压缩 WebP、质量、分辨率；
- 图片文件夹路径；
- 现有组件与样式不改，只调整所在标签。

### 6.3 状态与草稿

- 设置草稿继续走 `useSettingsDraft`；新增字段在保存时整份回传，旧 Host 不认识也没关系（当前版本 Host 会保存并返回）。
- 打开设置时若 Host 没有 `titleMode` / `fileNamePattern`，客户端补默认值，保证控件可编辑。
- 切换模式只改草稿，点「保存」后才写入配置并触发重扫；取消恢复原状。

## 7. 错误处理

| 场景 | 行为 |
| --- | --- |
| 旧配置无新字段 | 默认文件名模式，零行为变化 |
| 模板展开后为空 | 回退 `note-{timestamp}`，不阻塞新建 |
| 模板展开后过长 | 在码点边界截断到 240 字节 |
| 模板里全是非法字符 | 清洗后为空 → 回退 |
| 正文模式标题为空 | 允许保存；展示回退文件名 |
| 正文模式文件名并发重名 | 自动 `-2`…重试，最多 5 次 |
| 文件名模式重名 | 保持现有 `exists` 错误与提示 |
| 模式 2/3 下用户想改文件名 | 面板不提供；进 Obsidian 改名，标题不受影响 |

## 8. 模块与文件清单

### Host

- 新增 `lib/title.js`：模式常量、模式规范化、标题行定位、标题文字清洗。
- 新增 `lib/datetime.js`：从 `lib/capture.js` 抽出 `formatTemplateMoment`（capture 继续 re-export，保持旧导出）。
- `lib/filename.js`：模板展开、生成文件名清洗/截断、默认模板常量。
- `lib/settings.js`：新字段默认值与规范化。
- `lib/notes.js`：`parseNote` 接受 `titleMode`，按模式置空标题行、返回派生标题；默认行为不变。
- `lib/scan.js`：`scanKey` / `readFull` / 摘要标题。
- `lib/host/scanning.js`：无逻辑变化（`getSettings()` 已传入 scanner）。
- `lib/host/notes.js`：`endpointCreateNote` 传设置；`toggleTask` 传模式；`readFullNote` 传模式。
- `lib/capture.js`：正文模式内容组装、标题行、模板文件名、重名重试、Default Template 用实际文件名。
- `lib/host/note-content.js`：`readFullNote` / `readModelSource` 接受模式。
- `lib/host/ai-jobs.js`：模型输入用派生标题。
- `lib/index.js`：`onSettingsChange` 纳入 `titleMode`。

### Client

- 新增 `src/client/reader/title-line.js`：与 Host 一致的标题行定位、标题推导、写回、去掉标题行。
- 新增 `src/client/settings/note-title.js`：三卡选择、提示、模板编辑与预览、`TitleModeIcon` 插画（也可放 icons.js，组件内收）。
- `src/client/settings/settings-drawer.js`：标签顺序/名称，便签页接入新组件。
- `src/client/settings/use-settings-draft.js`：补默认字段。
- `src/client/reader/use-note-editor.js`：标题双向同步、保存不带 name、成功回填。
- `src/client/reader/note-drawer.js`：编辑态小字提示。
- `src/client/panel.js`：把 `titleMode` 传给抽屉与复制。
- `src/client/wall/use-note-actions.js`：复制去重。
- `src/client/wall/model.js`：按展示标题排序。
- `src/client/constants.js`：排序文案键不变；如需新增模式常量放这里。
- `src/client/i18n/zh.js`、`en.js`：新增设置、模式、模板、提示、排序与编辑提示文案。
- `src/client/styles/settings.js`：三卡与模板区样式（沿用主题变量）。
- `src/client/testing.js`：导出用于测试的纯函数。

## 9. 测试计划

- `test/notes/title.test.mjs`（新）：三种模式、frontmatter、BOM、代码围栏、空 H1、回退、标题行不进入 blocks/excerpt、`withRanges` 行号不变。
- `test/filename.test.mjs`：模板展开、未识别 token、特殊字符、保留名、240 字节截断、空模板回退、Default Template 文件名。
- `test/settings/normalization.test.mjs`：默认值、非法模式、空模板、超长模板、旧配置升级。
- `test/scan.test.mjs`：模式切换后标题刷新、`name` 不变、摘要标题、readFull 用同一模式。
- `test/host/capture.test.mjs`：正文模式写入标题行、模板文件名、重名后缀、Default Template 目录匹配、文件名模式回归。
- `test/host/editing.test.mjs`：正文模式保存不重命名、空标题回退；文件名模式回归。
- `test/client/editor.test.mjs`：标题 ↔ 正文双向同步、无标题行插入、保存 payload 不含 name、成功回填。
- `test/client/settings-ui.test.mjs`：四标签顺序、「便签」页、三卡 `role=radio`、条件提示、模板预览、旧「图片」页不再存在。
- `test/client/wall-rendering.test.mjs` / `note-actions`：按标题排序、复制去重。
- `test/architecture.test.mjs`：新文件行数、依赖方向、无环。

## 10. 文档与发布

- `package.json` 版本升到 `0.16.8`；
- `docs/CHANGELOG.md` 增加 0.16.8 摘要；
- `docs/CONTRACT.md` 更新 Settings、NoteSummary.title、`createNote`/`saveNote` 行为、设置标签与标题规则；
- `docs/ARCHITECTURE.md` 增加 `lib/title.js`、`lib/datetime.js`、`src/client/reader/title-line.js`、`src/client/settings/note-title.js` 的定位；
- `README.md` / `README.en.md` 更新标题模式与设置说明；
- 验证顺序：`pnpm install --frozen-lockfile` → `pnpm build` → `pnpm test`。
