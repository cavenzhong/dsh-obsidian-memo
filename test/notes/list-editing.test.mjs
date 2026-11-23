import test from 'node:test';
import assert from 'node:assert/strict';
import { editListAtSelection, moveListItem } from '../../src/shared/list-editing.js';

const LF = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10), TAB = String.fromCharCode(9);
const edit = (text, action, needle = '工作') => { const position = text.indexOf(needle); return editListAtSelection(text, position, position + needle.length, action); };

test('列表快捷操作：圆点 → 未完成 → 已完成 → 圆点，保留标记、正文与其它行', () => {
  for (const marker of ['-', '*', '+', '12.', '3)']) {
    const original = ['前文', '  ' + marker + '  工作 [[链接]] ^block-id', '后文', ''].join(CRLF);
    const todo = edit(original, 'cycle');
    assert.equal(todo.text, original.replace('工作', '[ ] 工作'));
    const done = edit(todo.text, 'cycle');
    assert.equal(done.text, original.replace('工作', '[x] 工作'));
    const bullet = edit(done.text, 'cycle');
    assert.equal(bullet.text, original);
    assert.equal(bullet.text.slice(bullet.start, bullet.end), '工作');
  }
  assert.equal(edit('- [X] 工作', 'cycle').text, '- 工作');
  assert.equal(editListAtSelection('- ', 2, 2, 'cycle').text, '- [ ] ');
});

test('列表快捷操作：普通段落、引用、围栏代码、跨行选区不触发', () => {
  for (const text of ['工作段落', '> - 工作', ['```md', '- 工作', '```'].join(LF), ['~~~', '- 工作', '~~~'].join(LF)]) {
    for (const action of ['cycle', 'up', 'down', 'indent', 'outdent']) assert.equal(edit(text, action), null);
  }
  assert.equal(editListAtSelection('- 工作' + LF + '- 二', 2, 8, 'cycle'), null);
  assert.equal(editListAtSelection('- 工作', -1, 0, 'cycle'), null);
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
