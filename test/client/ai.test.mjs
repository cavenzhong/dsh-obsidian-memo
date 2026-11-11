/** client: ai regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { getTestApi, loadClient } from '../../test-support/client.mjs'

test('client __test：AI 预算预设与 shared.js 保持一致（防漂移）', async (t) => {
  const api = getTestApi(loadClient(t).mod)
  const shared = await import('../../lib/shared.js')
  assert.deepEqual(api.AI_PRESETS, shared.AI_PRESETS, 'client 与 shared 的预设映射必须一致')
  assert.deepEqual(api.AI_PRESET_IDS, shared.AI_PRESET_IDS)
  assert.deepEqual(api.AI_EFFORTS, shared.REASONING_EFFORTS)
  assert.deepEqual(api.DEFAULT_AI, shared.DEFAULT_AI)
})

test('client __test：readAiBudget 容错旧值、非自定义档以预设为准、自定义夹紧', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.deepEqual(api.readAiBudget(undefined), { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 })
  assert.deepEqual(api.readAiBudget(null), { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 })
  assert.deepEqual(api.readAiBudget({ preset: 'bogus' }), { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 })
  assert.deepEqual(api.readAiBudget({ preset: 'low' }), { preset: 'low', reasoningEffort: 'off', maxTokens: 2048 })
  // 非自定义档：手改的 effort / maxTokens 不生效
  assert.deepEqual(
    api.readAiBudget({ preset: 'medium', reasoningEffort: 'max', maxTokens: 1 }),
    { preset: 'medium', reasoningEffort: 'low', maxTokens: 4096 },
  )
  // 自定义档：保留并校验
  assert.deepEqual(
    api.readAiBudget({ preset: 'custom', reasoningEffort: 'max', maxTokens: 1234 }),
    { preset: 'custom', reasoningEffort: 'max', maxTokens: 1234 },
  )
  assert.equal(api.readAiBudget({ preset: 'custom', reasoningEffort: 'off', maxTokens: 1 }).maxTokens, 256)
  assert.equal(api.readAiBudget({ preset: 'custom', reasoningEffort: 'off', maxTokens: 10 ** 9 }).maxTokens, 65536)
  assert.equal(api.readAiBudget({ preset: 'custom', reasoningEffort: 'off', maxTokens: 3000.4 }).maxTokens, 3000)
  assert.equal(api.readAiBudget({ preset: 'custom', reasoningEffort: 'x', maxTokens: 'x' }).reasoningEffort, 'high')
  assert.equal(api.readAiBudget({ preset: 'custom', reasoningEffort: 'x', maxTokens: 'x' }).maxTokens, 8192)
})

test('client __test：patchAiBudget 切预设套用预设值，切自定义保留现值', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.deepEqual(
    api.patchAiBudget({ preset: 'high' }, { preset: 'custom' }),
    { preset: 'custom', reasoningEffort: 'high', maxTokens: 8192 },
  )
  assert.deepEqual(
    api.patchAiBudget({ preset: 'custom', reasoningEffort: 'high', maxTokens: 8192 }, { maxTokens: 6000 }),
    { preset: 'custom', reasoningEffort: 'high', maxTokens: 6000 },
  )
  assert.deepEqual(
    api.patchAiBudget({ preset: 'custom', reasoningEffort: 'max', maxTokens: 6000 }, { preset: 'low' }),
    { preset: 'low', reasoningEffort: 'off', maxTokens: 2048 },
  )
})

test('client 字典：AI 预算与预算提示文案中英文齐全', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const keys = [
    'settings.aiBudget',
    'settings.aiPreset.low', 'settings.aiPreset.medium', 'settings.aiPreset.high', 'settings.aiPreset.custom',
    'settings.aiPresetDetail.low', 'settings.aiPresetDetail.medium', 'settings.aiPresetDetail.high', 'settings.aiPresetDetail.custom',
    'settings.aiEffort', 'settings.aiEffort.off', 'settings.aiEffort.low', 'settings.aiEffort.high', 'settings.aiEffort.max',
    'settings.aiMaxTokens', 'settings.aiTokensUnit', 'settings.aiProjectHint',
    'toast.budgetFailed', 'toast.budgetCommentTruncated', 'toast.budgetProjectTruncated',
    'toast.budgetAction', 'toast.budgetAck',
  ]
  for (const key of keys) {
    assert.equal(typeof api.dictionaries.zh[key], 'string', `zh 缺少 ${key}`)
    assert.notEqual(api.dictionaries.zh[key], '', `zh ${key} 不应为空`)
    assert.equal(typeof api.dictionaries.en[key], 'string', `en 缺少 ${key}`)
    assert.notEqual(api.dictionaries.en[key], '', `en ${key} 不应为空`)
  }
})

test('client ToastStack：预算提示渲染「去设置 / 知道了」两个动作，并兼容旧单 action', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const noop = () => {}
  const two = api.components.ToastStack({
    toasts: [{
      id: 1,
      kind: 'error',
      text: '预算不够',
      actions: [{ label: '去设置', run: noop }, { label: '知道了', run: noop }],
    }],
    onDismiss: noop,
  })
  const toast = two.children[0][0]
  // stub 的 createElement 不展平数组子节点，这里手动展开一层。
  const buttons = toast.children.flat().filter((child) => child && child.type === 'button')
  assert.equal(buttons.length, 2)
  assert.equal(buttons[0].children[0], '去设置')
  assert.equal(buttons[1].children[0], '知道了')

  const single = api.components.ToastStack({
    toasts: [{ id: 2, kind: 'success', text: '已归档', action: { label: '撤销', run: noop } }],
    onDismiss: noop,
  })
  const singleButtons = single.children[0][0].children.flat().filter((child) => child && child.type === 'button')
  assert.equal(singleButtons.length, 1)
  assert.equal(singleButtons[0].children[0], '撤销')
})

test('client SettingsDrawer：每枚 emoji 与开档各有一个 AI 预算控件，自定义才露出两个字段', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const collect = (node, out = []) => {
    if (node == null) return out
    if (Array.isArray(node)) {
      for (const item of node) collect(item, out)
      return out
    }
    if (typeof node === 'object') {
      out.push(node)
      collect(node.children, out)
    }
    return out
  }
  const t2 = (key) => key
  const draft = {
    vaultPath: '/v',
    notesDir: '/v/notes',
    projectDir: '/v/projects',
    archiveTargets: [],
    emojis: [
      { id: 'a', emoji: '😈', label: '毒舌', callout: 'quote', prompt: 'p' },
      { id: 'b', emoji: '✨', label: '另一面', callout: 'abstract', prompt: 'p', ai: { preset: 'custom', reasoningEffort: 'max', maxTokens: 5000 } },
    ],
    projectPrompt: '建档',
  }
  const noop = () => {}
  const tree = api.components.SettingsDrawer({
    t: t2,
    draft: draft,
    picking: null,
    saving: false,
    onPatch: noop,
    onPick: noop,
    onAddArchive: noop,
    onRemoveArchive: noop,
    onPatchEmoji: noop,
    onRemoveEmoji: noop,
    onAddEmoji: noop,
    onSave: noop,
    onCancel: noop,
  })
  // 组件元素（AiBudgetRow）带 ai prop：2 枚 emoji + 1 个开档
  const budgetRows = collect(tree).filter((node) => node && typeof node.type === 'function' && node.props && Object.prototype.hasOwnProperty.call(node.props, 'ai'))
  assert.equal(budgetRows.length, 3)
  // 每行都渲染出「AI 预算」预设下拉
  const presetValues = budgetRows.map((row) => {
    const rendered = collect(row.type(row.props))
    const select = rendered.find((node) => node && node.type === 'select' && node.props && node.props['aria-label'] === 'settings.aiBudget')
    assert.ok(select, 'AI 预算下拉缺失')
    return select.props.value
  })
  assert.deepEqual(presetValues, ['high', 'custom', 'high'])
  // 自定义行额外渲染「思考档位 + 输出上限」
  const customRendered = collect(budgetRows[1].type(budgetRows[1].props))
  const effort = customRendered.find((node) => node && node.type === 'select' && node.props && node.props['aria-label'] === 'settings.aiEffort')
  const tokens = customRendered.find((node) => node && node.type === 'input' && node.props && node.props['aria-label'] === 'settings.aiMaxTokens')
  assert.equal(effort.props.value, 'max')
  assert.equal(tokens.props.defaultValue, '5000')
  // 非自定义行不渲染这两个字段
  const presetRendered = collect(budgetRows[0].type(budgetRows[0].props))
  assert.equal(presetRendered.some((node) => node && node.props && node.props['aria-label'] === 'settings.aiEffort'), false)
  assert.equal(presetRendered.some((node) => node && node.props && node.props['aria-label'] === 'settings.aiMaxTokens'), false)
})
