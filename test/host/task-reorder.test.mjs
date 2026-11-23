import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { makeCase } from '../../test-support/host.mjs';

const LF = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10), BOM = String.fromCharCode(0xFEFF);
async function setup(t, text, settings) {
  const c = await makeCase({ settings, notes: { '任务.md': text } });
  t.after(c.disposeAll);
  const path = c.seeded['任务.md'];
  const note = (await c.call('note', { path })).value;
  const move = (patch = {}) => c.call('reorderTask', { path, sourceLine: 0, targetLine: 1, after: true, expectedRevision: note.contentRevision, ...patch });
  return { c, path, note, move };
}

test('reorderTask：移动整项含子项，保留 YAML、BOM、CRLF、评论与 block id', async (t) => {
  const prefix = BOM + ['---', 'keep: true', 'PROJECT: 双链', '---', '', ''].join(CRLF);
  const first = ['- [ ] 一 ^task-a', '  - [x] 子项', '  续行'].join(CRLF);
  const second = '- [x] 二 [[链接]]';
  const tail = ['', '> [!note] 评论', '> 不应变化', ''].join(CRLF);
  const original = prefix + first + CRLF + second + CRLF + tail;
  const { c, path, note, move } = await setup(t, original);
  assert.equal(note.blocks[0].sourceLine, 0);
  assert.equal(note.blocks[1].indent, 2);
  const result = await move({ targetLine: 3 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(await readFile(path, 'utf8'), prefix + second + CRLF + first + CRLF + tail);
  const full = (await c.call('note', { path })).value;
  assert.deepEqual(full.blocks.filter((block) => typeof block.checked === 'boolean').map((block) => block.text), ['二 链接', '一', '子项']);
  assert.equal(full.comments.length, 1);
  assert.notEqual(full.contentRevision, note.contentRevision);
});

test('reorderTask：无 YAML 的首行任务保留 BOM 和无末尾换行', async (t) => {
  const { path, move } = await setup(t, BOM + '- [ ] 一' + CRLF + '- [x] 二');
  assert.equal((await move()).ok, true);
  assert.equal(await readFile(path, 'utf8'), BOM + '- [x] 二' + CRLF + '- [ ] 一');
});

test('reorderTask：首部空行保留，源行偏移与阅读正文对应', async (t) => {
  const original = LF + LF + '- [ ] 一' + LF + '- [ ] 二' + LF;
  const { path, note, move } = await setup(t, original);
  assert.equal(note.bodyLineOffset, 2);
  assert.equal(note.blocks[0].sourceLine, 2);
  const result = await move({ sourceLine: 2, targetLine: 3 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(await readFile(path, 'utf8'), LF + LF + '- [ ] 二' + LF + '- [ ] 一' + LF);
});

test('reorderTask：不允许移动代码样例、跨层级、跨段落或非任务项', async (t) => {
  const lines = ['- [ ] 一', '  - [ ] 子项', '- 普通圆点', '', '段落', '- [ ] 二', '', '```md', '- [ ] 示例', '```'];
  const original = lines.join(LF);
  const { path, move } = await setup(t, original);
  for (const patch of [{ targetLine: 1 }, { targetLine: 2 }, { targetLine: 5 }, { targetLine: 8 }, { sourceLine: -1 }, { sourceLine: '0' }, { after: 'yes' }, { targetLine: 0 }]) {
    const result = await move(patch);
    assert.equal(result.error?.code, 'bad-request', JSON.stringify(patch));
    assert.equal(await readFile(path, 'utf8'), original);
  }
});

test('reorderTask：外部修改（含仅 YAML）、缺少版本都拒绝覆盖', async (t) => {
  const original = ['---', 'keep: true', '---', '', '- [ ] 一', '- [ ] 二', ''].join(LF);
  const { path, move } = await setup(t, original);
  assert.equal((await move({ expectedRevision: undefined })).error?.code, 'conflict');
  const changed = original.replace('keep: true', 'keep: 用户修改');
  await writeFile(path, changed);
  assert.equal((await move()).error?.code, 'conflict');
  assert.equal(await readFile(path, 'utf8'), changed);
});

test('reorderTask：并发旧版本只接受一次，写锁与 toggleTask 共用', async (t) => {
  const { c, path, note, move } = await setup(t, ['- [ ] 一', '- [ ] 二', ''].join(LF));
  const results = await Promise.all([move(), c.call('toggleTask', { path, sourceLine: 0, checked: true, expectedBody: note.body })]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.error?.code === 'conflict').length, 1);
});

test('设置提示词默认值：Host 覆盖全部项目与自定义预设，用户配置不覆盖默认元数据', async (t) => {
  const { c } = await setup(t, '- [ ] 一', { projectCheckPrompt: '用户分析', projectPrompt: '用户项目', projectAddPrompt: '用户补充', emojis: [{ id: 'custom', emoji: '✨', label: '自定义', prompt: '用户预设' }] });
  const state = (await c.call('state')).value;
  const defaults = state.settings.promptDefaults;
  for (const key of ['projectCheckPrompt', 'projectPrompt', 'projectAddPrompt', 'customEmoji']) {
    assert.equal(typeof defaults[key], 'string');
    assert.ok(defaults[key].length > 0);
    assert.notEqual(defaults[key], state.settings[key]);
  }
  assert.ok(Object.keys(defaults.emojis).length > 0);
  assert.equal(state.settings.emojis[0].prompt, '用户预设');
  assert.equal(defaults.emojis.custom, undefined, '自定义预设恢复使用统一 customEmoji 默认值');
});
