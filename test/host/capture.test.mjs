/** host: capture regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeCase } from '../../test-support/host.mjs'

test('createNote：已认证 RPC 支持超过 2 MB 的图片请求，返回摘要并可阅读附件', async () => {
  const c = await makeCase()
  const bytes = Buffer.alloc(2 * 1024 * 1024)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes)
  const created = await c.call('createNote', { title: '快速记录', body: '一点细节', images: [{ dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }] })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(created.value.note.title, '快速记录')
  assert.equal(created.value.note.imageCount, 1)
  const image = created.value.note.images[0]
  const loaded = await c.call('readImage', { path: created.value.path, ...image })
  assert.equal(loaded.ok, true)
  assert.equal(Buffer.from(loaded.value.dataUrl.split(',')[1], 'base64').length, bytes.length)
  const state = await c.call('state', {})
  assert.equal(state.value.notes.length, 1)
  const duplicate = await c.call('createNote', { title: '快速记录', body: '覆盖' })
  assert.equal(duplicate.error.code, 'exists')
  const full = await c.call('note', { path: created.value.path })
  assert.match(full.value.body, /^一点细节/)
})

// 0.16.8：标题在正文时的快速记录
test('createNote 0.16.8：firstLine 写入标题行，文件名用模板并自动避让重名', async () => {
  const c = await makeCase({ settings: { titleMode: 'firstLine', fileNamePattern: '便签' } })
  const first = await c.call('createNote', { title: '首行标题', body: '一点细节' })
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(first.value.note.name, '便签')
  assert.equal(first.value.note.title, '首行标题')
  const full = await c.call('note', { path: first.value.path })
  assert.equal(full.value.body, '首行标题\n\n一点细节\n')
  assert.equal(full.value.blocks.some((block) => block.text === '首行标题'), false, '标题行不进入 blocks')

  const second = await c.call('createNote', { title: '第二篇', body: '' })
  assert.equal(second.ok, true)
  assert.equal(second.value.note.name, '便签-2')
  const secondFull = await c.call('note', { path: second.value.path })
  assert.equal(secondFull.value.body, '第二篇\n')

  const third = await c.call('createNote', { title: '第三篇', body: '' })
  assert.equal(third.value.note.name, '便签-3')
})

test('createNote 0.16.8：heading 写入一级标题，模板 {title} 参与文件名', async () => {
  const c = await makeCase({ settings: { titleMode: 'heading', fileNamePattern: 'MEMO-{title}' } })
  const created = await c.call('createNote', { title: '标题 A', body: '正文' })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(created.value.note.name, 'MEMO-标题 A')
  assert.equal(created.value.note.title, '标题 A')
  const full = await c.call('note', { path: created.value.path })
  assert.equal(full.value.body, '# 标题 A\n\n正文\n')
})

test('createNote 0.16.8：正文模式标题超长允许，只有 {title} 进入文件名时截断', async () => {
  const c = await makeCase({ settings: { titleMode: 'firstLine', fileNamePattern: '{title}' } })
  const long = '字'.repeat(100)
  const created = await c.call('createNote', { title: long, body: '' })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(Buffer.byteLength(created.value.note.name, 'utf8'), 240)
  assert.equal(created.value.note.name.length, 80)
  assert.equal(created.value.note.title, long)
  const full = await c.call('note', { path: created.value.path })
  assert.ok(full.value.body.startsWith(long))
})

test('createNote 0.16.8：正文模式空标题返回 bad-request', async () => {
  const c = await makeCase({ settings: { titleMode: 'firstLine' } })
  for (const title of ['', '   ', '\u0000']) {
    const result = await c.call('createNote', { title, body: 'x' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'bad-request')
  }
})

test('createNote 0.16.8：Default Template 按生成的文件名匹配目录，{{title}} 用正文标题', async () => {
  const c = await makeCase({ settings: { titleMode: 'heading', fileNamePattern: '便签' } })
  const obsidian = join(c.vault, '.obsidian')
  await mkdir(join(obsidian, 'plugins', 'default-template'), { recursive: true })
  await writeFile(join(obsidian, 'community-plugins.json'), JSON.stringify(['default-template']), 'utf8')
  await writeFile(join(obsidian, 'plugins', 'default-template', 'data.json'), JSON.stringify({
    // 精确到文件名的规则：只有用生成的文件名（便签.md）才会命中。
    folderTemplates: { '进行时/便签.md': 'templates/memo.md' },
  }), 'utf8')
  await mkdir(join(c.vault, 'templates'), { recursive: true })
  await writeFile(join(c.vault, 'templates', 'memo.md'), '---\ntitle: "{{title}}"\nsource: memo\n---\n\n', 'utf8')
  const created = await c.call('createNote', { title: '首行标题', body: '正文' })
  assert.equal(created.ok, true, JSON.stringify(created))
  const raw = await readFile(created.value.path, 'utf8')
  assert.match(raw, /^---\ntitle: "首行标题"\nsource: memo\n---/)
  assert.match(raw, /# 首行标题/)
  const full = await c.call('note', { path: created.value.path })
  assert.equal(full.value.title, '首行标题')
  assert.equal(full.value.body, '# 首行标题\n\n正文\n')
})
