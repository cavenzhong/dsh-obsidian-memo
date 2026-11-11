import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const clientRoot = resolve(root, 'src/client')
const libRoot = resolve(root, 'lib')
const bundle = resolve(libRoot, 'client.js')
const paths = (await Promise.all([clientRoot, libRoot].map(async (directory) => (
  (await readdir(directory, { recursive: true }))
    .filter((path) => path.endsWith('.js'))
    .map((path) => resolve(directory, path))
)))).flat().filter((path) => path !== bundle)
const sources = new Map(await Promise.all(paths.map(async (path) => [path, await readFile(path, 'utf8')])))
const label = (path) => relative(root, path)
const inClient = (path) => path.startsWith(clientRoot + sep)
const inHost = (path) => path.startsWith(resolve(libRoot, 'host') + sep)

test('架构：手写生产模块不超过 500 行，生成文件单独管理', () => {
  const oversized = [...sources].filter(([, source]) => source.trimEnd().split('\n').length > 500)
  assert.deepEqual(oversized.map(([path]) => label(path)), [], '按职责拆分超限文件')
})

test('架构：静态依赖无环，浏览器与 Host 边界清晰，基础模块不反向依赖组合层', () => {
  const graph = new Map()
  for (const [path, source] of sources) {
    const dependencies = []
    for (const match of source.matchAll(/^import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/gm)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) {
        if (inClient(path)) assert.ok(['react', 'react-dom'].includes(specifier), `${label(path)}: ${specifier}`)
        else assert.ok(specifier.startsWith('node:'), `${label(path)}: ${specifier}`)
        continue
      }
      const dependency = resolve(dirname(path), specifier)
      assert.ok(sources.has(dependency), `${label(path)} 引用了不存在的生产模块 ${specifier}`)
      assert.equal(inClient(path), inClient(dependency), `${label(path)} 跨越了运行环境边界`)
      if (!inClient(path) && !inHost(path) && path !== resolve(libRoot, 'index.js')) {
        assert.ok(!inHost(dependency) && dependency !== resolve(libRoot, 'index.js'), `${label(path)} 反向依赖组合层`)
      }
      dependencies.push(dependency)
    }
    graph.set(path, dependencies)
  }
  const visiting = new Set(), visited = new Set()
  function visit(path, chain = []) {
    assert.ok(!visiting.has(path), `循环依赖：${[...chain, path].map(label).join(' → ')}`)
    if (visited.has(path)) return
    visiting.add(path)
    for (const dependency of graph.get(path)) visit(dependency, [...chain, path])
    visiting.delete(path)
    visited.add(path)
  }
  for (const path of graph.keys()) visit(path)
})
