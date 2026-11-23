import test from 'node:test'
import assert from 'node:assert/strict'
import { PROJECT_TEXTURES, projectTexture } from '../../src/client/wall/project-textures.js'
import { wallStyles } from '../../src/client/styles/wall.js'

const keys = [
  'fiber', 'weave', 'pin-stars', 'engineering-grid', 'ruled-paper', 'bias',
  'topography', 'archive', 'tide', 'fold-parallel', 'fold-hatch', 'isometric', 'double-arc',
]

test('全部 13 款 Project 底纹可以由项目名稳定选到', () => {
  assert.deepEqual(PROJECT_TEXTURES.map(({ key }) => key), keys)
  const used = new Set(Array.from({ length: 100 }, (_, i) => projectTexture(`[[项目 ${i}]]`)))
  assert.deepEqual([...used].sort(), [...keys].sort())
  assert.equal(projectTexture('[[ Cafe\u0301.md#概况|别名 ]]'), projectTexture('[[Café]]'))
  assert.equal(projectTexture('[[Café]] [[其它项目]]'), projectTexture('[[Café]]'))
  for (const empty of [undefined, '', '项目', '[[ ]]', '[[#概况]]']) assert.equal(projectTexture(empty), undefined)
})

test('每种 Project 底纹使用非空自包含蒙版；D/E 只描边、无色块', () => {
  for (const { key, mask } of PROJECT_TEXTURES) {
    const [, data] = /^url\("data:image\/svg\+xml,(.+)"\)$/.exec(mask)
    const svg = decodeURIComponent(data)
    const marks = svg.match(/<g mask="url\(#fade\)"[^>]*>(.*)<\/g>/)[1]
    assert.match(marks, /<path [^>]+d="M[^"]+"/)
    assert.doesNotMatch(svg, /NaN|Infinity|<image|<script/)
    if (key.startsWith('fold-')) {
      const paths = marks.match(/<path [^>]*\/>/g)
      assert.equal(paths.length, key === 'fold-parallel' ? 9 : 16)
      for (const path of paths) assert.match(path, /fill="none" stroke=/)
    }
    assert.ok(wallStyles.includes(`[data-texture='${key}']{--sn-project-mask:${mask}}`), `缺 ${key} 样式`)
  }
  assert.match(wallStyles, /\.SN_card\[data-texture\] \.SN_cardClip::before\{[^}]*z-index:-1;pointer-events:none[^}]*mask:var\(--sn-project-mask\)/)
  assert.match(wallStyles, /body\[data-ds-dark-theme\] \.SN_card\[data-texture\] \.SN_cardClip::before\{background:#e6e6e6/)
})
