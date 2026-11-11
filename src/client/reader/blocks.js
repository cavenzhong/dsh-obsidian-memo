/** 阅读模式的 Markdown 块、任务与评论渲染。 */
import { NoteImage } from '../images/components.js';
import { h } from '../react.js';
import { commentHead } from '../wall/model.js';

function NoteBlock(props) {
  const block = props.block || {};
  const text = typeof block.text === 'string' ? block.text : '';
  if (block.kind === 'h') return h('h4', { className: 'SN_blockH' }, text);
  if (block.kind === 'hr') return h('hr', { className: 'SN_blockHr' });
  if (block.kind === 'image') return h(NoteImage, { path: props.path, source: block.source, alt: block.alt, wiki: block.wiki });
  if (block.kind === 'li') {
    if (typeof block.checked === 'boolean') {
      const ordered = typeof block.marker === 'string';
      return h('div', { className: 'SN_blockLi SN_blockTask' + (ordered ? ' SN_blockOrdered' : '') },
        ordered ? h('span', { className: 'SN_listNumber' }, block.marker) : null,
        h('button', {
          type: 'button',
          className: 'SN_taskCheck',
          role: 'checkbox',
          'aria-checked': block.checked,
          disabled: props.taskBusy,
          'data-checked': block.checked ? 'true' : 'false',
          'aria-label': block.checked ? '取消勾选' : '标记完成',
          onClick: () => props.onToggleTask(block.sourceLine, !block.checked),
        }, block.checked ? '✓' : ''),
        h('span', { className: 'SN_taskText' }, text),
      );
    }
    if (typeof block.marker === 'string') return h('div', { className: 'SN_blockLi SN_blockOrdered' },
      h('span', { className: 'SN_listNumber' }, block.marker), h('span', { className: 'SN_listText' }, text));
    return h('div', { className: 'SN_blockLi' }, text);
  }
  if (block.kind === 'quote') return h('blockquote', { className: 'SN_blockQuote' }, text);
  if (block.kind === 'code') return h('pre', { className: 'SN_blockCode' }, text);
  return h('p', { className: 'SN_blockP' }, text);
}

function NoteComment(props) {
  const comment = props.comment || {};
  const head = commentHead(comment);
  return h('div', { className: 'SN_commentCard' },
    h('div', { className: 'SN_commentCardHead' },
      h('span', { className: 'SN_commentCardLabel' }, head),
      comment.time ? h('span', { className: 'SN_commentCardTime' }, comment.time) : null,
    ),
    h('div', { className: 'SN_commentCardBody' }, comment.text || ''),
  );
}

export { NoteBlock, NoteComment };
