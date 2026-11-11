/** 合成临时仓库；只测 Host 扫描/缓存和排序计算，不写真实配置或仓库。 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const source = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'))
const { NotesScanner } = await import(pathToFileURL(join(source, 'lib/scan.js')))
if (!global.gc) throw new Error('请使用 pnpm bench，或 node --expose-gc scripts/benchmark.mjs')

const root = await mkdtemp(join(tmpdir(), 'memo-benchmark-'))
try {
  const notesDir = join(root, 'notes'), paragraph = '便签性能测试 abcdefghijklmnop\n\n'.repeat(2000)
  await mkdir(notesDir)
  for (let i = 0; i < 1000; i++) await writeFile(join(notesDir, `${i}.md`), `${i}\n\n${paragraph}`)
  global.gc()
  const beforeHeap = process.memoryUsage().heapUsed
  const scanner = new NotesScanner(), settings = { vaultPath: root, notesDir }
  let started = performance.now()
  const first = await scanner.scan(settings)
  const coldMs = performance.now() - started
  global.gc()
  const retainedHeapMiB = (process.memoryUsage().heapUsed - beforeHeap) / 1024 / 1024
  started = performance.now()
  await scanner.scan(settings)
  const warmMs = performance.now() - started
  const edited = join(notesDir, '0.md')
  await writeFile(edited, '一个已更新的便签\n')
  scanner.invalidate(edited)
  started = performance.now()
  const next = await scanner.scan(settings)
  const editMs = performance.now() - started
  const originals = new Set(first.notes)
  const reusedSummariesAfterEdit = next.notes.filter((note) => originals.has(note)).length

  // 使用与行为测试相同的 bundle 加载方式；无需浏览器或 React 依赖。
  let registration
  const window = { __ModuleLoader__: { load(value) { registration = value } } }
  new Function('window', await readFile(join(source, 'lib/client.js'), 'utf8'))(window)
  const react = { createElement() {}, memo(fn) { return fn }, Fragment: Symbol() }
  const api = registration.factory((name) => name === 'react' ? react : {}).__test
  const names = Array.from({ length: 5000 }, (_, i) => ({ name: `便签 ${(i * 3271) % 5000}`, created: 1, mtime: 1 }))
  started = performance.now()
  api.sortNotes(names, 'name-asc')
  const nameSortMs = performance.now() - started

  const round = (value) => Math.round(value * 100) / 100
  console.log(JSON.stringify({
    node: process.version,
    notes: first.notes.length,
    approximateNoteKiB: round(Buffer.byteLength(paragraph) / 1024),
    coldMs: round(coldMs), warmMs: round(warmMs), editMs: round(editMs),
    retainedHeapMiB: round(retainedHeapMiB), reusedSummariesAfterEdit,
    sortNotes: names.length, nameSortMs: round(nameSortMs),
  }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
