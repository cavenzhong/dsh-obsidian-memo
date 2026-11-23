import test from 'node:test';
import assert from 'node:assert/strict';
import { canMoveListAtSelection, editListAtSelection, moveListItem } from '../../src/shared/list-editing.js';

const LF = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10), TAB = String.fromCharCode(9);
const edit = (text, action, needle = '工作') => { const position = text.indexOf(needle); return editListAtSelection(text, position, position + needle.length, action); };

test('列表快捷操作：无标记 → 圆点 → 未完成 → 已完成 → 无标记，保留正文、缩进和选区', () => {
  const base = ['前文', '  工作 [[链接]] ^block-id', '后文', ''].join(CRLF);
  let text = base;
  for (const prefix of ['- ', '- [ ] ', '- [x] ', '']) {
    const result = edit(text, 'cycle');
    assert.equal(result.text, base.replace('工作', prefix + '工作'));
    assert.equal(result.text.slice(result.start, result.end), '工作');
    text = result.text;
  }
  for (const marker of ['-', '*', '+', '12.', '3)']) {
    const bullet = '  ' + marker + '  工作';
    const todo = edit(bullet, 'cycle');
    assert.equal(todo.text, bullet.replace('工作', '[ ] 工作'));
    const done = edit(todo.text, 'cycle');
    assert.equal(done.text, bullet.replace('工作', '[x] 工作'));
    assert.equal(edit(done.text, 'cycle').text, /^\d/.test(marker) ? bullet : '  工作');
  }
  assert.equal(edit('- [X] 工作', 'cycle').text, '工作');
  const nested = ['- 父项', '    - [x] 工作'].join(LF);
  const unmarked = edit(nested, 'cycle').text;
  assert.equal(unmarked, nested.replace('- [x] ', ''));
  assert.equal(edit(unmarked, 'cycle').text, nested.replace('[x] ', ''));
  assert.equal(editListAtSelection('', 0, 0, 'cycle').text, '- ');
  assert.equal(editListAtSelection('-', 1, 1, 'cycle').text, '- [ ] ');
  assert.equal(editListAtSelection('- [ ]', 5, 5, 'cycle').text, '- [x]');
  assert.equal(editListAtSelection('- [x]', 5, 5, 'cycle').text, '');
});

test('列表快捷操作：正文仅可切换标记，引用、标题、代码、分隔线和跨行选区不触发', () => {
  for (const action of ['up', 'down', 'indent', 'outdent']) assert.equal(edit('工作段落', action), null);
  for (const text of ['> - 工作', '# 工作', '    工作', ['```md', '- 工作', '```'].join(LF), ['~~~', '- 工作', '~~~'].join(LF)]) {
    for (const action of ['cycle', 'up', 'down', 'indent', 'outdent']) assert.equal(edit(text, action), null);
  }
  for (const rule of ['---', '* * *', '_ _ _']) assert.equal(editListAtSelection(rule, 0, 0, 'cycle'), null);
  assert.equal(editListAtSelection('- 工作' + LF + '- 二', 2, 8, 'cycle'), null);
  assert.equal(editListAtSelection('- 工作', -1, 0, 'cycle'), null);
});

test('列表换行提示：只有能实际与同层级相邻项换位的选区才符合条件', () => {
  for (const text of ['- 工作', ['- 工作', '  - 子项'].join(LF), ['- 工作', '', '- 另一项'].join(LF)]) {
    assert.equal(canMoveListAtSelection(text, 2, 4), false);
  }
  const siblings = ['- 工作', '  续行', '  - 子项', '- 另一项'].join(CRLF);
  assert.equal(canMoveListAtSelection(siblings, 2, 4), true);
  assert.equal(canMoveListAtSelection(siblings, siblings.length, siblings.length), true);
  assert.equal(canMoveListAtSelection(siblings, 2, siblings.length), false);
});

test('列表上下移动：整项包含子项与续行，保留末尾换行和光标选区', () => {
  const lines = ['- [ ] 工作', '  续行', '  - [x] 子项', '- 二'];
  const original = lines.join(CRLF);
  const down = edit(original, 'down');
  assert.equal(down.text, [lines[3], ...lines.slice(0, 3)].join(CRLF));
  assert.equal(down.text.slice(down.start, down.end), '工作');
  assert.equal(edit(down.text, 'up').text, original);
  assert.equal(edit(lines.join(LF), 'up', '二').text, ['- 二', ...lines.slice(0, 3)].join(LF));
  const moved = moveListItem(original, 0, 3, true);
  assert.equal(moved.line, 1);
  assert.equal(moved.text, down.text);
});

test('列表拖动：支持前后插入，不跨段落、空行、层级或代码', () => {
  const text = ['- [ ] 工作', '- [x] 二', '- [ ] 三', ''].join(LF);
  assert.equal(moveListItem(text, 2, 0, false).text, ['- [ ] 三', '- [ ] 工作', '- [x] 二', ''].join(LF));
  assert.equal(moveListItem(text, 0, 2, true).text, ['- [x] 二', '- [ ] 三', '- [ ] 工作', ''].join(LF));
  for (const lines of [['- [ ] 工作', '', '- [ ] 二'], ['- [ ] 工作', '正文', '- [ ] 二'], ['- [ ] 工作', '  - [ ] 子项', '- 二']]) {
    assert.equal(moveListItem(lines.join(LF), 0, 1, false), null);
  }
  assert.equal(moveListItem(text, 0, 0, true), null);
  assert.equal(moveListItem(text, 0, 1, false), null, '相邻原位置不写盘');
  assert.equal(moveListItem(text, '0', 2, true), null);
  assert.equal(moveListItem(['```', '- [ ] 工作', '```', '- [ ] 二'].join(LF), 1, 3, true), null);
});

test('列表缩进：整项同移两空格，Tab 可退一级，顶层左移不触发', () => {
  const text = ['- 工作', '  - 子项', '    续行', '- 二'].join(LF);
  const nested = edit(text, 'indent');
  assert.equal(nested.text, ['  - 工作', '    - 子项', '      续行', '- 二'].join(LF));
  assert.equal(nested.text.slice(nested.start, nested.end), '工作');
  assert.equal(edit(nested.text, 'outdent').text, text);
  assert.equal(edit(text, 'outdent'), null);
  assert.equal(edit(TAB + '- 工作', 'outdent').text, '- 工作');
});

test('列表移动：缩进子项不跨父级，混合换行分隔符保持原位置', () => {
  const nested = ['- 父级', '  - 工作', '  - 二', '- 下个父级', '  - 三'].join(LF);
  assert.equal(edit(nested, 'down').text, ['- 父级', '  - 二', '  - 工作', '- 下个父级', '  - 三'].join(LF));
  assert.equal(edit(nested, 'up'), null);
  const mixed = '- 工作' + CRLF + '- 二' + LF + '- 三';
  assert.equal(moveListItem(mixed, 0, 2, true).text, '- 二' + CRLF + '- 三' + LF + '- 工作');
});


test('列表边界：拖动、换位和缩进不可切开包含空行或未闭合的子项代码围栏', () => {
  for (const tail of [['', '  const b = 2', '  ```'], []]) {
    const lines = ['- 甲', '- 工作', '  ```js', '  const a = 1', ...tail];
    const body = lines.join(LF);
    assert.equal(moveListItem(body, 1, 0, false), null);
    assert.equal(moveListItem(body, 0, 1, true), null);
    assert.equal(edit(body, 'up'), null);
    assert.equal(edit(body, 'indent'), null);
    assert.equal(canMoveListAtSelection(body, 6, 8), false);
  }
  const intact = ['- 工作', '  ```js', '  const a = 1', '  ```', '- 末项'];
  assert.equal(moveListItem(intact.join(LF), 0, 4, true).text, [intact[4], ...intact.slice(0, 4)].join(LF));
});
