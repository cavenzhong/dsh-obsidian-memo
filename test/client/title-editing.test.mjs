/** 连续标题输入与展示只读边界；执行真正的浏览器 bundle。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { editorOptions, flush, hookRunner } from '../../test-support/client.mjs'

async function openEditor(t, mode, body) {
  const runner = hookRunner(t), writes = []
  const full = { path: '/title.md', name: '原文件名', title: '展示标题', body, contentRevision: 'v1' }
  runner.connect(async () => ({ ok: true, value: full }))
  const options = editorOptions({ titleMode: mode, request: async (endpoint, payload) => {
    writes.push({ endpoint, payload })
    return { note: { ...full, body: payload.body } }
  } })
  const render = () => runner.render(runner.api.hooks.useNoteEditor, options)
  render().openNoteDrawer(full)
  await flush()
  render().startEditing()
  return { render, writes, options }
}

for (const mode of ['firstLine', 'heading']) {
  const prefix = mode === 'heading' ? '# ' : ''
  const rest = '\n\n必须保留的正文\n\n# 后续章节\n章节正文\n'
  test(`标题编辑 ${mode}：清空、格式中间态与连续输入不改变其他正文`, async (t) => {
    const { render, writes } = await openEditor(t, mode, `${prefix}原标题${rest}`)
    for (const title of ['', '*', '**', '**新', '**新标题**', '', '最终标题']) {
      render().handleTitleChange(title)
      const current = render()
      assert.equal(current.titleDraft, title)
      if (title !== '') assert.equal(current.bodyDraft, `${prefix}${title}${rest}`)
      else assert.equal(current.bodyDraft, rest.slice(1), '只删除原目标行')
      assert.equal(writes.length, 0, '输入只修改内存草稿')
    }
    render().saveEditing()
    await flush()
    assert.equal(writes.length, 1)
    assert.equal(writes[0].endpoint, 'saveNote')
    assert.equal(writes[0].payload.body, `${prefix}最终标题${rest}`)
    assert.equal(writes[0].payload.name, undefined)
    assert.equal(writes[0].payload.expectedRevision, 'v1')
  })

  test(`标题编辑 ${mode}：缺少标题时多次输入只插入一行`, async (t) => {
    const body = mode === 'heading' ? '正文\n\n## 二级标题\n' : '![[图片.png]]\n\n正文\n'
    const { render, writes } = await openEditor(t, mode, body)
    assert.equal(render().titleDraft, '')
    for (const title of ['*', '**', '**新', '**新标题**', '', '新标题']) {
      render().handleTitleChange(title)
      assert.equal(render().bodyDraft, title ? `${prefix}${title}\n${body}` : body)
    }
    assert.equal(writes.length, 0)
  })

  test(`标题编辑 ${mode}：改名及清空时保留同行图片与 Obsidian 锚点`, async (t) => {
    const image = '![[附件/照片.png|300]]'
    const { render } = await openEditor(t, mode, `${prefix}原标题 ${image} ^memo\n\n正文\n`)
    render().handleTitleChange('新标题')
    assert.equal(render().bodyDraft, `${prefix}新标题 ${image} ^memo\n\n正文\n`)
    render().handleTitleChange('')
    assert.equal(render().bodyDraft, `${image} ^memo\n\n正文\n`)
    render().handleTitleChange('最终标题')
    assert.equal(render().bodyDraft, `${prefix}最终标题 ${image} ^memo\n\n正文\n`)
  })

  test(`标题编辑 ${mode}：直接修改正文后更新目标，随后标题输入不恢复旧正文`, async (t) => {
    const { render } = await openEditor(t, mode, `${prefix}旧标题\n\n旧正文`)
    render().handleTitleChange('第一次修改')
    const body = mode === 'heading' ? '新增前言\n\n# 正文里的标题\n\n新正文' : '正文里的标题\n\n新正文'
    render().handleBodyChange(body)
    assert.equal(render().titleDraft, '正文里的标题')
    render().handleTitleChange('最终标题')
    assert.equal(render().bodyDraft, body.replace('正文里的标题', '最终标题'))
  })
}

test('首行标题：逐字输入带 # 的标题不会重复添加前缀', async (t) => {
  const { render } = await openEditor(t, 'firstLine', '原标题\n\n正文')
  for (const title of ['#', '# ', '# 标', '# 标题']) render().handleTitleChange(title)
  assert.equal(render().bodyDraft, '# 标题\n\n正文')
})

test('首行标题：保留原有 ATX 格式，输入自带前缀时只采用一次', async (t) => {
  const { render } = await openEditor(t, 'firstLine', '## 原标题\n\n正文')
  render().handleTitleChange('新标题')
  assert.equal(render().bodyDraft, '## 新标题\n\n正文')
  for (const title of ['#', '# 标', '# 标题']) render().handleTitleChange(title)
  assert.equal(render().bodyDraft, '# 标题\n\n正文')
})

for (const mode of ['filename', 'firstLine', 'heading']) {
  test(`展示只读 ${mode}：打开、进入编辑、无修改保存及取消都不发写请求`, async (t) => {
    const body = '# **标题** ![[图.png]] ^anchor\n\n正文\n\n# 章节\n'
    const { render, writes, options } = await openEditor(t, mode, body)
    assert.equal(render().bodyDraft, body, '展示推导不重写原始 Markdown 草稿')
    render().saveEditing()
    await flush()
    assert.equal(writes.length, 0)
    render().saveEditing()
    assert.equal(writes.length, 0, '阅读态快捷键不触发保存')
    render().startEditing()
    const originalTitle = render().titleDraft
    render().handleTitleChange('临时修改')
    render().handleTitleChange(originalTitle)
    assert.equal(render().bodyDraft, body, '标题改回原值时恢复全部原始格式')
    render().saveEditing()
    assert.equal(writes.length, 0)
    render().startEditing()
    render().handleTitleChange('不会保存的草稿')
    options.titleMode = mode === 'filename' ? 'heading' : 'filename'
    assert.equal(render().editTitleMode, mode, '编辑中沿用进入时的模式，包括界面提示')
    render().cancelEditing()
    await flush()
    assert.equal(writes.length, 0)
  })
}
