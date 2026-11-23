import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCapturedNote, expandTemplateVariables, formatTemplateMoment } from '../lib/capture.js'
import { getBody, splitFrontmatter } from '../lib/notes.js'

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sticky-capture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = { vault: join(root, 'vault'), notes: join(root, 'vault', '进行时') }
  await mkdir(paths.notes, { recursive: true })
  return { root, paths, create: (payload) => createCapturedNote(paths, { title: '一个想法', body: '', ...payload }) }
}

test('快速记录：想法仅作为文件名，可创建空正文；多图保留为仓库相对链接', async (t) => {
  const { create, paths } = await fixture(t)
  const bare = await create({ title: '只有标题' })
  assert.equal(await readFile(bare, 'utf8'), '')
  const path = await create({ body: '第一行\r\n\r\n第二行', images: [{ dataUrl: pixel }, { dataUrl: pixel }] })
  const content = await readFile(path, 'utf8')
  assert.match(content, /^第一行\n\n第二行\n\n!\[\[进行时\/_attachments\//)
  assert.equal(content.includes('一个想法'), false)
  const files = await readdir(join(paths.notes, '_attachments'))
  assert.equal(files.length, 2)
  assert.deepEqual(await readFile(join(paths.notes, '_attachments', files[0])), Buffer.from(pixel.split(',')[1], 'base64'))
})

test('快速记录：并发重名只成功一次，失败不覆盖正文、不遗留附件和临时文件', async (t) => {
  const { create, paths } = await fixture(t)
  const results = await Promise.allSettled([create({ body: '甲', images: [{ dataUrl: pixel }] }), create({ body: '乙', images: [{ dataUrl: pixel }] })])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'exists')
  assert.equal((await readdir(join(paths.notes, '_attachments'))).length, 1)
  assert.deepEqual((await readdir(paths.notes)).sort(), ['_attachments', '一个想法.md'])
})

test('快速记录：目标在 realpath 与 lstat 之间出现时，仍走正常重名处理', async (t) => {
  const fs = createRequire(import.meta.url)('node:fs/promises')
  const originalRealpath = fs.realpath
  for (const titleMode of ['filename', 'firstLine']) {
    const { create, paths } = await fixture(t)
    paths.titleMode = titleMode
    paths.fileNamePattern = '{title}'
    const target = join(await realpath(paths.notes), '一个想法.md')
    let misses = 0
    fs.realpath = async (path, ...args) => {
      try { return await originalRealpath(path, ...args) } catch (error) {
        if (path === target && error.code === 'ENOENT' && ++misses === 2) {
          await writeFile(target, '并发写入的原文', { flag: 'wx' })
        }
        throw error
      }
    }
    syncBuiltinESMExports()
    try {
      const creating = create({ body: '新正文' })
      if (titleMode === 'filename') await assert.rejects(creating, { code: 'exists' })
      else assert.equal(await creating, join(paths.notes, '一个想法-2.md'))
      assert.equal(misses, 2)
      assert.equal(await readFile(target, 'utf8'), '并发写入的原文')
    } finally {
      fs.realpath = originalRealpath
      syncBuiltinESMExports()
    }
  }
})

test('快速记录：自定义图片文件夹自动创建，重名失败清理附件，清空设置恢复默认目录', async (t) => {
  const { create, paths } = await fixture(t)
  paths.attachmentDir = join(paths.vault, '附件', '图片')
  await create({ title: '无图' })
  assert.deepEqual(await readdir(paths.vault), ['进行时'])
  const path = await create({ images: [{ dataUrl: pixel }] })
  const text = await readFile(path, 'utf8')
  assert.match(text, /^!\[\[附件\/图片\//)
  const files = await readdir(paths.attachmentDir)
  assert.equal(files.length, 1)
  assert.deepEqual(await readFile(join(paths.attachmentDir, files[0])), Buffer.from(pixel.split(',')[1], 'base64'))
  await assert.rejects(create({ images: [{ dataUrl: pixel }] }), { code: 'exists' })
  assert.deepEqual(await readdir(paths.attachmentDir), files)
  paths.attachmentDir = ''
  const fallback = await create({ title: '恢复默认', images: [{ dataUrl: pixel }] })
  assert.match(await readFile(fallback, 'utf8'), /^!\[\[进行时\/_attachments\//)
  assert.equal(await readFile(path, 'utf8'), text)
  assert.deepEqual(await readdir(join(paths.vault, '附件', '图片')), files)
})

test('快速记录：自定义图片文件夹拒绝仓库外路径、外部及悬空符号链接', async (t) => {
  const { create, paths, root } = await fixture(t)
  const outside = join(root, 'outside')
  await mkdir(outside)
  await symlink(outside, join(paths.vault, 'external'))
  await symlink(join(root, 'missing'), join(paths.vault, 'dangling'))
  for (const attachmentDir of [outside, join(paths.vault, 'external', 'nested'), join(paths.vault, 'dangling')]) {
    paths.attachmentDir = attachmentDir
    await assert.rejects(create({ images: [{ dataUrl: pixel }] }), { code: 'bad-request' })
  }
  assert.deepEqual(await readdir(outside), [])
  assert.deepEqual(await readdir(paths.notes), [])
})

test('快速记录：先验证所有图片、正文和文件名，再写入文件', async (t) => {
  const { create, paths } = await fixture(t)
  for (const payload of [{ title: '  ' }, { title: '字'.repeat(81) }, { title: 'CON' }, { body: 'x'.repeat(2 * 1024 * 1024 + 1) },
    { images: [{ dataUrl: pixel }, { dataUrl: 'data:image/webp;base64,YWJjZA==' }] },
    { images: Array.from({ length: 9 }, () => ({ dataUrl: pixel })) }]) {
    await assert.rejects(create(payload))
  }
  assert.deepEqual(await readdir(paths.notes), [])
})

test('快速记录：自定义图片文件夹不能是仓库内隐藏目录', async (t) => {
  const { create, paths } = await fixture(t)
  for (const attachmentDir of [join(paths.vault, '.obsidian'), join(paths.vault, '.trash'), join(paths.vault, '进行时', '.hidden')]) {
    paths.attachmentDir = attachmentDir
    await assert.rejects(create({ images: [{ dataUrl: pixel }] }), { code: 'bad-request' })
  }
  assert.deepEqual(await readdir(paths.notes), [])
})

test('快速记录：附件目录与便签目录的外部符号链接都拒绝', async (t) => {
  const { create, paths, root } = await fixture(t)
  const outside = join(root, 'outside')
  await mkdir(outside)
  await symlink(outside, join(paths.notes, '_attachments'))
  await assert.rejects(create({ images: [{ dataUrl: pixel }] }), { code: 'bad-request' })
  const linked = join(paths.vault, 'linked')
  await symlink(outside, linked)
  await assert.rejects(createCapturedNote({ ...paths, notes: linked }, { title: '越界', body: '' }), { code: 'bad-request' })
  assert.deepEqual(await readdir(outside), [])
})

async function templateConfig(paths, config) {
  const dir = join(paths.vault, '.obsidian/plugins/default-template')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'data.json'), JSON.stringify(config))
  await writeFile(join(paths.vault, '.obsidian/community-plugins.json'), '["default-template"]')
}

test('快速记录：空正文、有正文、有图片都携带文件夹模板 meta，仅插入一次且不插入模板占位正文', async (t) => {
  const { create, paths } = await fixture(t)
  const meta = '---\nPROJECTS:\nTODO:\n  - 检查关联\n---'
  await writeFile(join(paths.vault, 'template.md'), `${meta}\n\n模板的占位正文`)
  await templateConfig(paths, { folderTemplates: { '进行时': 'template.md' } })
  for (const [title, body, images] of [['空正文', '', []], ['有正文', '1. 第一项\n2. 第二项\n- 补充', []], ['有图', '正文', [{ dataUrl: pixel }]]]) {
    const path = await create({ title, body, images })
    const text = await readFile(path, 'utf8')
    assert.equal(splitFrontmatter(text).frontmatter, meta)
    assert.equal(text.split('PROJECTS:').length, 2)
    assert.equal(text.includes('模板的占位正文'), false)
    assert.ok(getBody(text).startsWith(body))
    if (images.length) assert.match(getBody(text), /!\[\[进行时\/_attachments\//)
  }
})

test('快速记录：模板 frontmatter 的 {{date}}/{{time}}/{{title}} 按 Default Template 语义替换', async (t) => {
  const { create, paths } = await fixture(t)
  await writeFile(join(paths.vault, 'template.md'), [
    '---',
    'created: {{date:YYYY-MM-DD}}',
    'clock: {{time:HH:mm}}',
    'title: {{title}}',
    'day: {{date}}',
    'time: {{time}}',
    'literal: {{date:[YYYY]}}',
    '---',
    '',
    '模板正文',
  ].join('\n'))
  await templateConfig(paths, { folderTemplates: { '进行时': 'template.md' } })
  const before = new Date()
  const path = await create({ title: '变量', body: '正文' })
  const after = new Date()
  const { frontmatter } = splitFrontmatter(await readFile(path, 'utf8'))
  const pad = (value) => String(value).padStart(2, '0')
  const dateOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const timeOf = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const dates = new Set([dateOf(before), dateOf(after)])
  const times = new Set([timeOf(before), timeOf(after)])
  assert.equal(frontmatter.includes('{{'), false, 'frontmatter 不应留下模板变量')
  assert.equal(frontmatter.includes('title: 变量'), true)
  assert.equal(dates.has(frontmatter.match(/created: (.+)/)?.[1]), true)
  assert.equal(dates.has(frontmatter.match(/day: (.+)/)?.[1]), true)
  assert.equal(times.has(frontmatter.match(/clock: (.+)/)?.[1]), true)
  assert.equal(times.has(frontmatter.match(/time: (.+)/)?.[1]), true)
  assert.match(frontmatter, /literal: YYYY$/m, '[YYYY] 按 moment 的转义语义输出字面量')
})

test('快速记录：community-plugins.json 缺失/损坏/非数组/不含插件时不套模板', async (t) => {
  const { create, paths } = await fixture(t)
  await writeFile(join(paths.vault, 'template.md'), '---\nkeep: yes\n---')
  await templateConfig(paths, { defaultTemplate: 'template.md' })
  const community = join(paths.vault, '.obsidian/community-plugins.json')
  await unlink(community)
  assert.equal(await readFile(await create({ title: '缺失启用清单' }), 'utf8'), '')
  await writeFile(community, '{ 坏掉的 JSON')
  assert.equal(await readFile(await create({ title: '坏启用清单' }), 'utf8'), '')
  await writeFile(community, '{"default-template": true}')
  assert.equal(await readFile(await create({ title: '非数组启用清单' }), 'utf8'), '')
  await writeFile(community, '["other-plugin"]')
  assert.equal(await readFile(await create({ title: '未启用' }), 'utf8'), '')
  await writeFile(community, '["default-template"]')
  assert.match(await readFile(await create({ title: '已启用' }), 'utf8'), /keep: yes/)
})

test('快速记录模板：就近文件夹优先，遵守忽略目录和禁用插件，禁止模板越界', async (t) => {
  const { create, paths, root } = await fixture(t)
  await writeFile(join(paths.vault, 'parent.md'), '---\nsource: parent\n---')
  await writeFile(join(paths.vault, 'near.md'), '---\nsource: near\n---')
  const config = { defaultTemplate: 'parent.md', folderTemplates: { '进行时': 'near.md' } }
  await templateConfig(paths, config)
  assert.match(await readFile(await create({ title: '就近' }), 'utf8'), /source: near/)
  await templateConfig(paths, { ...config, ignorePaths: ['进行时'] })
  assert.equal(await readFile(await create({ title: '忽略', body: '正文' }), 'utf8'), '正文\n')
  await templateConfig(paths, config)
  await writeFile(join(paths.vault, '.obsidian/community-plugins.json'), '[]')
  assert.equal(await readFile(await create({ title: '禁用' }), 'utf8'), '')
  await writeFile(join(paths.vault, '.obsidian/community-plugins.json'), '["default-template"]')
  await writeFile(join(root, 'outside.md'), '---\nsecret: x\n---')
  await symlink(join(root, 'outside.md'), join(paths.vault, 'escape.md'))
  await templateConfig(paths, { defaultTemplate: 'escape.md' })
  assert.equal(await readFile(await create({ title: '越界模板' }), 'utf8'), '', '越界模板按无模板处理，不阻塞新建')
})

test('快速记录：模板配置损坏、模板不是 md、悬空模板都按空白 md 继续', async (t) => {
  const { create, paths, root } = await fixture(t)
  const dataFile = join(paths.vault, '.obsidian/plugins/default-template/data.json')
  await templateConfig(paths, { defaultTemplate: 'template.md' })
  await writeFile(join(paths.vault, 'template.md'), '---\nkeep: 1\n---')
  assert.match(await readFile(await create({ title: '正常' }), 'utf8'), /keep: 1/)

  await writeFile(dataFile, '{ 坏掉的 JSON')
  assert.equal(await readFile(await create({ title: '坏配置' }), 'utf8'), '')

  await templateConfig(paths, { defaultTemplate: 'template.txt' })
  await writeFile(join(paths.vault, 'template.txt'), '---\nkeep: 2\n---')
  assert.equal(await readFile(await create({ title: '非md' }), 'utf8'), '')

  await symlink(join(root, 'missing.md'), join(paths.vault, 'dangling.md'))
  await templateConfig(paths, { defaultTemplate: 'dangling.md' })
  assert.equal(await readFile(await create({ title: '悬空模板' }), 'utf8'), '')
})

test('0.16.8：formatTemplateMoment 从 datetime.js 抽出后旧导出与行为不变', () => {
  const now = new Date(2026, 10, 13, 19, 24, 5)
  assert.equal(formatTemplateMoment(now, 'YYYY-MM-DD HH:mm'), '2026-11-13 19:24')
  assert.equal(formatTemplateMoment(now, 'YYYYMMDD-HHmmss'), '20261113-192405')
  assert.equal(formatTemplateMoment(now, '[第]D[天] MMM'), '第13天 Nov')
  assert.equal(formatTemplateMoment(now, 'YYYY'), '2026')
  assert.equal(expandTemplateVariables('---\ndate: {{date}}\ntime: {{time}}\ntitle: "{{title}}"\n---', '我的标题', now),
    '---\ndate: 2026-11-13\ntime: 19:24\ntitle: "我的标题"\n---')
  // title 里的占位符不再二次展开（与 Default Template 的替换顺序一致）
  assert.match(expandTemplateVariables('{{title}}', '{{date}}', now), /^\{\{date\}\}$/)
})
