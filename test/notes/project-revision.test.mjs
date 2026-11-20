import test from 'node:test'
import assert from 'node:assert/strict'
import { readProjectRevision } from '../../lib/project-revision.js'

const opts = { name: '项目', stamp: '11-21' }
const response = { summary: '  状态未变；\n补充了一项依据。 ', overview: '因[[B|复验失败]]暂停。', entry: '已定位失败原因。' }
const revise = (original, fields = {}) => readProjectRevision(JSON.stringify({ ...response, ...fields }), original, opts)

test('迁移置顶旧进展：由 Host 保留原文、逆序变正序；独立来源、前言和 YAML 不需要模型抄写', () => {
  const prefix = '\uFEFF---\r\nkey: "current"  \r\n...\r\n# 项目\r\n我的前言\n\n'
  const old = prefix + '## 进展 · 11-20\n\n复验失败。来源：[[B]]\n\n## 进展 · 11-19\r\n\r\n通过联调。来源：[[A]]\r\n\r\n## 这是什么\n发布\n\n## 当前进度\n准备上线\n\n## 来源\n- [[S]]'
  const { next, summary } = revise(old)
  assert.ok(next.startsWith(prefix)); assert.ok(next.endsWith('## 来源\n- [[S]]')); assert.ok(!next.includes('准备上线'))
  assert.ok(next.includes('### 进展 · 11-19\r\n\r\n通过联调。来源：[[A]]\r\n\r\n### 进展 · 11-20\n\n复验失败。来源：[[B]]\n\n### 11-21'))
  assert.equal(summary, '状态未变； 补充了一项依据。')
})

test('只替换概况、追加一次历史；保护区含混合行尾/重名章节/围栏/尾空格/无结尾换行时字节不变', () => {
  const lead = '\uFEFF---\r\ntags: x\n---\r\n# 原题\r\n手写前言\n\n'
  const between = '## 手记\r\n```md\n## 当前概况\n```\r\n记  \n\n'
  const history = '## 进展记录\r\n昨日\n  原始缩进\r\n\r\n'
  const end = '## 手记\n保留结尾两个空格  '
  const old = lead + '## 当前概况\r\n旧结论\n' + between + history + end
  assert.equal(revise(old).next, lead + '## 当前概况\r\n\r\n' + response.overview + '\r\n\r\n' + between + history + '### 11-21\r\n\r\n' + response.entry + '\r\n\r\n' + end)
})

test('Host 只组装容器，不补写来源、不换别名、不强制链接数量', () => {
  for (const overview of ['只补充了观察，现状未变。', '详见[[资料/计划|第一版计划]]和[[资料/验收|实际结果]]。']) {
    assert.equal(revise(null, { overview }).next, `# 项目\n\n## 当前概况\n\n${overview}\n\n## 进展记录\n\n### 11-21\n\n${response.entry}\n`)
  }
})

test('片段可用三级标题、代码示例；空字段、未闭合围栏、越过章节边界或旧稿重复概况拒写', () => {
  const r = revise(null, { overview: '### 依据\n```md\n## 示例\n```\n下一步' })
  assert.ok(r.next.includes('## 示例'))
  for (const fields of [{ entry: '' }, { overview: null }, { summary: ' ' }, { overview: '### 仍合法\n## 我的手记' }, { entry: '```md\n未闭合' }]) {
    assert.throws(() => revise(null, fields), { code: 'project-revision-invalid' })
  }
  assert.throws(() => revise(r.next + '\n## 当前概况\n又一份'), { code: 'project-revision-invalid' })
})

test('模型重复宿主容器标题时归一化；只剥离开头精确的标题，独立章节仍拒写', () => {
  const wrapped = revise(null, { overview: '## 当前概况\n\n新的现状。', entry: '## 进展记录\n\n本次进展。' })
  assert.equal(wrapped.next, '# 项目\n\n## 当前概况\n\n新的现状。\n\n## 进展记录\n\n### 11-21\n\n本次进展。\n')

  const titled = revise(null, { overview: '# 项目\n\n## 当前概况\n\n新的现状。' })
  assert.equal(titled.next, '# 项目\n\n## 当前概况\n\n新的现状。\n\n## 进展记录\n\n### 11-21\n\n' + response.entry + '\n')

  const stamped = revise(null, { entry: '### 11-21\n\n本次进展。' })
  assert.equal(stamped.next, '# 项目\n\n## 当前概况\n\n' + response.overview + '\n\n## 进展记录\n\n### 11-21\n\n本次进展。\n')

  for (const fields of [
    { overview: '## 我的手记\n\n不该出现。' },
    { overview: '## 当前概况\n\n现状。\n\n## 我的手记\n\n不该出现。' },
    { overview: '# 别的项目\n\n现状。' },
    { entry: '## 我的手记\n\n不该出现。' },
  ]) assert.throws(() => revise(null, fields), { code: 'project-revision-invalid' })

  const old = '# 项目\n\n## 当前概况\n\n旧现状\n\n## 进展记录\n\n### 11-20\n\n旧记录\n\n## 我的手记\n\n不动。\n'
  const updated = revise(old, { overview: '## 当前概况\r\n\r\n新现状。', entry: '## 进展记录\r\n\r\n本次。' })
  assert.ok(updated.next.startsWith('# 项目\n\n## 当前概况\n\n新现状。'))
  assert.ok(updated.next.includes('## 我的手记\n\n不动。'))
})
