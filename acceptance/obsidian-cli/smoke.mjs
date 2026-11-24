/** Opt-in macOS acceptance test. Only touches its own temporary settings, vaults and CLI socket. */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { writeSettingsFile } from '../../lib/settings.js'
import { apply, makeCall, makeCtx, saveNote } from '../../test-support/host.mjs'

assert.equal(process.platform, 'darwin', 'This acceptance test uses the macOS desktop installer')
const root = await realpath(await mkdtemp('/private/tmp/dsh-obsidian-acceptance-'))
const profile = join(root, 'Library', 'Application Support', 'obsidian')
const app = '/Applications/Obsidian.app/Contents/MacOS/Obsidian'
const cli = '/Applications/Obsidian.app/Contents/MacOS/obsidian-cli'
const vaultA = join(root, 'a', 'Same'), vaultB = join(root, 'b', 'Same')
const idA = '8946d11f1f125f00', idB = '8946d11f1f125f01'
const src = 'Managed/Source/选题 α.md'
const destDir = 'Managed/Dest', collision = `${destDir}/选题 α.md`, dest = `${destDir}/选题 α (2).md`
const ref = 'Elsewhere/reference.md'
const originalRef = '---\nrelated: "[[Managed/Source/选题 α]]"\n---\n[[Managed/Source/选题 α#Title|alias]] ![[Managed/Source/选题 α#^block]] [markdown](../Managed/Source/%E9%80%89%E9%A2%98%20%CE%B1.md)\n'
const originalBody = '# Title\n\n[[./Peer]]\n\nOld body ^block\n'
const editedBody = originalBody.replace('Old body', 'New body')

async function put(path, text) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}
for (const [vault, enabled] of [[vaultA, true], [vaultB, false]]) {
  await put(join(vault, '.obsidian/app.json'), JSON.stringify({ alwaysUpdateLinks: enabled }))
  await put(join(vault, src), originalBody)
  await put(join(vault, 'Managed/Source/Peer.md'), 'peer')
  await put(join(vault, collision), 'existing')
  await put(join(vault, ref), originalRef)
}
await put(join(profile, 'obsidian.json'), JSON.stringify({ cli: true, updateDisabled: true, vaults: {
  [idA]: { path: vaultA, open: true }, [idB]: { path: vaultB, open: true },
} }))
// Separate HOME scopes the native CLI socket; --user-data-dir separates Electron data.
// Mock keychain leaves the actual macOS keychain out of this acceptance run.
const env = { ...process.env, HOME: root }
const child = spawn(app, [`--user-data-dir=${profile}`, '--disable-gpu', '--use-mock-keychain'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = '', spawnError
child.on('error', error => { spawnError = error })
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log = (log + data).slice(-6000) })
const run = async (id, ...args) => (await promisify(execFile)(cli, [`vault=${id}`, ...args], { env, timeout: 8000 })).stdout.trim()

async function waitForVaults() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline && child.exitCode === null && !spawnError) {
    if ((await lstat(join(root, '.obsidian-cli.sock')).catch(() => null))?.isSocket()) {
      const [a, b] = await Promise.all([run(idA, 'vault', 'info=path'), run(idB, 'vault', 'info=path')]).catch(() => [])
      if (a === vaultA && b === vaultB) return
    }
    await delay(250)
  }
  throw spawnError ?? new Error('Both isolated vaults must be open and reachable before any mutation')
}

async function createContext(vault, engine) {
  process.env.HOME = root
  process.env.DSH_STICKY_NOTES_SETTINGS = join(root, `settings-${vault === vaultA ? 'a' : 'b'}.json`)
  await writeSettingsFile(process.env.DSH_STICKY_NOTES_SETTINGS, {
    vaultPath: join(vault, 'Managed'), notesDir: join(vault, 'Managed/Source'), operationEngine: engine,
  })
  const ctx = makeCtx()
  await apply(ctx.ctx, {})
  return { call: makeCall(ctx.route()) }
}

function good(response) {
  assert.equal(response.ok, true, JSON.stringify(response))
  return response.value
}

async function assertReference(path, { afterEdit = false } = {}) {
  const text = await readFile(join(vaultA, ref), 'utf8')
  const property = text.match(/^related: "\[\[([^\]]+)\]\]"$/m)?.[1]
  const heading = text.match(/\[\[([^\]]+)#Title\|alias\]\]/)?.[1]
  const embed = text.match(/!\[\[([^\]]+)#\^block\]\]/)?.[1]
  const markdown = text.match(/\[markdown\]\((.*)\)$/m)?.[1]
  assert.ok(property && heading && embed && markdown, text)
  if (afterEdit) assert.match(text, /Edit made after move\./)
  const links = [property, heading, embed, decodeURI(markdown.replace(/^<|>$/g, '')).replace(/\\([()])/g, '$1')]
  const expression = `JSON.stringify(${JSON.stringify(links)}.map(link => app.metadataCache.getFirstLinkpathDest(link, ${JSON.stringify(ref)})?.path ?? null))`
  let resolved = await run(idA, 'eval', `code=${expression}`)
  if (/command "eval" not found/i.test(resolved)) resolved = await run(idA, 'dev:eval', `code=${expression}`)
  const serialized = JSON.parse(resolved.replace(/^=>\s*/, ''))
  assert.deepEqual(typeof serialized === 'string' ? JSON.parse(serialized) : serialized, [path, path, path, path], text)
  const backlinks = JSON.parse(await run(idA, 'backlinks', `path=${path}`, 'format=json'))
  assert.ok(backlinks.some(link => (link.file ?? link.path) === ref), JSON.stringify(backlinks))
}

try {
  await waitForVaults()
  console.log('Obsidian:', await run(idA, 'version'))
  const a = await createContext(vaultA)
  const found = good(await a.call('checkVault', { path: join(vaultA, 'Managed'), verifyCli: true, onlyRunning: true }))
  assert.equal(found.status, 'ready', JSON.stringify(found))
  assert.equal(found.vaultPath, vaultA)

  const moved = good(await a.call('moveNote', { path: join(vaultA, src), targetDir: join(vaultA, destDir) }))
  assert.equal(moved.to, join(vaultA, dest))
  assert.equal(await readFile(join(vaultA, collision), 'utf8'), 'existing')
  assert.match(await readFile(moved.to, 'utf8'), /\[\[Peer\]\]/)
  await assertReference(dest)
  assert.equal(await readFile(join(vaultB, ref), 'utf8'), originalRef)
  await writeFile(join(vaultA, ref), (await readFile(join(vaultA, ref), 'utf8')) + '\nEdit made after move.\n')
  good(await a.call('undoMove', { undoToken: moved.undoToken }))
  await assertReference(src, { afterEdit: true })
  console.log('PASS move and undo: same-name vaults, collision, links outside DSH workspace, and edits after move')

  const archivedPath = 'Managed/Source/归档/选题 α.md'
  const archived = good(await a.call('archive', { path: join(vaultA, src) }))
  assert.equal(archived.to, join(vaultA, archivedPath))
  await assertReference(archivedPath, { afterEdit: true })
  good(await a.call('undoArchive', { undoToken: archived.undoToken }))
  await assertReference(src, { afterEdit: true })
  console.log('PASS archive and undo: link targets follow both operations')

  let renamed = good(await saveNote(a, { path: join(vaultA, src), name: '改名 Alpha', body: editedBody }))
  assert.equal(renamed.note.name, '改名 Alpha')
  assert.match(await readFile(renamed.note.path, 'utf8'), /New body \^block/)
  await assert.rejects(lstat(join(vaultA, src)), { code: 'ENOENT' })
  await assertReference('Managed/Source/改名 Alpha.md', { afterEdit: true })
  renamed = good(await saveNote(a, { path: renamed.note.path, name: '改名 ALPHA', body: editedBody }))
  assert.equal(renamed.note.name, '改名 ALPHA')
  const names = await readdir(join(vaultA, 'Managed/Source'))
  assert.ok(names.includes('改名 ALPHA.md') && !names.includes('改名 Alpha.md'))
  await assertReference('Managed/Source/改名 ALPHA.md', { afterEdit: true })
  console.log('PASS rename and case-only rename: body and all backlink formats verified on disk')

  const b = await createContext(vaultB)
  const refused = await saveNote(b, { path: join(vaultB, src), name: '不应改名', body: editedBody })
  assert.equal(refused.error?.code, 'obsidian-cli-unavailable', JSON.stringify(refused))
  assert.match(refused.error.message, /未开启/)
  assert.equal(await readFile(join(vaultB, src), 'utf8'), originalBody)
  assert.equal(await readFile(join(vaultB, ref), 'utf8'), originalRef)
  await assert.rejects(lstat(join(vaultB, 'Managed/Source/不应改名.md')), { code: 'ENOENT' })
  const direct = await createContext(vaultB, 'direct')
  assert.equal(good(await direct.call('moveNote', { path: join(vaultB, src), targetDir: join(vaultB, destDir) })).to, join(vaultB, dest))
  assert.equal(await readFile(join(vaultB, ref), 'utf8'), originalRef)
  console.log('PASS disabled link updates block renaming and body writes; folder management leaves references alone')
  console.log('Temporary test data:', root)
} catch (error) {
  console.error(error)
  console.error('Temporary test data:', root, '\nObsidian log:', log)
  process.exitCode = 1
} finally {
  child.kill()
  child.stdout.destroy()
  child.stderr.destroy()
}
