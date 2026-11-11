/** client: data regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { deferred, getTestApi, loadClient } from '../../test-support/client.mjs'

test('state 请求顺序：较新的响应先到时，迟到的旧响应不能覆盖', async (t) => {
  const api = loadClient(t).mod.__test
  const requests = [], applied = []
  const reader = api.createStateReader({
    call(payload, signal) { const pending = deferred(); requests.push({ ...pending, payload, signal }); return pending.promise },
    getRevision: () => 'known',
    onValue: (value) => applied.push(value),
  })
  const first = reader.read(false), second = reader.read(true)
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(requests[1].payload.knownRevision, null)
  requests[1].resolve({ revision: 'new' })
  await second
  requests[0].resolve({ revision: 'old' })
  assert.equal(await first, null)
  assert.deepEqual(applied, [{ revision: 'new' }])
  const pending = reader.read(false)
  reader.invalidate()
  requests[2].reject(new Error('迟到的网络错误'))
  assert.equal(await pending, null)
})

test('client __test：nextPollDelay 未变化时按 1.5× 退避、封顶 30s', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(typeof api.nextPollDelay, 'function', '__test.nextPollDelay 缺失（性能契约）')

  const POLL_BASE = 4000
  const POLL_MAX = 30000

  // 有变化 → 回到 base
  assert.equal(api.nextPollDelay(POLL_BASE, false), POLL_BASE)
  assert.equal(api.nextPollDelay(25000, false), POLL_BASE, '变化时应重置为 base')
  // 未变化 → min(30000, round(prev * 1.5))
  assert.equal(api.nextPollDelay(POLL_BASE, true), 6000)
  assert.equal(api.nextPollDelay(6000, true), 9000)
  assert.equal(api.nextPollDelay(3000, true), 4500)
  assert.equal(api.nextPollDelay(4001, true), 6002, '应四舍五入：round(4001 * 1.5) = 6002')
  assert.equal(api.nextPollDelay(20000, true), 30000, '20000 * 1.5 正好封顶')
  assert.equal(api.nextPollDelay(25000, true), 30000, '超过 30s 应截断')
  assert.equal(api.nextPollDelay(POLL_MAX, true), POLL_MAX, '已在封顶值应保持')

  // 从 base 逐步退避：非递减、始终在 [6000, 30000]
  let previous = 0
  for (let prev = POLL_BASE; prev <= POLL_MAX; prev += 1000) {
    const next = api.nextPollDelay(prev, true)
    assert.equal(next, Math.min(POLL_MAX, Math.round(prev * 1.5)), `prev=${prev}`)
    assert.ok(next >= 6000 && next <= POLL_MAX)
    assert.ok(next >= previous, `退避不应变小：${previous} -> ${next}`)
    previous = next
  }
})

test('client __test：nextPollDelay 非法输入安全（不抛错、不返回 NaN/负数/超上限）', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(typeof api.nextPollDelay, 'function', '__test.nextPollDelay 缺失（性能契约）')

  for (const prev of [undefined, null, NaN, Infinity, -Infinity, -1, 0, '4000', {}, []]) {
    assert.equal(api.nextPollDelay(prev, false), 4000, `prev=${String(prev)} 有变化时应回到 base`)
    const unchanged = api.nextPollDelay(prev, true)
    assert.equal(typeof unchanged, 'number', `prev=${String(prev)} 应返回数字`)
    assert.ok(Number.isFinite(unchanged), `prev=${String(prev)} 不应返回 NaN/Infinity`)
    assert.ok(unchanged > 0 && unchanged <= 30000, `prev=${String(prev)} 越界：${unchanged}`)
  }
})

test('client __test：mergeState 无变化时返回同一对象（不新建 view）', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const settings = {
    vaultPath: '/vault',
    notesDir: '/vault/notes',
    projectDir: '',
    archiveTargets: [],
    emojis: [{ id: 'devil', emoji: '😈', label: '毒舌', callout: 'quote', prompt: 'x' }],
    projectPrompt: 'p',
    includeSubfolders: true,
  }
  const prev = {
    loaded: true,
    configured: true,
    error: null,
    revision: 'r1',
    version: '0.13.0',
    settings,
    jobs: [],
    notes: [{ path: '/vault/notes/a.md' }],
  }

  // unchanged 且 configured/error/revision/version/settings/jobs 签名都没变 → 必须原样返回 prev
  const same = api.mergeState(prev, {
    configured: true,
    revision: 'r1',
    unchanged: true,
    version: '0.13.0',
    jobs: [],
    settings: { ...settings, emojis: settings.emojis.map((item) => ({ ...item })) },
  })
  assert.equal(same, prev, 'unchanged 且签名相同应返回同一对象，避免整墙重渲染')

  // 旧 Host 没下发 version（缺失）时视为不变，不应触发重渲染
  const missingVersion = api.mergeState(prev, {
    configured: true,
    revision: 'r1',
    unchanged: true,
    jobs: [],
    settings,
  })
  assert.equal(missingVersion, prev, '缺失 version 应视为不变')

  // version 变化必须新建 view（顶栏 byline 随之更新）
  const versionChanged = api.mergeState(prev, {
    configured: true,
    revision: 'r1',
    unchanged: true,
    version: '0.14.2',
    jobs: [],
    settings,
  })
  assert.notEqual(versionChanged, prev)
  assert.equal(versionChanged.version, '0.14.2')

  // jobs 变化要新建 view（pending 展示依赖）
  const jobsChanged = api.mergeState(prev, {
    configured: true,
    revision: 'r1',
    unchanged: true,
    version: '0.13.0',
    jobs: [{ id: 'job-1', status: 'running' }],
    settings,
  })
  assert.notEqual(jobsChanged, prev)
  assert.equal(jobsChanged.jobs.length, 1)

  // revision / notes 变化要新建 view
  const revisionChanged = api.mergeState(prev, {
    configured: true,
    revision: 'r2',
    version: '0.13.0',
    jobs: [],
    settings,
    notes: [{ path: '/vault/notes/b.md' }],
  })
  assert.notEqual(revisionChanged, prev)
  assert.equal(revisionChanged.revision, 'r2')

  // 非法 value 安全回退
  assert.equal(api.mergeState(prev, null), prev)
  assert.equal(api.mergeState(prev, undefined), prev)
})
