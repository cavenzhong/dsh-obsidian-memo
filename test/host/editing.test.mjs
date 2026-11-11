/** host: editing regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LIMITS } from '../../lib/shared.js'
import { caseInsensitiveFilesystem, exists, makeCase, saveNote, waitForJob } from '../../test-support/host.mjs'

test('saveNote：旧编辑版本不能覆盖后追加的 AI 评论，失败时文件不变', async () => {
  const c = await makeCase({ notes: { '甲.md': '原文\n' } })
  const path = c.seeded['甲.md']
  const opened = (await c.call('note', { path })).value
  const settings = (await c.call('state')).value.settings
  const started = await c.call('comment', { path, emojiId: settings.emojis[0].id })
  assert.equal((await waitForJob(c.call, started.value.jobId)).status, 'done')
  const before = await readFile(path, 'utf8')
  const saved = await c.call('saveNote', { path, body: opened.body + '新草稿', expectedRevision: opened.contentRevision })
  assert.equal(saved.error.code, 'conflict')
  assert.equal(await readFile(path, 'utf8'), before)
})

test('saveNote：同一版本并发保存只接受一次，缺版本拒绝写入', async () => {
  const c = await makeCase({ notes: { '甲.md': '原文\n' } })
  const path = c.seeded['甲.md']
  const opened = (await c.call('note', { path })).value
  const missing = await c.call('saveNote', { path, body: '没有版本的草稿' })
  assert.equal(missing.error.code, 'conflict')
  const results = await Promise.all(['甲草稿', '乙草稿'].map((body) => c.call('saveNote', { path, body, expectedRevision: opened.contentRevision })))
  assert.equal(results.filter((result) => result.ok).length, 1)
  assert.equal(results.filter((result) => result.error?.code === 'conflict').length, 1)
})

test('saveNote：只替换正文，frontmatter 原样保留并补结尾换行', async () => {
  const c = await makeCase({
    notes: {
      '保存.md': '---\nPROJECTS: "[[项目/甲|甲]]"\ntags: x\n---\n\n# 旧标题\n\n旧正文\n',
    },
  })
  const notePath = c.seeded['保存.md']
  const before = await c.call('state')

  const result = await saveNote(c, { path: notePath, body: '# 新标题\n\n新正文' })
  assert.equal(result.ok, true)
  assert.equal(result.value.note.path, notePath)
  assert.equal(result.value.note.title, '保存')
  assert.match(result.value.note.excerpt, /新标题/)
  assert.match(result.value.note.excerpt, /新正文/)
  assert.equal(result.value.note.excerpt.includes('旧正文'), false)

  const content = await readFile(notePath, 'utf8')
  assert.equal(content, '---\nPROJECTS: "[[项目/甲|甲]]"\ntags: x\n---\n\n# 新标题\n\n新正文\n')
  // frontmatter 逐字节保留
  assert.ok(content.startsWith('---\nPROJECTS: "[[项目/甲|甲]]"\ntags: x\n---\n'))

  const after = await c.call('state')
  assert.notEqual(after.value.revision, before.value.revision)
  assert.match(after.value.notes[0].excerpt, /新正文/)

  const full = await c.call('note', { path: notePath })
  assert.equal(full.ok, true)
  assert.equal(full.value.body, '# 新标题\n\n新正文\n')
  assert.equal(full.value.blocks[0].text, '新标题')
})

test('saveNote：正文规范化（去首尾空白、CRLF → LF）', async () => {
  const c = await makeCase({ notes: { '规范.md': '---\nfoo: 1\n---\n\n旧正文\n' } })
  const notePath = c.seeded['规范.md']

  const result = await saveNote(c, {
    path: notePath,
    body: '\r\n\r\n新正文一段  \r\n\r\n第二段\r\n\r\n',
  })
  assert.equal(result.ok, true)
  // CRLF → LF、去掉整段开头的空行与结尾空白；行内的空格原样保留
  assert.equal(await readFile(notePath, 'utf8'), '---\nfoo: 1\n---\n\n新正文一段  \n\n第二段\n')
})

test('saveNote：空正文只留 frontmatter', async () => {
  const c = await makeCase({ notes: { '清空.md': '---\nPROJECTS: "[[x|X]]"\n---\n\n# 旧\n\n旧正文\n' } })
  const notePath = c.seeded['清空.md']

  const result = await saveNote(c, { path: notePath, body: '' })
  assert.equal(result.ok, true)
  assert.equal(result.value.note.excerpt, '')
  assert.equal(await readFile(notePath, 'utf8'), '---\nPROJECTS: "[[x|X]]"\n---\n')

  const full = await c.call('note', { path: notePath })
  assert.equal(full.value.body, '')
  assert.deepEqual(full.value.blocks, [])
  const state = await c.call('state')
  assert.equal(state.value.notes[0].excerpt, '')
})

test('saveNote：没有 frontmatter 的便签直接写正文（不新建 frontmatter）', async () => {
  const c = await makeCase({ notes: { '裸.md': '# 旧\n\n旧正文\n' } })
  const notePath = c.seeded['裸.md']

  const result = await saveNote(c, { path: notePath, body: '新正文' })
  assert.equal(result.ok, true)
  assert.equal(await readFile(notePath, 'utf8'), '新正文\n')

  // 空正文 + 无 frontmatter → 空文件
  const cleared = await saveNote(c, { path: notePath, body: '' })
  assert.equal(cleared.ok, true)
  assert.equal(await readFile(notePath, 'utf8'), '')
})

test('saveNote：BOM 保留', async () => {
  const c = await makeCase({ notes: { 'BOM.md': '\uFEFF---\nfoo: 1\n---\n\n旧正文\n' } })
  const notePath = c.seeded['BOM.md']

  const result = await saveNote(c, { path: notePath, body: '新正文' })
  assert.equal(result.ok, true)
  const content = await readFile(notePath, 'utf8')
  assert.equal(content.startsWith('\uFEFF---'), true)
  assert.match(content, /新正文\n$/)
})

test('saveNote：同一次保存同时改文件名和正文', async () => {
  const c = await makeCase({ notes: { '旧名.md': '---\nkeep: true\n---\n\n旧正文\n' } })
  const result = await saveNote(c, { path: c.seeded['旧名.md'], name: '新名', body: '新正文' })
  assert.equal(result.ok, true)
  assert.equal(result.value.note.path, join(c.notesDir, '新名.md'))
  assert.equal(await readFile(join(c.notesDir, '新名.md'), 'utf8'), '---\nkeep: true\n---\n\n新正文\n')
  assert.equal(await exists(c.seeded['旧名.md']), false)
})

test('saveNote：保留原有长文件名与大写扩展名；重名失败不写入正文', async () => {
  const filename = `${'a'.repeat(70)}.MD`
  const c = await makeCase({ notes: { [filename]: '原正文\n', 'existing.md': '保留\n' } })
  const path = c.seeded[filename]
  const saved = await saveNote(c, { path, name: 'a'.repeat(70), body: '新正文' })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.note.path, path)
  const conflict = await saveNote(c, { path, name: 'existing', body: '不应保存' })
  assert.equal(conflict.error.code, 'exists')
  assert.equal(await readFile(path, 'utf8'), '新正文\n')
  assert.equal(await readFile(join(c.notesDir, 'existing.md'), 'utf8'), '保留\n')
})

test('saveNote：改名与新建共用文件名规则（保留名/超长拒绝，特殊字符清洗）', async () => {
  const c = await makeCase({ notes: { '甲.md': '原文\n' } })
  const path = c.seeded['甲.md']
  for (const name of ['CON', '字'.repeat(81)]) {
    const result = await saveNote(c, { path, name, body: '不应保存' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'bad-request')
  }
  assert.equal(await readFile(path, 'utf8'), '原文\n')
  const saved = await saveNote(c, { path, name: '  a/b  ', body: '新正文' })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal(saved.value.note.path, join(c.notesDir, 'a b.md'))
})

test('saveNote：仅大小写改名应允许（大小写不敏感文件系统）', async (t) => {
  if (!(await caseInsensitiveFilesystem())) {
    t.skip('当前文件系统大小写敏感，跳过仅大小写改名用例')
    return
  }
  const c = await makeCase({ notes: { 'Case.md': '---\nkeep: true\n---\n\n原正文\n' } })
  const originalPath = c.seeded['Case.md']
  const before = await c.call('state')
  assert.equal(before.value.notes.length, 1)
  assert.equal(before.value.notes[0].name, 'Case')

  // 目标文件在大小写不敏感文件系统上会命中自己：realpath 相同则应允许，而不是误报 exists
  const result = await saveNote(c, { path: originalPath, name: 'CASE', body: '新正文' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.note.path, join(c.notesDir, 'CASE.md'))
  assert.equal(result.value.note.name, 'CASE')

  // 目录项确实改名（大小写保留），且没有留下第二份文件
  const entries = await readdir(c.notesDir)
  assert.equal(entries.filter((name) => name.toLowerCase() === 'case.md').length, 1, entries.join(','))
  assert.ok(entries.includes('CASE.md'), `目录项应为 CASE.md：${entries.join(',')}`)
  assert.equal(
    await readFile(join(c.notesDir, 'CASE.md'), 'utf8'),
    '---\nkeep: true\n---\n\n新正文\n',
  )

  // 改名后 state / note 均指向新路径
  const after = await c.call('state')
  assert.equal(after.value.notes.length, 1)
  assert.equal(after.value.notes[0].path, join(c.notesDir, 'CASE.md'))
  assert.equal(after.value.notes[0].name, 'CASE')
  const full = await c.call('note', { path: join(c.notesDir, 'CASE.md') })
  assert.equal(full.ok, true)
  assert.equal(full.value.body, '新正文\n')
})

test('toggleTask：无 frontmatter 的首行任务保留 BOM', async () => {
  const original = '\uFEFF- [ ] 首行\r\n'
  const c = await makeCase({ notes: { '首行.md': original } })
  const path = c.seeded['首行.md']
  const note = (await c.call('note', { path })).value
  const result = await c.call('toggleTask', { path, sourceLine: 0, checked: true, expectedBody: note.body })
  assert.equal(result.ok, true)
  assert.equal(await readFile(path, 'utf8'), original.replace('[ ]', '[x]'))
})

test('toggleTask：只改任务标记，保留 BOM、CRLF 和 frontmatter，可取消勾选', async () => {
  const original = '\uFEFF---\r\nkeep: true\r\n---\r\n\r\n- [ ] 任务\r\n\r\n正文\r\n'
  const c = await makeCase({ notes: { '任务.md': original } })
  const path = c.seeded['任务.md']
  let note = (await c.call('note', { path })).value
  const sourceLine = note.blocks.find((block) => block.kind === 'li').sourceLine
  const checked = await c.call('toggleTask', { path, sourceLine, checked: true, expectedBody: note.body })
  assert.equal(checked.ok, true)
  assert.equal(await readFile(path, 'utf8'), original.replace('[ ]', '[x]'))
  note = (await c.call('note', { path })).value
  assert.equal(note.blocks.find((block) => block.kind === 'li').checked, true)
  const unchecked = await c.call('toggleTask', { path, sourceLine, checked: false, expectedBody: note.body })
  assert.equal(unchecked.ok, true)
  assert.equal(await readFile(path, 'utf8'), original)
})

test('toggleTask：拒绝旧内容和代码块，不覆盖外部变更', async () => {
  const c = await makeCase({ notes: { '任务.md': '- [ ] 原任务\n\n```md\n- [ ] 示例\n```\n' } })
  const path = c.seeded['任务.md']
  const note = (await c.call('note', { path })).value
  const codeTask = await c.call('toggleTask', { path, sourceLine: 3, checked: true, expectedBody: note.body })
  assert.equal(codeTask.error.code, 'bad-request')
  const changed = '- [ ] 外部新增\n' + note.body
  await writeFile(path, changed)
  const stale = await c.call('toggleTask', { path, sourceLine: 0, checked: true, expectedBody: note.body })
  assert.equal(stale.error.code, 'conflict')
  assert.equal(await readFile(path, 'utf8'), changed)
})

test('toggleTask：并发提交旧版本时只接受第一次变更', async () => {
  const c = await makeCase({ notes: { '任务.md': '- [ ] 一\n- [ ] 二\n' } })
  const path = c.seeded['任务.md']
  const { body } = (await c.call('note', { path })).value
  const results = await Promise.all([0, 1].map((sourceLine) => c.call('toggleTask', { path, sourceLine, checked: true, expectedBody: body })))
  assert.equal(results.filter((result) => result.ok).length, 1)
  assert.equal(results.filter((result) => result.error?.code === 'conflict').length, 1)
})

test('saveNote：缺 body / body 非字符串 / 正文过大 → bad-request', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n\n原文\n' } })
  const notePath = c.seeded['甲.md']
  const before = await readFile(notePath, 'utf8')

  for (const payload of [{ path: notePath }, { path: notePath, body: 123 }, { path: notePath, body: null }]) {
    const result = await saveNote(c, payload)
    assert.equal(result.ok, false, `payload ${JSON.stringify(payload)} 应被拒绝`)
    assert.equal(result.error.code, 'bad-request')
  }

  const full = (await c.call('note', { path: c.seeded['甲.md'] })).value
  const oversized = await c.call('saveNote', { path: full.path, body: 'x'.repeat(LIMITS.maxFileBytes + 1), expectedRevision: full.contentRevision })
  assert.equal(oversized.ok, false)
  assert.equal(oversized.error.code, 'bad-request')
  assert.equal(await readFile(notePath, 'utf8'), before)
})
