/** Only edit a top-level project property; keep every byte outside that property intact. */
function projectField(text, key) {
  const bom = text.startsWith('\uFEFF') ? 1 : 0
  const raw = text.slice(bom)
  const start = /^---[^\S\r\n]*(\r\n|\n|\r)/u.exec(raw)
  const end = start && /^(?:---|\.\.\.)[^\S\r\n]*$/mu.exec(raw.slice(start[0].length))
  if (!end) return { insert: bom, eol: raw.match(/\r\n|\n|\r/u)?.[0] || '\n' }
  const offset = bom + start[0].length, insert = offset + end.index
  const lines = text.slice(offset, insert).matchAll(/([^\r\n]*)(?:\r\n|\n|\r)/gu)
  let field, nested = false
  for (const line of lines) {
    const content = line[1]
    if (!content.trim() || /^\s*#/u.test(content)) continue
    if (nested && /^(?:\s|-(?:\s|$))/u.test(content)) {
      field.value ||= content.trim(); continue
    }
    nested = false
    const match = /^(?:"([^"\\]+)"|'([^']+)'|([^\s:]+))\s*:(.*)$/u.exec(content)
    if (!match || (match[1] || match[2] || match[3]) !== key) continue
    if (field) { field.value ||= 'duplicate'; break }
    const value = match[4].trim()
    field = { from: offset + line.index, to: offset + line.index + content.length,
      value: /^(?:\[\]|""|''|~|null)?$/iu.test(value) ? null : value }
    nested = true
  }
  return { frontmatter: true, insert, eol: start[1], field }
}

export function readProjects(text, key = 'PROJECTS') {
  return projectField(String(text ?? ''), key).field?.value || null
}

export function setProjectsLink(text, wikilink, key = 'PROJECTS') {
  const { frontmatter, insert, eol, field } = projectField(text, key)
  if (field?.value) return { text, changed: false, reason: 'non-empty' }
  const property = `${key}: ${JSON.stringify(wikilink)}`
  if (field) return { text: text.slice(0, field.from) + property + text.slice(field.to), changed: true, reason: 'updated' }
  const prefix = frontmatter ? property + eol : ['---', property, '---', '', ''].join(eol)
  return { text: text.slice(0, insert) + prefix + text.slice(insert), changed: true, reason: frontmatter ? 'added' : 'created' }
}
