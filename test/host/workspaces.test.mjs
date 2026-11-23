/** host: workspace folder creation and note migration regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { exists, makeCase, saveNote, writeFileDeep } from '../../test-support/host.mjs'

test('createNote 0.18：folder 把新便签直接写进便签目录内的工作空间子文件夹', async () => {
  const c = await makeCase()
  await mkdir(join(c.notesDir, '日记'), { recursive: true })
  const created = await c.call('createNote', { title: '空间新建', body: '一点细节', folder: '日记' })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(created.value.note.relPath, '进行时/日记/空间新建.md')
  assert.equal(await exists(join(c.notesDir, '日记', '空间新建.md')), true)
  const full = await c.call('note', { path: created.value.path })
  assert.equal(full.value.body, '一点细节\n')
  const state = await c.call('state', {})
  assert.deepEqual(state.value.notes.map((note) => note.relPath), ['进行时/日记/空间新建.md'])

  const root = await c.call('createNote', { title: '根目录', body: '', folder: '.' })
  assert.equal(root.ok, true, JSON.stringify(root))
  assert.equal(root.value.note.relPath, '进行时/根目录.md')

  const nested = await c.call('createNote', { title: '二级', body: '', folder: '日记/2026' })
  assert.equal(nested.error.code, 'not-found', '不自动创建不存在的目标文件夹')
})

test('createNote 0.18：folder 拒绝越界、绝对路径、隐藏目录与不存在目录', async () => {
  const c = await makeCase()
  await mkdir(join(c.notesDir, '日记'), { recursive: true })
  for (const folder of ['../外面', '/tmp', '日记/.隐藏', '..']) {
    const result = await c.call('createNote', { title: '非法', body: '', folder: folder })
    assert.equal(result.ok, false, folder)
    assert.equal(result.error.code, 'bad-request', `${folder}: ${JSON.stringify(result)}`)
  }
  const missing = await c.call('createNote', { title: '不存在', body: '', folder: '不存在' })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'not-found')
})

test('state：空工作空间也能连接；挂载和重排空目录会更新 revision', async () => {
  const c = await makeCase()
  await mkdir(join(c.vault, '日记'))
  await mkdir(join(c.vault, '项目'))

  const initial = await c.call('state', {})
  assert.equal(initial.ok, true, JSON.stringify(initial))
  assert.equal(initial.value.configured, true)
  assert.deepEqual(initial.value.notes, [])

  const workspaces = ['日记', '项目']
  const mounted = await c.call('state', { workspaces, knownRevision: initial.value.revision })
  assert.equal(mounted.ok, true, JSON.stringify(mounted))
  assert.notEqual(mounted.value.revision, initial.value.revision)
  assert.deepEqual(mounted.value.notes, [])

  const repeated = await c.call('state', { workspaces, knownRevision: mounted.value.revision })
  assert.equal(repeated.ok, true, JSON.stringify(repeated))
  assert.equal(repeated.value.unchanged, true)
  assert.equal('notes' in repeated.value, false)

  const reordered = await c.call('state', { workspaces: [...workspaces].reverse(), knownRevision: mounted.value.revision })
  assert.equal(reordered.ok, true, JSON.stringify(reordered))
  assert.notEqual(reordered.value.revision, mounted.value.revision)
  assert.deepEqual(reordered.value.notes, [])
})

test('state 0.18：workspaces 让便签墙覆盖仓库内任意工作空间，并支持新建/编辑/归档', async () => {
  const c = await makeCase({ notes: { '主空间.md': '主' } })
  await writeFileDeep(join(c.vault, '工作', '项目A', '外部.md'), '外部')
  await mkdir(join(c.vault, '工作', '项目A'), { recursive: true })

  let state = await c.call('state', {})
  assert.deepEqual(state.value.notes.map((note) => note.relPath), ['进行时/主空间.md'], '不带 workspaces 时仍只扫默认工作空间')

  state = await c.call('state', { workspaces: ['工作'] })
  assert.deepEqual(state.value.notes.map((note) => note.relPath).sort(), ['进行时/主空间.md', '工作/项目A/外部.md'].sort())
  const outside = state.value.notes.find((note) => note.relPath === '工作/项目A/外部.md')
  assert.equal(outside.tag, '项目A', 'tag 相对挂载的工作空间根')
  assert.equal(outside.name, '外部')

  state = await c.call('state', { workspaces: ['../外面', '.隐藏', '/绝对', '不存在'] })
  assert.deepEqual(state.value.notes.map((note) => note.relPath), ['进行时/主空间.md'], '非法/越界/缺失根被忽略')

  const created = await c.call('createNote', { title: '外部新建', body: '正文', targetDir: join(c.vault, '工作', '项目A') })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(created.value.note.relPath, '工作/项目A/外部新建.md')
  state = await c.call('state', { workspaces: ['工作'] })
  assert.ok(state.value.notes.some((note) => note.relPath === '工作/项目A/外部新建.md'))

  const saved = await saveNote(c, { path: created.value.path, body: '改过的正文' })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal(saved.value.note.relPath, '工作/项目A/外部新建.md')

  const archived = await c.call('archive', { path: created.value.path })
  assert.equal(archived.ok, true, JSON.stringify(archived))
  assert.equal(archived.value.to, join(c.vault, '工作', '项目A', '归档', '外部新建.md'))
  state = await c.call('state', { workspaces: ['工作'] })
  assert.equal(state.value.notes.some((note) => note.relPath.includes('外部新建')), false, '归档目录不进入工作空间')
  const undone = await c.call('undoArchive', { undoToken: archived.value.undoToken })
  assert.equal(undone.ok, true, JSON.stringify(undone))
  assert.equal(await exists(join(c.vault, '工作', '项目A', '外部新建.md')), true)
})

test('moveNote 0.18：移动到工作空间文件夹、同名自动避让、状态与撤销同步', async () => {
  const c = await makeCase({ notes: { '搬走.md': '搬走正文\n' } })
  const targetDir = join(c.notesDir, '日记')
  await mkdir(targetDir, { recursive: true })
  const source = c.seeded['搬走.md']
  const moved = await c.call('moveNote', { path: source, targetDir: targetDir })
  assert.equal(moved.ok, true, JSON.stringify(moved))
  assert.equal(moved.value.note.relPath, '进行时/日记/搬走.md')
  assert.equal(await exists(source), false)
  assert.equal(await readFile(join(targetDir, '搬走.md'), 'utf8'), '搬走正文\n')
  const state = await c.call('state', {})
  assert.deepEqual(state.value.notes.map((note) => note.relPath), ['进行时/日记/搬走.md'])


  const undone = await c.call('undoMove', { undoToken: moved.value.undoToken })
  assert.equal(undone.ok, true, JSON.stringify(undone))
  assert.equal(await exists(source), true)
  assert.equal(await exists(join(targetDir, '搬走.md')), false)
  assert.equal(await readFile(source, 'utf8'), '搬走正文\n')
  const restoredState = await c.call('state', {})
  assert.ok(restoredState.value.notes.some((note) => note.relPath === '进行时/搬走.md'))

  const again = await c.call('undoMove', { undoToken: moved.value.undoToken })
  assert.equal(again.ok, false, '同一个撤销 token 只能用一次')
})

test('createNote 0.18：targetDir 必须位于仓库内可见目录', async () => {
  const c = await makeCase()
  const outside = join(c.dir, '仓库外')
  await mkdir(outside, { recursive: true })
  const outsideResult = await c.call('createNote', { title: '外', body: '', targetDir: outside })
  assert.equal(outsideResult.ok, false)
  assert.equal(outsideResult.error.code, 'bad-request')

  const hidden = join(c.vault, '.隐藏')
  await mkdir(hidden, { recursive: true })
  const hiddenResult = await c.call('createNote', { title: '隐', body: '', targetDir: hidden })
  assert.equal(hiddenResult.ok, false)
  assert.equal(hiddenResult.error.code, 'bad-request')

  const missing = await c.call('createNote', { title: '无', body: '', targetDir: join(c.vault, '不存在') })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'not-found')
})

test('moveNote 0.18：同名自动加 (2)，原目录与越界目标拒绝，缺参数报 bad-request', async () => {
  const c = await makeCase({ notes: { '甲.md': '甲' } })
  const targetDir = join(c.notesDir, '日记')
  await mkdir(targetDir, { recursive: true })
  await writeFileDeep(join(targetDir, '甲.md'), '已有')
  const moved = await c.call('moveNote', { path: c.seeded['甲.md'], targetDir: targetDir })
  assert.equal(moved.ok, true, JSON.stringify(moved))
  assert.equal(moved.value.note.relPath, '进行时/日记/甲 (2).md')

  const sameDir = await c.call('moveNote', { path: moved.value.note.path, targetDir: targetDir })
  assert.equal(sameDir.ok, false)
  assert.equal(sameDir.error.code, 'bad-request')

  // 0.18：工作空间可以挂载仓库内任意可见文件夹，便签目录外也能迁入。
  const workspace = join(c.vault, '工作')
  await mkdir(workspace, { recursive: true })
  const crossed = await c.call('moveNote', { path: moved.value.note.path, targetDir: workspace })
  assert.equal(crossed.ok, true, JSON.stringify(crossed))
  // 未把「工作」写进 state 的 workspaces 前，扫描里还没有这张便签摘要；以磁盘路径为准。
  assert.equal(await exists(join(workspace, '甲 (2).md')), true)
  const crossPath = join(workspace, '甲 (2).md')

  const outsideVault = join(c.dir, '仓库外')
  await mkdir(outsideVault, { recursive: true })
  const outside = await c.call('moveNote', { path: crossPath, targetDir: outsideVault })
  assert.equal(outside.ok, false)
  assert.equal(outside.error.code, 'bad-request', '目标必须在仓库内')

  const hidden = join(c.vault, '.隐藏')
  await mkdir(hidden, { recursive: true })
  const hiddenResult = await c.call('moveNote', { path: crossPath, targetDir: hidden })
  assert.equal(hiddenResult.ok, false)
  assert.equal(hiddenResult.error.code, 'bad-request', '隐藏目录不能作为工作空间')

  const noTarget = await c.call('moveNote', { path: crossPath })
  assert.equal(noTarget.ok, false)
  assert.equal(noTarget.error.code, 'bad-request')

  const missing = await c.call('moveNote', { path: crossPath, targetDir: join(c.vault, '不存在') })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'not-found')
})

test('archive 0.18：mapped 归档根挂载后仍不进入活动便签墙', async () => {
  const c = await makeCase()
  const archiveDir = join(c.vault, '历史便签')
  const source = join(c.vault, '工作', '项目A', '外部.md')
  await writeFileDeep(source, '外部')

  const current = (await c.call('state')).value.settings
  const saved = await c.call('saveSettings', {
    settings: { ...current, archiveMode: 'mapped', archiveDir: archiveDir },
  })
  assert.equal(saved.ok, true, JSON.stringify(saved))

  const workspaces = ['工作', '历史便签']
  let state = await c.call('state', { workspaces })
  assert.ok(state.value.notes.some((note) => note.relPath === '工作/项目A/外部.md'))

  const archived = await c.call('archive', { path: source })
  assert.equal(archived.ok, true, JSON.stringify(archived))
  assert.equal(archived.value.to, join(archiveDir, '工作', '项目A', '外部.md'))

  state = await c.call('state', { workspaces })
  assert.equal(state.value.notes.some((note) => note.relPath.startsWith('历史便签/')), false,
    '即使 archiveDir 被列为工作空间，归档便签也不会回到墙上')
})

for (const mode of ['local', 'mapped']) {
  test(`archive 0.18：${mode} 归档树不能通过挂载根、子目录或符号链接进入活动墙`, async () => {
    let selected
    const c = await makeCase({ notes: { '子项目/已完成.md': '历史正文', '待处理.md': '活动正文' },
      ctx: { directoryPickerController: { pick: async () => selected } } })
    if (mode === 'mapped') {
      const current = (await c.call('state')).value.settings
      const result = await c.call('saveSettings', { settings: { ...current, archiveMode: 'mapped', archiveDir: join(c.vault, '历史') } })
      assert.equal(result.ok, true, JSON.stringify(result))
    }
    const archived = await c.call('archive', { path: c.seeded['子项目/已完成.md'] })
    assert.equal(archived.ok, true, JSON.stringify(archived))
    const root = mode === 'mapped' ? join(c.vault, '历史') : dirname(archived.value.to)
    const descendant = mode === 'mapped' ? dirname(archived.value.to) : join(root, '深处')
    if (mode === 'local') await writeFileDeep(join(descendant, '深处的归档.md'), '另一条历史正文')
    const alias = join(c.vault, '归档别名')
    await symlink(descendant, alias, 'dir')
    const rel = path => relative(c.vault, path)
    const { value } = await c.call('state', { workspaces: [root, descendant, alias].map(rel) })
    assert.deepEqual(value.notes.map(note => note.name), ['待处理'])

    const settingsFolders = (await c.call('listFolders', { vaultPath: c.vault })).value.folders
    const activeFolders = (await c.call('listFolders', { vaultPath: c.vault, workspace: true })).value.folders
    assert.ok(settingsFolders.includes(rel(root)) && settingsFolders.includes(rel(descendant)), '通用设置仍能选择归档目录')
    assert.ok(!activeFolders.includes(rel(root)) && !activeFolders.includes(rel(descendant)))
    assert.ok(activeFolders.includes(rel(join(c.notesDir, '子项目'))))
    for (const dir of [root, descendant, alias]) {
      selected = dir
      const pick = await c.call('pickDirectory', { vaultPath: c.vault, workspace: true })
      assert.equal(pick.error.code, 'bad-request')
      const create = await c.call('createNote', { title: '不应写入', body: '', targetDir: dir })
      assert.equal(create.error.code, 'bad-request')
      const move = await c.call('moveNote', { path: c.seeded['待处理.md'], targetDir: dir })
      assert.equal(move.error.code, 'bad-request')
    }
    const folder = await c.call('createFolder', { vaultPath: c.vault, path: rel(join(descendant, '不可新增')), workspace: true })
    assert.equal(folder.error.code, 'bad-request')
    assert.equal(await exists(join(descendant, '不可新增')), false)
    assert.equal(await readFile(c.seeded['待处理.md'], 'utf8'), '活动正文')
  })
}

for (const [move, undo] of [['archive', 'undoArchive'], ['moveNote', 'undoMove']]) {
  test(`${undo}：拒绝移动后来出现的同名文件，即使字节相同`, async () => {
    const c = await makeCase({ notes: { '同名.md': '同样的正文' } })
    const from = c.seeded['同名.md']
    const targetDir = join(c.vault, '目标空间')
    await mkdir(targetDir)
    const moved = await c.call(move, { path: from, targetDir })
    assert.equal(moved.ok, true, JSON.stringify(moved))
    const { to, undoToken } = moved.value
    const original = join(dirname(to), '原件.md')
    await rename(to, original)
    await writeFile(to, '同样的正文')
    const result = await c.call(undo, { undoToken })
    assert.equal(result.error.code, 'conflict')
    assert.equal(await exists(from), false)
    assert.equal(await readFile(to, 'utf8'), '同样的正文')
    assert.equal(await readFile(original, 'utf8'), '同样的正文')
  })
}

test('undoMove：目标被修改时拒绝撤销而且保留改动', async () => {
  const c = await makeCase({ notes: { '原件.md': '原文' } })
  const targetDir = join(c.vault, '目标空间')
  await mkdir(targetDir)
  const from = c.seeded['原件.md']
  const moved = await c.call('moveNote', { path: from, targetDir })
  assert.equal(moved.ok, true, JSON.stringify(moved))
  await writeFile(moved.value.to, '刚编辑过的新正文')
  const result = await c.call('undoMove', { undoToken: moved.value.undoToken })
  assert.equal(result.error.code, 'conflict')
  assert.equal(await exists(from), false)
  assert.equal(await readFile(moved.value.to, 'utf8'), '刚编辑过的新正文')
})
