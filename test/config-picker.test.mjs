import test from 'node:test'
import assert from 'node:assert/strict'
import { configFilePickerCommand, pickConfigFile } from '../lib/config-picker.js'

test('配置文件选择器：三平台只选择 JSON 文件，取消正常返回', async () => {
  assert.match(configFilePickerCommand('darwin').args[1], /choose file.*of type \{"json"\}/)
  assert.match(configFilePickerCommand('darwin').args[1], /on error number -128/)
  const windows = configFilePickerCommand('win32')
  assert.ok(windows.args.includes('-STA'))
  assert.match(Buffer.from(windows.args.at(-1), 'base64').toString('utf16le'), /OpenFileDialog/)
  assert.ok(configFilePickerCommand('linux').args.includes('--file-filter=JSON | *.json'))
  for (const platform of ['darwin', 'win32', 'linux']) {
    const path = '/选择的配置/含 空格.json'
    assert.equal(await pickConfigFile({ platform, exec(command, args, options, callback) { callback(null, path + '\n') } }), path)
    assert.equal(await pickConfigFile({ platform, exec(command, args, options, callback) { callback(null, '') } }), null)
  }
  assert.equal(await pickConfigFile({ platform: 'linux', exec(command, args, options, callback) { callback({ code: 1 }) } }), null)
})

test('配置文件选择器：系统错误与超时不能伪装成取消', async () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    await assert.rejects(pickConfigFile({ platform, exec(command, args, options, callback) {
      assert.equal(options.timeout, 600000)
      callback(Object.assign(new Error('未找到文件选择器'), { code: 'ENOENT' }))
    } }), { code: 'picker-unavailable' })
  }
})
