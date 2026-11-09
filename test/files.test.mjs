import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertPathWithin, isHiddenVaultPath } from '../lib/files.js'
import { NotesScanner } from '../lib/scan.js'

test('真实路径边界：允许库内未创建的多级目录，拒绝逃逸与悬空链接', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sticky-paths-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const vault = join(root, 'vault'), outside = join(root, 'outside')
  await mkdir(vault)
  await mkdir(outside)
  await writeFile(join(outside, '外部.md'), '外部内容')
  const missing = join(vault, '尚未创建', '项目', '项目.md')
  assert.equal(await assertPathWithin(vault, missing, { allowMissing: true }), join(await realpath(vault), '尚未创建', '项目', '项目.md'))
  const link = join(vault, 'alias')
  await symlink(outside, link, 'dir')
  await assert.rejects(assertPathWithin(vault, join(link, '新目录', '新文件.md'), { allowMissing: true }), { code: 'bad-request' })
  const dangling = join(vault, 'dangling')
  await symlink(join(outside, 'missing'), dangling, 'dir')
  await assert.rejects(assertPathWithin(vault, join(dangling, '新文件.md'), { allowMissing: true }), { code: 'bad-request' })
  const scan = await new NotesScanner().scan({ vaultPath: vault, notesDir: link })
  assert.equal(scan.configured, false)
  assert.deepEqual(scan.notes, [])
})

test('隐藏路径判定：仓库内的 .obsidian/.trash/嵌套隐藏目录为隐藏，普通路径与库外路径不算', () => {
  assert.equal(isHiddenVaultPath('/vault', '/vault/.obsidian'), true)
  assert.equal(isHiddenVaultPath('/vault', '/vault/.trash/附件'), true)
  assert.equal(isHiddenVaultPath('/vault', '/vault/进行时/.附件'), true)
  assert.equal(isHiddenVaultPath('/vault', '/vault/附件'), false)
  assert.equal(isHiddenVaultPath('/vault', '/vault'), false)
  assert.equal(isHiddenVaultPath('/vault', '/outside/.hidden'), false)
})
