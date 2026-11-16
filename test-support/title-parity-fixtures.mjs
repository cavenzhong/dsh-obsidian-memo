/** Host (lib/title.js) 与 Client (src/client/reader/title-line.js) 共用的标题行为 fixture。 */

const FENCE = '```'
const TILDE = '~~~'

export const TITLE_CASES = [
  // filename 模式不解析正文
  { mode: 'filename', body: '随便\n\n正文', title: '', index: -1, marker: '' },
  // firstLine：普通首行 / 前导空行 / 行内记号 / ATX
  { mode: 'firstLine', body: '想法一\n\n细节', title: '想法一', index: 0, marker: '' },
  { mode: 'firstLine', body: '\n\n 想法一 \n细节', title: '想法一', index: 2, marker: '' },
  { mode: 'firstLine', body: '**加粗** 和 [[链接|别名]]\n细节', title: '加粗 和 别名', index: 0, marker: '' },
  { mode: 'firstLine', body: '## 二级标题\n细节', title: '二级标题', index: 0, marker: '##' },
  { mode: 'firstLine', body: '# 一级标题\n细节', title: '一级标题', index: 0, marker: '#' },
  // firstLine：结构行 / 图片 / 空文字 → 取不到标题
  { mode: 'firstLine', body: `${FENCE}js\nx\n${FENCE}`, title: '', index: -1, marker: '' },
  { mode: 'firstLine', body: `${TILDE}\nx\n${TILDE}`, title: '', index: -1, marker: '' },
  { mode: 'firstLine', body: '---\n正文', title: '', index: -1, marker: '' },
  { mode: 'firstLine', body: '***\n正文', title: '', index: -1, marker: '' },
  { mode: 'firstLine', body: '___\n正文', title: '', index: -1, marker: '' },
  { mode: 'firstLine', body: '![[image.png]]\n正文', title: '', index: -1, marker: '' },
  // firstLine：写回时的反斜杠转义
  { mode: 'firstLine', body: '\\```js\n正文', title: '```js', index: 0, marker: '' },
  { mode: 'firstLine', body: '\\---\n正文', title: '---', index: 0, marker: '' },
  { mode: 'firstLine', body: '## \\```\n正文', title: '```', index: 0, marker: '##' },
  // heading：跳过代码围栏 / 忽略非一级标题 / 空标题继续找
  { mode: 'heading', body: '# 真标题\n\n正文', title: '真标题', index: 0, marker: '#' },
  { mode: 'heading', body: `${FENCE}\n# 代码里\n${FENCE}\n## 二级\n# 真标题`, title: '真标题', index: 4, marker: '#' },
  { mode: 'heading', body: '#\n# 真正的\n正文', title: '真正的', index: 1, marker: '#' },
  { mode: 'heading', body: '## 只有二级\n正文', title: '', index: -1, marker: '' },
  { mode: 'heading', body: '没有标题\n正文', title: '', index: -1, marker: '' },
  { mode: 'heading', body: `${TILDE}md\n# 代码里\n${TILDE}\n# 外面`, title: '外面', index: 3, marker: '#' },
  { mode: 'heading', body: '# \\```\n正文', title: '```', index: 0, marker: '#' },
  { mode: 'heading', body: '````md\n```\n# 示例\n````\n# 真标题', title: '真标题', index: 4, marker: '#' },
  { mode: 'heading', body: '```md\n```js\n# 示例\n```\n# 真标题', title: '真标题', index: 4, marker: '#' },
  { mode: 'heading', body: '~~~~md\n~~~\n# 示例\n~~~~~\n# 真标题', title: '真标题', index: 4, marker: '#' },
  { mode: 'heading', body: '```\n~~~\n# 示例\n```\n# 真标题', title: '真标题', index: 4, marker: '#' },
  { mode: 'heading', body: '````md\n```\n# 未闭合的示例', title: '', index: -1, marker: '' },
  { mode: 'heading', body: '    # 缩进代码\n# 真标题', title: '真标题', index: 1, marker: '#' },
]

export const SANITIZE_CASES = [
  ['  前后空白  ', '前后空白'],
  ['a\u200bb\u202ec\u0000', 'abc'],
  ['第一行\n第二行', '第一行 第二行'],
  ['**保留记号**', '**保留记号**'],
  ['a\r\nb', 'a b'],
  ['', ''],
  [null, ''],
]

export const WRITE_CASES = [
  { mode: 'firstLine', title: '普通标题', marker: '', line: '普通标题', expect: '普通标题' },
  { mode: 'firstLine', title: '  普通标题  ', marker: '', line: '普通标题', expect: '普通标题' },
  { mode: 'firstLine', title: '二级', marker: '##', line: '## 二级', expect: '二级' },
  { mode: 'firstLine', title: '# 一级', marker: '##', line: '# 一级', expect: '一级' },
  { mode: 'firstLine', title: '```js', marker: '', line: '\\```js', expect: '```js' },
  { mode: 'firstLine', title: '---', marker: '', line: '\\---', expect: '---' },
  { mode: 'firstLine', title: '```', marker: '##', line: '## \\```', expect: '```' },
  { mode: 'heading', title: '一级', marker: '', line: '# 一级', expect: '一级' },
  { mode: 'heading', title: '---', marker: '', line: '# \\---', expect: '---' },
  { mode: 'heading', title: '```', marker: '', line: '# \\```', expect: '```' },
  { mode: 'firstLine', title: '', marker: '', line: '', expect: '' },
  { mode: 'heading', title: '', marker: '', line: '', expect: '' },
]
