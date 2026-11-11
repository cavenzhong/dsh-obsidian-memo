/** 包根目录、版本和调试日志；安装位置变化不影响旧配置迁移。 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url))

const LEGACY_SETTINGS_FILE = join(PACKAGE_DIR, 'data', 'settings.json')

const PACKAGE_JSON = createRequire(import.meta.url)('../../package.json')

const VERSION = typeof PACKAGE_JSON?.version === 'string' && PACKAGE_JSON.version !== '' ? PACKAGE_JSON.version : '0.0.0'

const DEBUG = process.env.DSH_STICKY_NOTES_DEBUG === '1'

function debugLog(...args) {
  if (DEBUG) console.info('[sticky-notes]', ...args)
}

function now() {
  return Date.now()
}

export { PACKAGE_DIR, LEGACY_SETTINGS_FILE, VERSION, debugLog, now }
