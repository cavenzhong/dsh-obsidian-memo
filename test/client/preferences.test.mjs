/** client: preferences regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CLIENT_SOURCE, DATE_DAY_MS, DATE_NOW, getTestApi, loadClient, localDayOffsetForTest, noteIds, startOfLocalDayForTest } from '../../test-support/client.mjs'

test('client __test：PINNED_KEY 为契约约定的 localStorage 键', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.equal(api.PINNED_KEY, 'dsh-sticky-notes.panelLocked')
})

test('client __test：localStorage 不可用时锁定读写安全回退', (t) => {
  const { mod } = loadClient(t, { storage: null })
  const api = getTestApi(mod)
  assert.equal(api.readStoredPinned(), false)
  assert.doesNotThrow(() => api.storePinned(true))
  assert.equal(api.readStoredPinned(), false)
})

test('client __test：DATE_FILTERS 四档（今天/3 天/本周/本月），默认今天且开关默认点亮', (t) => {
  const api = getTestApi(loadClient(t).mod)
  // 0.13.9：「全部」从菜单里去掉——开关熄灭就是显示全部。
  assert.deepEqual(api.DATE_FILTERS.map((item) => item.id), ['today', '3d', 'week', 'month'])
  assert.equal(api.DEFAULT_DATE_FILTER, 'today')
  assert.equal(api.DEFAULT_DATE_FILTER_ENABLED, true)
  assert.equal(api.DATE_FILTER_ENABLED_KEY, 'dsh-sticky-notes.dateFilterEnabled.v1')
})

test('client __test：dateFilterBounds 默认不勾选（以最新一篇为锚），勾选「真实时间」按每日 00:00 分界', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const anchor = DATE_NOW - 3 * DATE_DAY_MS

  // 默认（不勾选）：以最新一篇为锚滚动 24h/72h/7d/30d
  const today = api.dateFilterBounds('today', { now: DATE_NOW, anchor })
  assert.equal(today.start, anchor - DATE_DAY_MS)
  assert.equal(today.realtime, false)
  assert.equal(api.dateFilterBounds('3d', { now: DATE_NOW, anchor }).start, anchor - 3 * DATE_DAY_MS)
  assert.equal(api.dateFilterBounds('week', { now: DATE_NOW, anchor }).start, anchor - 7 * DATE_DAY_MS)
  assert.equal(api.dateFilterBounds('month', { now: DATE_NOW, anchor }).start, anchor - 30 * DATE_DAY_MS)

  // 没有锚点（空墙/旧数据）时退回当前时间
  assert.equal(api.dateFilterBounds('today', { now: DATE_NOW }).start, DATE_NOW - DATE_DAY_MS)

  // 勾选「日期截止按真实时间」：自然日/周/月 00:00 分界
  const midnight = startOfLocalDayForTest(DATE_NOW)
  assert.equal(api.dateFilterBounds('today', { now: DATE_NOW, realtime: true }).start, midnight)
  assert.equal(api.dateFilterBounds('3d', { now: DATE_NOW, realtime: true }).start, localDayOffsetForTest(DATE_NOW, -2))
  const sinceMonday = (new Date(DATE_NOW).getDay() + 6) % 7
  assert.equal(api.dateFilterBounds('week', { now: DATE_NOW, realtime: true }).start, localDayOffsetForTest(DATE_NOW, -sinceMonday))
  const date = new Date(DATE_NOW)
  assert.equal(
    api.dateFilterBounds('month', { now: DATE_NOW, realtime: true }).start,
    new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
  )

  // 旧存储兼容：`all` 仍然表示不设下界（0.13.9 起正常入口改用开关熄灭）。
  const all = api.dateFilterBounds('all', { now: DATE_NOW, realtime: true, anchor })
  assert.equal(all.start, -Infinity)
  assert.equal(all.end, Infinity)

  // 非法 id 回退今天（默认锚定模式）
  assert.equal(api.dateFilterBounds('bogus', { now: DATE_NOW }).start, DATE_NOW - DATE_DAY_MS)
})

test('client __test：filterNotesByDate 默认按最新一篇锚定；勾选真实时间按自然日；全部返回所有', (t) => {
  const api = getTestApi(loadClient(t).mod)
  const notes = [
    { path: 'today', created: DATE_NOW - 1000 },
    { path: 'yesterday', created: localDayOffsetForTest(DATE_NOW, -1) + 1000 },
    { path: 'two-days', created: localDayOffsetForTest(DATE_NOW, -2) + 1000 },
    { path: 'three-days', created: localDayOffsetForTest(DATE_NOW, -3) + 1000 },
  ]
  const anchor = notes[0].created

  // 不勾选（默认）：以最新一篇为锚
  assert.deepEqual(noteIds(api.filterNotesByDate(notes, 'today', false, DATE_NOW)), ['today'])
  assert.deepEqual(noteIds(api.filterNotesByDate(notes, '3d', false, DATE_NOW)), ['today', 'yesterday', 'two-days'])

  // 勾选：按每日 00:00 的自然日分界（结果相同，但语义不同）
  assert.deepEqual(noteIds(api.filterNotesByDate(notes, 'today', true, DATE_NOW)), ['today'])
  assert.deepEqual(noteIds(api.filterNotesByDate(notes, '3d', true, DATE_NOW)), ['today', 'yesterday', 'two-days'])

  // 显式锚点：24h / 72h / 7d / 30d 边界
  const rolling = [
    { path: 'x', created: anchor - 60 * 60 * 1000 },
    { path: 'y', created: anchor - 25 * 60 * 60 * 1000 },
    { path: 'z', created: anchor - 80 * 60 * 60 * 1000 },
  ]
  assert.deepEqual(noteIds(api.filterNotesByDate(rolling, 'today', false, DATE_NOW, anchor)), ['x'])
  assert.deepEqual(noteIds(api.filterNotesByDate(rolling, '3d', false, DATE_NOW, anchor)), ['x', 'y'])

  // 旧存储兼容：`all` 仍然不筛选
  assert.deepEqual(
    noteIds(api.filterNotesByDate(notes, 'all', true, DATE_NOW)),
    ['today', 'yesterday', 'two-days', 'three-days'],
  )

  // 0.13.9 开关：enabled=false 直接返回全部（与档位无关）；缺省 true 保持旧行为
  assert.deepEqual(
    noteIds(api.filterNotesByDate(notes, 'today', false, DATE_NOW, undefined, false)),
    ['today', 'yesterday', 'two-days', 'three-days'],
  )
  assert.deepEqual(
    noteIds(api.filterNotesByDate(notes, 'today', false, DATE_NOW, undefined, true)),
    ['today'],
  )

  // created 缺失（含 0 哨兵）时用 mtime 兜底
  assert.deepEqual(noteIds(api.filterNotesByDate([{ path: 'mtime', mtime: DATE_NOW }], 'today', false, DATE_NOW)), ['mtime'])
  assert.deepEqual(noteIds(api.filterNotesByDate([{ path: 'zero', created: 0, mtime: DATE_NOW }], 'today', false, DATE_NOW)), ['zero'])
  assert.equal(api.dateFilterAnchor(notes), notes[0].created)
})

test('client __test：日期筛选 localStorage 持久化与容错（开关 + 档位 + 真实时间勾选）', (t) => {
  const { mod, storage } = loadClient(t)
  const api = getTestApi(mod)

  // 默认：今天、开关点亮、不勾选「真实时间」（= 以最新一篇为锚）
  assert.equal(api.readStoredDateFilter(), 'today')
  assert.equal(api.readStoredDateEnabled(), true)
  assert.equal(api.readStoredDateRealtime(), false)

  // 非法存储值回退默认
  storage.setItem('dsh-sticky-notes.dateFilter.v1', 'bogus')
  assert.equal(api.readStoredDateFilter(), 'today')

  api.storeDateFilter('month')
  assert.equal(storage.getItem('dsh-sticky-notes.dateFilter.v1'), 'month')
  assert.equal(api.readStoredDateFilter(), 'month')
  api.storeDateFilter('bogus')
  assert.equal(api.readStoredDateFilter(), 'today')

  // 0.13.9 开关状态：'1' / '0'
  api.storeDateEnabled(false)
  assert.equal(storage.getItem('dsh-sticky-notes.dateFilterEnabled.v1'), '0')
  assert.equal(api.readStoredDateEnabled(), false)
  api.storeDateEnabled(true)
  assert.equal(storage.getItem('dsh-sticky-notes.dateFilterEnabled.v1'), '1')
  assert.equal(api.readStoredDateEnabled(), true)

  api.storeDateRealtime(true)
  assert.equal(storage.getItem('dsh-sticky-notes.dateRealtime.v1'), '1')
  assert.equal(api.readStoredDateRealtime(), true)
  api.storeDateRealtime(false)
  assert.equal(storage.getItem('dsh-sticky-notes.dateRealtime.v1'), '0')
  assert.equal(api.readStoredDateRealtime(), false)
})

test('client __test：旧版 dateFilter=all 迁移为「开关熄灭」，新开关键优先', (t) => {
  const fresh = loadClient(t)
  fresh.storage.setItem('dsh-sticky-notes.dateFilter.v1', 'all')
  assert.equal(fresh.mod.__test.readStoredDateFilter(), 'today', '旧 all 读成默认档位')
  assert.equal(fresh.mod.__test.readStoredDateEnabled(), false, '旧 all 应迁移成开关熄灭（显示全部）')

  // 有独立开关键时以它为准：即使旧档位是 all，只要新键说开就是开。
  const explicit = loadClient(t)
  explicit.storage.setItem('dsh-sticky-notes.dateFilter.v1', 'all')
  explicit.storage.setItem('dsh-sticky-notes.dateFilterEnabled.v1', '1')
  assert.equal(explicit.mod.__test.readStoredDateEnabled(), true)
})

test('client __test：localStorage 不可用时日期筛选读写安全回退', (t) => {
  const { mod } = loadClient(t, { storage: null })
  const api = getTestApi(mod)
  assert.equal(api.readStoredDateFilter(), 'today')
  assert.equal(api.readStoredDateEnabled(), true)
  assert.equal(api.readStoredDateRealtime(), false)
  assert.doesNotThrow(() => api.storeDateFilter('month'))
  assert.doesNotThrow(() => api.storeDateEnabled(false))
  assert.doesNotThrow(() => api.storeDateRealtime(true))
  assert.equal(api.readStoredDateFilter(), 'today')
  assert.equal(api.readStoredDateEnabled(), true)
  assert.equal(api.readStoredDateRealtime(), false)
})

test('client 源码 / 字典：日期筛选是顶栏第一个「开关 + 档位菜单」，且没有「全部」项', (t) => {
  const api = getTestApi(loadClient(t).mod)
  for (const key of ['date.today', 'date.3d', 'date.week', 'date.month', 'date.realtime', 'date.realtimeHint', 'date.toggleOn', 'date.toggleOff']) {
    assert.equal(typeof api.dictionaries.zh[key], 'string', `zh 缺少 ${key}`)
    assert.equal(typeof api.dictionaries.en[key], 'string', `en 缺少 ${key}`)
  }
  assert.equal(api.dictionaries.zh['date.realtime'], '日期截止按真实时间')
  // 0.13.9：菜单里不再有「全部」。
  assert.equal(api.dictionaries.zh['date.all'], undefined, '「全部」文案应移除（开关熄灭即全部）')
  const actionsIndex = CLIENT_SOURCE.indexOf("className: 'SN_headActions'")
  assert.ok(actionsIndex > 0, '应找到顶栏操作区')
  const dateIndex = CLIENT_SOURCE.indexOf('日期筛选（顶栏第一个）', actionsIndex)
  const subIndex = CLIENT_SOURCE.indexOf('子文件夹开关', actionsIndex)
  assert.ok(dateIndex > actionsIndex, '应找到日期筛选开关')
  assert.ok(subIndex > dateIndex, '日期筛选按钮应排在子文件夹开关之前')
  assert.equal((CLIENT_SOURCE.match(/ref: dateWrapRef/g) || []).length, 1, '日期菜单不应重复渲染')
  // 0.14：主按钮维持开关语义；范围菜单通过悬停或方向键打开。
  assert.match(CLIENT_SOURCE, /'aria-pressed': dateEnabled \? 'true' : 'false'/)
  assert.doesNotMatch(CLIENT_SOURCE, /SN_dateCaret/)
  assert.match(CLIENT_SOURCE, /onMouseEnter: openDateMenu/)
  assert.match(CLIENT_SOURCE, /onClick: toggleDateEnabled/)
  assert.doesNotMatch(CLIENT_SOURCE, /'date\.all': '全部'/, '菜单不应再有「全部」')
  assert.match(CLIENT_SOURCE, /'date\.realtime': '日期截止按真实时间'/, '勾选项名称应为「日期截止按真实时间」')
  assert.match(
    CLIENT_SOURCE,
    /'date\.realtimeHint': '勾选：按照每日 00:00 作为分界点显示；不勾选：按照最后一篇时间的标准界线'/,
    '勾选项说明应描述真实时间分界 / 最后一篇时间界线',
  )
  assert.doesNotMatch(CLIENT_SOURCE, /date\.rolling/, '旧的 date.rolling 文案应已移除')
})

test('client __test：localStorage 不可用时锁定便签路径读写安全回退', (t) => {
  const { mod } = loadClient(t, { storage: null })
  const api = getTestApi(mod)
  assert.equal(api.readStoredPinnedNote(), '')
  assert.doesNotThrow(() => api.storePinnedNote('/a.md'))
  assert.doesNotThrow(() => api.clearStoredPinnedNote())
})

test('client __test：评论区折叠与高度持久化', (t) => {
  const { mod, storage } = loadClient(t)
  const api = getTestApi(mod)
  assert.equal(api.COMMENTS_COLLAPSED_KEY, 'dsh-sticky-notes.commentsCollapsed.v1')
  assert.equal(api.COMMENTS_HEIGHT_KEY, 'dsh-sticky-notes.commentsHeight.v1')
  assert.equal(api.readStoredCommentsCollapsed(), false)
  assert.equal(api.readStoredCommentsHeight(), null)

  api.storeCommentsCollapsed(true)
  assert.equal(storage.getItem(api.COMMENTS_COLLAPSED_KEY), '1')
  assert.equal(api.readStoredCommentsCollapsed(), true)
  api.storeCommentsCollapsed(false)
  assert.equal(api.readStoredCommentsCollapsed(), false)

  api.storeCommentsHeight(240.4)
  assert.equal(storage.getItem(api.COMMENTS_HEIGHT_KEY), '240')
  assert.equal(api.readStoredCommentsHeight(), 240)
  api.storeCommentsHeight(10)
  assert.equal(api.readStoredCommentsHeight(), 96, '低于最小高度时读回最小 96px')
  api.clearStoredCommentsHeight()
  assert.equal(api.readStoredCommentsHeight(), null)

  storage.setItem(api.COMMENTS_HEIGHT_KEY, 'bogus')
  assert.equal(api.readStoredCommentsHeight(), null)
})

test('client __test：commentsHeightBounds 最小 96、最多 72% 且给正文留 140px', (t) => {
  const api = getTestApi(loadClient(t).mod)
  assert.deepEqual(api.commentsHeightBounds(600), { lower: 96, upper: 340 })
  assert.deepEqual(api.commentsHeightBounds(400), { lower: 96, upper: 140 })
  assert.deepEqual(api.commentsHeightBounds(300), { lower: 96, upper: 96 })
  assert.deepEqual(api.commentsHeightBounds(200), { lower: 96, upper: 96 })
  assert.deepEqual(api.commentsHeightBounds(0), { lower: 96, upper: 480 })
  // 实际测得头部 + 操作条更高时，上限还会再降。
  assert.deepEqual(api.commentsHeightBounds(600, 180), { lower: 96, upper: 280 })
  assert.equal(api.clampCommentsHeight(50, 600), 96)
  assert.equal(api.clampCommentsHeight(999, 600), 340)
  assert.equal(api.clampCommentsHeight(999, 600, 200), 260)
  assert.equal(api.clampCommentsHeight(220, 600), 220)
  assert.equal(api.clampCommentsHeight(undefined, 600), 96)
})

test('client __test：localStorage 不可用时评论区偏好安全回退', (t) => {
  const api = getTestApi(loadClient(t, { storage: null }).mod)
  assert.equal(api.readStoredCommentsCollapsed(), false)
  assert.equal(api.readStoredCommentsHeight(), null)
  assert.doesNotThrow(() => api.storeCommentsCollapsed(true))
  assert.doesNotThrow(() => api.storeCommentsHeight(240))
  assert.doesNotThrow(() => api.clearStoredCommentsHeight())
})
