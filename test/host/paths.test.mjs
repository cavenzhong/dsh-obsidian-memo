/** host: paths regression coverage. */
import test from 'node:test'
import { join, dirname } from 'node:path'
import { mkdir, symlink, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { setOpenExternalUrlForTests } from '../../lib/obsidian.js'
import { LIMITS } from '../../lib/shared.js'
import { ROOT, makeCase, saveNote } from '../../test-support/host.mjs'

test('路径边界：设置、归档、开档与打开不能经目录符号链接越过仓库', async () => {
  const c = await makeCase({ notes: { '甲.md': '原文\n' } })
  const outside = join(c.dir, 'outside')
  await mkdir(outside)
  await symlink(outside, c.archiveDir, 'dir')
  await symlink(outside, c.projectDir, 'dir')
  const path = c.seeded['甲.md']
  const archive = await c.call('archive', { path, targetId: 'arch' })
  assert.equal(archive.error.code, 'bad-request')
  const project = await c.call('openProject', { path, name: '项目' })
  assert.equal(project.error.code, 'bad-request')
  const current = (await c.call('state')).value.settings
  const saved = await c.call('saveSettings', { settings: current })
  assert.equal(saved.error.code, 'bad-request')
  await writeFile(join(outside, '外部.md'), '外部内容')
  const opened = await c.call('openInObsidian', { path: join(c.archiveDir, '外部.md') })
  assert.equal(opened.error.code, 'bad-request')
  assert.equal(await readFile(path, 'utf8'), '原文\n')
  assert.deepEqual(await readdir(outside), ['外部.md'])
})

test('saveSettings：越界路径 / 不存在的便签目录 / 非法 payload 被拒绝', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })

  const outside = await c.call('saveSettings', {
    settings: { vaultPath: c.vault, notesDir: join(ROOT, 'outside-notes') },
  })
  assert.equal(outside.ok, false)
  assert.equal(outside.error.code, 'bad-request')
  assert.match(outside.error.message, /必须在仓库内/)

  const missing = await c.call('saveSettings', {
    settings: { vaultPath: c.vault, notesDir: join(c.vault, '不存在的便签目录') },
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'bad-request')
  assert.match(missing.error.message, /便签目录不存在/)

  for (const settings of [null, [], 'x', 42]) {
    const invalid = await c.call('saveSettings', { settings })
    assert.equal(invalid.ok, false)
    assert.equal(invalid.error.code, 'bad-request')
  }

  // 失败后原设置仍在生效
  const state = await c.call('state')
  assert.equal(state.value.settings.notesDir, c.notesDir)
})

test('路径校验：saveNote 便签目录外 / 非 md / 缺 path 都被拒绝', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })

  const outsideNote = join(c.vault, '目录外.md')
  await writeFile(outsideNote, '# 外\n', 'utf8')
  const outside = await saveNote(c, { path: outsideNote, body: '一' })
  assert.equal(outside.ok, false)
  assert.equal(outside.error.code, 'bad-request')
  assert.match(outside.error.message, /便签不在配置的便签目录内/)

  const notMd = join(c.notesDir, '不是便签.txt')
  await writeFile(notMd, 'txt', 'utf8')
  const wrongExt = await saveNote(c, { path: notMd, body: '一' })
  assert.equal(wrongExt.ok, false)
  assert.equal(wrongExt.error.code, 'bad-request')
  assert.match(wrongExt.error.message, /不是 markdown/)

  const missingPath = await saveNote(c, { body: '一' })
  assert.equal(missingPath.ok, false)
  assert.equal(missingPath.error.code, 'bad-request')
})

test('路径校验：便签目录内指向仓库外的符号链接不能读写目标文件', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })
  const outsideNote = join(c.dir, 'outside.md')
  const linkedNote = join(c.notesDir, '外链.md')
  await writeFile(outsideNote, '# 保持不变\n', 'utf8')
  await symlink(outsideNote, linkedNote)

  const result = await saveNote(c, { path: linkedNote, body: '已越界' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'bad-request')
  assert.match(result.error.message, /符号链接指向了配置目录之外/)
  assert.equal(await readFile(outsideNote, 'utf8'), '# 保持不变\n')
})

test('pickDirectory：无目录选择器时 picker-unavailable，有选择器时返回路径', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })

  const unavailable = await c.call('pickDirectory', {})
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.error.code, 'picker-unavailable')

  const available = await makeCase({
    notes: { '甲.md': '# 甲\n' },
    ctx: { directoryPickerController: { pick: async () => '/选择的目录' } },
  })
  const picked = await available.call('pickDirectory', { initial: '/x' })
  assert.equal(picked.ok, true)
  assert.equal(picked.value.path, '/选择的目录')

  const cancelled = await makeCase({
    notes: { '甲.md': '# 甲\n' },
    ctx: { directoryPickerController: { pick: async () => null } },
  })
  const cancelledResult = await cancelled.call('pickDirectory', {})
  assert.equal(cancelledResult.ok, true)
  assert.equal(cancelledResult.value.path, null)
})

test('v0.16 文件夹：共享浏览排除隐藏与符号链接，新建仅允许仓库内路径', async () => {
  const c = await makeCase()
  await mkdir(join(c.vault, '附件', '图片'), { recursive: true })
  await mkdir(join(c.vault, '.obsidian'))
  await mkdir(join(c.dir, 'outside'))
  await symlink(join(c.dir, 'outside'), join(c.vault, 'link'), 'dir')
  const folders = await c.call('listFolders', { vaultPath: c.vault })
  assert.equal(folders.ok, true)
  assert.ok(folders.value.folders.includes('附件/图片'))
  assert.ok(!folders.value.folders.some((path) => path.startsWith('.') && path !== '.'))
  assert.ok(!folders.value.folders.includes('link'))
  const created = await c.call('createFolder', { vaultPath: c.vault, path: '新建/多级' })
  assert.equal(created.ok, true)
  assert.ok((await stat(join(c.vault, '新建/多级'))).isDirectory())
  for (const path of ['../outside/new', '.trash/new', 'link/new']) {
    assert.equal((await c.call('createFolder', { vaultPath: c.vault, path })).ok, false, path)
  }
})

test('v0.16 配置：环境变量固定位置，JSON 打开与显示只使用已知路径', async () => {
  const c = await makeCase()
  const opened = []
  setOpenExternalUrlForTests(async (path) => { opened.push(path); return { ok: true } })
  try {
    assert.equal((await c.call('configFile', { action: 'open', path: '/ignored' })).ok, true)
    assert.equal((await c.call('configFile', { action: 'reveal' })).ok, true)
    assert.deepEqual(opened, [c.settingsPath, dirname(c.settingsPath)])
    assert.equal((await c.call('configFile', { action: 'relocate', path: join(c.dir, 'config.json') })).ok, false)
    assert.equal((await c.call('state')).value.settings.configFile.pinned, true)
  } finally { setOpenExternalUrlForTests(null) }
})

test('v0.16 请求预算包含 JSON 转义，归一化路径使用同一份路由上限', async () => {
  const c = await makeCase({ notes: { '甲.md': '原文' } })
  const full = (await c.call('note', { path: c.seeded['甲.md'] })).value
  const body = '"'.repeat(LIMITS.maxFileBytes - 64)
  const saved = await c.call('saveNote', { path: full.path, body, expectedRevision: full.contentRevision })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal(await readFile(full.path, 'utf8'), body + '\n')
  const created = await c.call('createNote', { title: '转义正文', body: '\u0001'.repeat(512 * 1024) }, { url: '/sticky-notes/nested/../createNote' })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal((await stat(created.value.path)).size, 512 * 1024 + 1)
})
