/** 原生 JSON 文件选择；目录选择仍使用 DSH 的 directoryPickerController。 */
import { execFile } from 'node:child_process'
import { failure } from './files.js'

let pickerOverride = null
export function setConfigFilePickerForTests(picker) { pickerOverride = picker }

export function configFilePickerCommand(platform = process.platform) {
  if (platform === 'darwin') return { command: '/usr/bin/osascript', args: ['-e',
    'try\nreturn POSIX path of (choose file with prompt "选择 JSON 配置文件" of type {"json"})\non error number -128\nreturn ""\nend try'] }
  if (platform === 'win32') {
    const script = '[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; $picker=New-Object System.Windows.Forms.OpenFileDialog; $picker.Title="Select JSON configuration"; $picker.Filter="JSON (*.json)|*.json"; $picker.Multiselect=$false; try { if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($picker.FileName) } } finally { $picker.Dispose() }'
    return { command: 'powershell.exe', args: ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] }
  }
  return { command: 'zenity', args: ['--file-selection', '--title=Select JSON configuration', '--file-filter=JSON | *.json'] }
}

export function pickConfigFile({ platform = process.platform, exec = execFile } = {}) {
  if (pickerOverride) return Promise.resolve().then(pickerOverride)
  const { command, args } = configFilePickerCommand(platform)
  return new Promise((resolve, reject) => {
    exec(command, args, { timeout: 10 * 60 * 1000, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      // Zenity 用 exit 1 表示取消；macOS / Windows 的取消返回空输出。
      if (error && platform !== 'darwin' && platform !== 'win32' && error.code === 1) return resolve(null)
      if (error) return reject(failure('picker-unavailable', '文件选择失败：' + error.message, error))
      resolve(String(stdout || '').trim() || null)
    })
  })
}
