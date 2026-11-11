/** host: images regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, symlink, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { LIMITS } from '../../lib/shared.js'
import { makeCase } from '../../test-support/host.mjs'

test('图片处理设置：默认启用 70 / 2048，关闭与自定义参数可保存并读回', async () => {
  const c = await makeCase()
  const first = await c.call('state', {})
  assert.deepEqual(first.value.settings.imageCompression, { enabled: true, quality: 70, maxDimension: 2048 })
  const saved = await c.call('saveSettings', { settings: { ...first.value.settings, imageCompression: { enabled: false, quality: 85, maxDimension: 4096 } } })
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.value.settings.imageCompression, { enabled: false, quality: 85, maxDimension: 4096 })
  assert.deepEqual(JSON.parse(await readFile(c.settingsPath, 'utf8')).imageCompression, saved.value.settings.imageCompression)
})

test('图片文件夹设置：保存后新建图片使用指定目录，清空恢复默认，原图片仍可读取', async () => {
  const c = await makeCase()
  const settings = (await c.call('state')).value.settings
  assert.equal(settings.attachmentDir, '')
  const saved = await c.call('saveSettings', { settings: { ...settings, attachmentDir: '附件/图片' } })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal(saved.value.settings.attachmentDir, join(c.vault, '附件/图片'))
  assert.equal(JSON.parse(await readFile(c.settingsPath, 'utf8')).attachmentDir, '附件/图片')
  const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }
  const created = await c.call('createNote', { title: '自定义图片', body: '', images: [image] })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.match(created.value.note.images[0].source, /^附件\/图片\//)
  const restored = await c.call('saveSettings', { settings: { ...saved.value.settings, attachmentDir: '' } })
  assert.equal(restored.ok, true)
  const fallback = await c.call('createNote', { title: '默认图片', body: '', images: [image] })
  assert.equal(fallback.ok, true, JSON.stringify(fallback))
  assert.match(fallback.value.note.images[0].source, /^进行时\/_attachments\//)
  const loaded = await c.call('readImage', { path: created.value.path, ...created.value.note.images[0] })
  assert.equal(loaded.ok, true, JSON.stringify(loaded))
  assert.equal(loaded.value.dataUrl, image.dataUrl)
})

test('图片文件夹设置：拒绝越界、符号链接越界和已有文件，不写入无效设置', async () => {
  const c = await makeCase()
  const settings = (await c.call('state')).value.settings
  const outside = join(c.dir, 'outside')
  await mkdir(outside)
  const linked = join(c.vault, 'linked')
  await symlink(outside, linked)
  const file = join(c.vault, 'file.png')
  await writeFile(file, 'existing file')
  const hidden = [join(c.vault, '.obsidian'), join(c.vault, '.trash'), join(c.vault, '附件/.hidden')]
  for (const attachmentDir of [outside, join(linked, 'nested'), file, ...hidden]) {
    const result = await c.call('saveSettings', { settings: { ...settings, attachmentDir } })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'bad-request')
  }
  assert.equal((await c.call('state')).value.settings.attachmentDir, '')
  assert.equal(JSON.parse(await readFile(c.settingsPath, 'utf8')).attachmentDir, '')
  assert.deepEqual(await readdir(outside), [])
})

test('readImage：相对路径、仓库路径、Obsidian 附件名和 URL 编码', async () => {
  const c = await makeCase({ notes: { '图片.md': '![[图 片.png]]\n' } })
  const path = c.seeded['图片.md']
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex')
  await mkdir(join(c.vault, '附件'))
  await writeFile(join(c.vault, '附件', '图 片.png'), bytes)
  for (const options of [
    { source: '../附件/图 片.png' },
    { source: '附件/图 片.png' },
    { source: '图 片.png', wiki: true },
    { source: '../附件/%E5%9B%BE%20%E7%89%87.png' },
  ]) {
    const result = await c.call('readImage', { path, ...options })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.value.dataUrl, `data:image/png;base64,${bytes.toString('base64')}`)
  }
})

test('readImage：拒绝越界、符号链接、非图片、超限和同名歧义附件', async () => {
  const c = await makeCase({ notes: { '图片.md': '正文' } })
  const path = c.seeded['图片.md']
  const outside = join(c.dir, 'outside.png')
  await writeFile(outside, 'private')
  await symlink(outside, join(c.notesDir, 'linked.png'))
  await writeFile(join(c.notesDir, 'large.png'), Buffer.alloc(8 * 1024 * 1024 + 1))
  for (const source of ['../../outside.png', 'linked.png', '图片.md', 'https://example.com/x.png', 'file:///tmp/a.png']) {
    const result = await c.call('readImage', { path, source })
    assert.equal(result.ok, false, source)
    assert.equal(result.error.code, 'bad-request', source)
  }
  // 0.12：超过 8MB 默认上限报 too-large（不再是泛化的 bad-request）
  const oversized = await c.call('readImage', { path, source: 'large.png' })
  assert.equal(oversized.ok, false)
  assert.equal(oversized.error.code, 'too-large')
  for (const dir of ['a', 'b']) {
    await mkdir(join(c.vault, dir))
    await writeFile(join(c.vault, dir, 'same.png'), 'image')
  }
  const ambiguous = await c.call('readImage', { path, source: 'same.png', wiki: true })
  assert.equal(ambiguous.ok, false)
  assert.match(ambiguous.error.message, /多个同名/)
})

test('readImage：传 maxBytes 时超限返回 too-large，未传仍 8MB，正常图仍返回 dataUrl', async () => {
  const c = await makeCase({ notes: { '图.md': '![[大图.png]]\n' } })
  const notePath = c.seeded['图.md']
  const pixel = Buffer.from('89504e470d0a1a0a', 'hex')
  // 2 MB：低于默认 8MB，但高于卡片缩略图上限 LIMITS.cardImageMaxBytes
  const big = Buffer.alloc(2 * 1024 * 1024, 1)
  await writeFile(join(c.notesDir, '小图.png'), pixel)
  await writeFile(join(c.notesDir, '大图.png'), big)

  // 正常图：未传 maxBytes 仍返回 dataUrl
  const normal = await c.call('readImage', { path: notePath, source: '小图.png', wiki: true })
  assert.equal(normal.ok, true)
  assert.equal(normal.value.dataUrl, `data:image/png;base64,${pixel.toString('base64')}`)

  // 未传 maxBytes：2MB 图仍可读（默认上限 8MB）
  const defaultLimit = await c.call('readImage', { path: notePath, source: '大图.png', wiki: true })
  assert.equal(defaultLimit.ok, true)
  assert.equal(defaultLimit.value.dataUrl, `data:image/png;base64,${big.toString('base64')}`)

  // 传卡片缩略图上限：超过即 too-large，且不返回 dataUrl
  const tooLarge = await c.call('readImage', {
    path: notePath,
    source: '大图.png',
    wiki: true,
    maxBytes: LIMITS.cardImageMaxBytes,
  })
  assert.equal(tooLarge.ok, false)
  assert.equal(tooLarge.error.code, 'too-large')
  assert.equal(tooLarge.value, undefined)

  // 刚好等于 maxBytes 不算「超过」，仍然成功
  const boundary = await c.call('readImage', {
    path: notePath,
    source: '大图.png',
    wiki: true,
    maxBytes: big.length,
  })
  assert.equal(boundary.ok, true)

  // 小图传 maxBytes 照常成功
  const smallWithLimit = await c.call('readImage', {
    path: notePath,
    source: '小图.png',
    wiki: true,
    maxBytes: LIMITS.cardImageMaxBytes,
  })
  assert.equal(smallWithLimit.ok, true)
})
