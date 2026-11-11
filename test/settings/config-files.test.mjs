import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeSettings, writeSettingsFile, configHome, locateConfig, readConfigFile, writeConfigFile, rememberConfig, portableSettings } from '../../lib/settings.js'

test('v0.16 配置位置：独立于插件，支持 XDG / APPDATA 与环境变量覆盖', () => {
  assert.equal(configHome({}, 'darwin', '/home/user'), '/home/user/.config/dsh-obsidian-memo')
  assert.equal(configHome({ XDG_CONFIG_HOME: '/custom' }, 'linux', '/home/user'), '/custom/dsh-obsidian-memo')
  assert.equal(configHome({ APPDATA: '/roaming' }, 'win32', '/home/user'), '/roaming/dsh-obsidian-memo')
})

test('v0.16 配置迁移：保留旧文件，优先已有新配置，记住选择的 JSON，不覆盖目标', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memo-config-'))
  try {
    const legacy = join(root, 'plugin', 'data', 'settings.json')
    const home = join(root, 'user-config')
    const vault = join(root, 'vault')
    await writeSettingsFile(legacy, { vaultPath: vault, notesDir: join(vault, '便签'), projectDir: join(vault, '项目') })
    const old = await readFile(legacy, 'utf8')
    const location = await locateConfig({ legacyPath: legacy, home, override: '' })
    assert.equal(location.path, join(home, 'config.json'))
    assert.equal(JSON.parse(await readFile(location.path, 'utf8')).notesDir, '便签')
    assert.equal((await readConfigFile(location.path)).notesDir, join(vault, '便签'))
    assert.equal(await readFile(legacy, 'utf8'), old)
    await writeConfigFile(location.path, { vaultPath: vault, notesDir: '新便签' })
    await locateConfig({ legacyPath: legacy, home, override: '' })
    assert.equal((await readConfigFile(location.path)).notesDir, join(vault, '新便签'))
    const selected = join(root, 'chosen.json')
    await writeConfigFile(selected, { vaultPath: vault, notesDir: '已选择' }, { exclusive: true })
    await assert.rejects(writeConfigFile(selected, {}, { exclusive: true }), { code: 'EEXIST' })
    await rememberConfig(location, selected)
    assert.equal((await locateConfig({ legacyPath: legacy, home, override: '' })).path, selected)
    assert.equal((await locateConfig({ legacyPath: legacy, home, override: '/fixed.json' })).path, '/fixed.json')
    await writeFile(selected, '[1,2]')
    await assert.rejects(readConfigFile(selected), /JSON 对象/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.16 文件夹历史：跨字段共享、去重、限制仓库边界并保留旧选择', () => {
  const settings = normalizeSettings({ vaultPath: '/vault', notesDir: '/vault/notes', projectDir: 'projects',
    archiveTargets: [{ id: 'a', path: 'archive' }], folderHistory: ['old', '/vault/notes', '../outside', '.trash'] })
  assert.deepEqual(settings.folderHistory, ['/vault/notes', '/vault/projects', '/vault/archive', '/vault/old'])
  const portable = portableSettings(settings)
  assert.equal(portable.notesDir, 'notes')
  assert.deepEqual(portable.folderHistory, ['notes', 'projects', 'archive', 'old'])
  assert.equal(portable.archiveTargets[0].path, 'archive')
  assert.equal(normalizeSettings(portable).projectDir, '/vault/projects')
})

test('v0.16 配置原子写入失败时清理临时文件，保留原目标', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memo-config-write-')), target = join(root, 'config.json')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(target)
  await assert.rejects(writeConfigFile(target, {}))
  assert.deepEqual(await readdir(root), ['config.json'])
  const pointer = join(root, 'location.json')
  await mkdir(pointer)
  await assert.rejects(rememberConfig({ home: root, pinned: false }, '/other/config.json'))
  assert.deepEqual((await readdir(root)).sort(), ['config.json', 'location.json'])
})
