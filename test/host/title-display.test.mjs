/** 显示规则始终只解释 Markdown，读取与设置变化不触碰源文件。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { makeCase } from '../../test-support/host.mjs'
import { readModelSource } from '../../lib/host/note-content.js'

test('标题显示：反复切换、扫描、阅读及 AI 输入读取保持原文件字节、mtime 和 inode', async () => {
  const c = await makeCase({ notes: {
    '格式.md': '\uFEFF---\r\ntags: [原样]\r\n---\r\n\r\n# **标题** ![[照片.png]] ^memo\r\n\r\n正文  \r\n\r\n',
    '围栏.md': '````md\n```\n# 示例标题\n````\n\n# 真标题\n\n正文\n',
    '首行.md': '第一行\n\n正文\n',
    '无标题.md': '## 二级标题\n\n正文\n',
    '空.md': '',
  } })
  const snapshots = new Map()
  for (const path of Object.values(c.seeded)) {
    snapshots.set(path, { bytes: await readFile(path), info: await stat(path, { bigint: true }) })
  }
  for (const mode of ['filename', 'firstLine', 'heading', 'firstLine', 'filename']) {
    const current = (await c.call('settings')).value.settings
    const saved = await c.call('saveSettings', { settings: { ...current, titleMode: mode, fileNamePattern: '{title}-{timestamp}' } })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal((await c.call('rescan')).ok, true)
    const state = await c.call('state')
    assert.equal(state.ok, true)
    for (const [path, snapshot] of snapshots) {
      const full = await c.call('note', { path })
      assert.equal(full.ok, true, JSON.stringify(full))
      await readModelSource(path, mode)
      const info = await stat(path, { bigint: true })
      assert.deepEqual(await readFile(path), snapshot.bytes, `${mode}: 源 Markdown 字节不变`)
      assert.equal(info.mtimeNs, snapshot.info.mtimeNs, `${mode}: 不隐式写回`)
      assert.equal(info.ino, snapshot.info.ino, `${mode}: 不替换文件`)
    }
    const formatted = state.value.notes.find((note) => note.name === '格式')
    assert.equal(formatted.title, mode === 'filename' ? '格式' : '标题')
    assert.equal(formatted.imageCount, 1, '显示标题来源不影响图片')
  }
})
