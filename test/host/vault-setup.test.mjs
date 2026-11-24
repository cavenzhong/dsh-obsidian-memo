import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, realpath, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createVaultSetupEndpoints } from '../../lib/host/vault-setup.js'
import { setOpenExternalUrlForTests } from '../../lib/obsidian.js'
import { exists, makeCase } from '../../test-support/host.mjs'

const idA = '0123456789abcdef'
const idB = '0123456789abcdff'

async function fixture(dependencies = {}) {
  const c = await makeCase()
  const vault = await realpath(c.vault)
  const path = join(vault, '子目录')
  await mkdir(path)
  const registryPath = join(c.dir, 'obsidian.json')
  const writeRegistry = entries => writeFile(registryPath, JSON.stringify({ vaults: entries }))
  return {
    c, vault, path, registryPath, writeRegistry,
    ...createVaultSetupEndpoints({ registryPath, run: () => assert.fail('unexpected CLI invocation'), ...dependencies }),
  }
}

test('设置仓库检测：普通目录、已有配置未登记、损坏列表都不会打开 Obsidian 或写文件', async () => {
  const f = await fixture({ open: () => assert.fail('unexpected app launch') })
  assert.deepEqual(await f.endpointCheckVault({ path: 'relative' }), { status: 'invalid' })
  assert.deepEqual(await f.endpointCheckVault({ path: f.path, verifyCli: true }), { status: 'plain', canRegister: true })
  assert.equal(await exists(f.registryPath), false)
  assert.equal(await exists(join(f.path, '.obsidian')), false)
  await mkdir(join(f.vault, '.obsidian'))
  assert.deepEqual(await f.endpointCheckVault({ path: f.vault }), { status: 'unregistered', vaultPath: f.vault, canRegister: true })
  assert.deepEqual(await f.endpointCheckVault({ path: f.path }), { status: 'unregistered', vaultPath: f.vault, canRegister: false })
  await writeFile(f.registryPath, '{broken')
  assert.deepEqual(await f.endpointCheckVault({ path: f.path }), { status: 'registry-unreadable' })
  assert.equal(await readFile(f.registryPath, 'utf8'), '{broken')
})

test('设置仓库检测：选择一个库的子目录，运行中时只读验证仓库路径与双链设置', async () => {
  const calls = []
  const f = await fixture({ isRunning: async () => true, async run(args, { cwd }) {
    calls.push(args)
    assert.equal(cwd, f.vault)
    return args[1] === 'vault' ? f.vault : '=> true'
  } })
  const sameName = join(f.c.dir, 'elsewhere', 'vault')
  await mkdir(sameName, { recursive: true })
  await f.writeRegistry({ [idB]: { path: sameName }, [idA]: { path: f.vault } })
  assert.deepEqual(await f.endpointCheckVault({ path: f.path }), { status: 'unverified', vaultPath: f.vault, isSubfolder: true })
  assert.equal(calls.length, 0)
  assert.deepEqual(await f.endpointCheckVault({ path: f.path, verifyCli: true, onlyRunning: true }), { status: 'ready', vaultPath: f.vault, isSubfolder: true })
  assert.deepEqual(calls.map(args => args.slice(0, 2)), [[`vault=${idA}`, 'vault'], [`vault=${idA}`, 'eval']])
})

test('设置仓库检测：未检测到 Obsidian 运行时不执行 CLI 或启动应用', async () => {
  let processChecks = 0
  const f = await fixture({ isRunning: async () => { processChecks += 1; return false }, open: () => assert.fail('unexpected app launch') })
  await f.writeRegistry({ [idA]: { path: f.vault } })
  const location = { vaultPath: f.vault, isSubfolder: true }
  assert.deepEqual(await f.endpointCheckVault({ path: f.path }), { status: 'unverified', ...location })
  assert.equal(processChecks, 0)
  assert.deepEqual(await f.endpointCheckVault({ path: f.path, verifyCli: true, onlyRunning: true }), { status: 'cli-not-running', ...location })
  assert.equal(processChecks, 1)
})

for (const [status, value] of [['cli-disabled', 'Command line interface is not enabled'], ['links-disabled', '=> false'], ['vault-mismatch', 'Vault not found.'], ['cli-missing', null]]) {
  test(`设置仓库检测：${status} 不误报成普通文件夹`, async () => {
    const f = await fixture({ run: async (args) => {
      if (value === null) throw Object.assign(new Error(), { code: 'ENOENT' })
      if (status === 'links-disabled' && args[1] === 'vault') return f.vault
      return value
    } })
    await f.writeRegistry({ [idA]: { path: f.vault } })
    assert.deepEqual(await f.endpointCheckVault({ path: f.vault, verifyCli: true }), { status, vaultPath: f.vault, isSubfolder: false })
  })
}

test('重叠库：即使所选是未登记的外层目录，也拒绝设为库', async () => {
  const f = await fixture({ open: () => assert.fail('overlap must not open manager') })
  await f.writeRegistry({ [idA]: { path: f.path } })
  assert.deepEqual(await f.endpointCheckVault({ path: f.vault, verifyCli: true }), { status: 'overlap', paths: [f.vault, f.path] })
  await assert.rejects(f.endpointOpenVaultManager({ mode: 'register', path: f.vault }), { code: 'bad-request' })
  await f.writeRegistry({ [idA]: { path: f.vault } })
  await mkdir(join(f.path, '.obsidian'))
  assert.deepEqual(await f.endpointCheckVault({ path: f.path, verifyCli: true }), { status: 'overlap', paths: [f.vault, f.path] })
})

test('仓库管理 RPC：打开固定官方入口，保留草稿目录和现有 Markdown', async (t) => {
  const isolation = await makeCase()
  const variables = ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME']
  for (const key of variables) {
    const previous = process.env[key]
    process.env[key] = isolation.dir
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  const c = await makeCase({ notes: { '原文件.md': '原始正文' } })
  const handedOff = []
  setOpenExternalUrlForTests(async (url) => { handedOff.push(url); return { ok: true } })
  t.after(() => setOpenExternalUrlForTests(null))
  const path = join(c.dir, 'independent')
  await mkdir(path)
  const note = join(path, 'note.md')
  await writeFile(note, '[[内部链接]]')
  assert.equal((await c.call('checkVault', { path })).value.status, 'plain')
  assert.equal((await c.call('openVaultManager', { mode: 'register', path, url: 'https://example.com' })).ok, true)
  assert.equal((await c.call('openVaultManager', { mode: 'new' })).ok, true)
  assert.equal((await c.call('openVaultManager', { mode: 'other' })).error.code, 'bad-request')
  assert.equal((await c.call('openVaultManager', { mode: 'register', path: note })).error.code, 'bad-request')
  assert.deepEqual(handedOff, ['obsidian://choose-vault', 'obsidian://choose-vault'])
  assert.equal(await exists(join(path, '.obsidian')), false)
  assert.equal(await readFile(note, 'utf8'), '[[内部链接]]')
  assert.equal((await c.call('settings', {})).value.settings.vaultPath, c.vault)
  setOpenExternalUrlForTests(async () => ({ ok: false }))
  assert.equal((await c.call('openVaultManager', { mode: 'new' })).error.code, 'open-failed')
})
