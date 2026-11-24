import test from 'node:test'
import assert from 'node:assert/strict'
import { hookRunner } from '../../test-support/client.mjs'

test('任务通知 hook：重渲染保留订阅，截断结果可打开预算设置，完成只提示一次', (t) => {
  const runner = hookRunner(t), toasts = []
  let opened = 0
  const options = {
    tRef: { current: (key) => key },
    pushToast: (toast) => toasts.push(toast),
    pushErrorToast: (error) => { throw error },
    onOpenSettings: () => { opened++ },
  }
  let controls = runner.render(runner.api.hooks.useJobNotifications, options)
  controls.watchedJobsRef.current.set('job', { kind: 'project', at: Date.now() })
  controls = runner.render(runner.api.hooks.useJobNotifications, options)
  const completed = [{ id: 'job', status: 'done', truncated: true }]
  controls.processJobs(completed)
  controls.processJobs(completed)
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].text, 'toast.budgetProjectTruncated')
  toasts[0].actions[0].run()
  assert.equal(opened, 1)
  assert.equal(controls.watchedJobsRef.current.size, 0)
})

test('Toast hook：保留最多四条通知，支持主动关闭，卸载清理计时器', (t) => {
  const runner = hookRunner(t)
  let controls = runner.render(runner.api.hooks.useToasts)
  for (let index = 0; index < 5; index++) controls.pushToast({ text: String(index), timeout: 10000 })
  controls = runner.render(runner.api.hooks.useToasts)
  assert.deepEqual(controls.toasts.map((toast) => toast.text), ['1', '2', '3', '4'])
  controls.dismissToast(controls.toasts[0].id)
  controls = runner.render(runner.api.hooks.useToasts)
  assert.deepEqual(controls.toasts.map((toast) => toast.text), ['2', '3', '4'])
})

test('CLI 预检失败的 toast 跳到引擎设置，不为结果不明的移动提供降级操作', (t) => {
  const runner = hookRunner(t)
  let opened = 0
  const props = { openEngineSettings: () => { opened += 1 }, engineSettingsLabel: '操作引擎' }
  const render = () => runner.render(runner.api.hooks.useToasts, props)
  render().pushErrorToast({ code: 'obsidian-cli-unavailable', message: '请先开启 CLI' })
  const notice = render().toasts[0]
  assert.equal(notice.text, '请先开启 CLI')
  assert.equal(notice.action.label, '操作引擎')
  notice.action.run()
  assert.equal(opened, 1)
  render().pushErrorToast({ code: 'obsidian-move-uncertain', message: '请检查实际文件' })
  assert.equal(render().toasts.at(-1).action, null)
})
