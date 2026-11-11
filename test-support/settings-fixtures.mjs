import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { LEGACY_EMOJIS } from '../lib/shared.js'

async function writeRawSettings(file, value) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8')
}

function legacyEmojis() {
  return LEGACY_EMOJIS.map((item) => ({ ...item }))
}

export { writeRawSettings, legacyEmojis }
