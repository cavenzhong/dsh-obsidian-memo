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
