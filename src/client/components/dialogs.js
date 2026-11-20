/** 项目名称和重复评论确认框；不发送 RPC。 */
import { h } from '../react.js';

function ProjectDialog({ t, name, busy, check, onName, onConfirm, onCancel }) {
  if (!check) return null;
  const level = check?.level || '';
  return h('div', { className: 'SN_dialogLayer', 'data-window-drag-exclude': '', onMouseDown: (event) => { if (event.target === event.currentTarget && !busy) onCancel(); } },
    h('form', { className: 'SN_dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('project.title'),
      onSubmit: (e) => { e.preventDefault(); if (!busy) onConfirm(); } },
      h('h2', { className: 'SN_dialogTitle' }, t('project.title')),
      h('p', { className: 'SN_dialogText' }, t('project.checkReady')),
      h('label', { className: 'SN_field' }, t('project.nameLabel'), h('input', { className: 'SN_textInput', value: name || '', maxLength: 60, disabled: busy, autoFocus: true, onChange: (e) => onName(e.target.value) }),
        h('small', { className: 'SN_fieldHint' }, name ? name.trim() + '-项目.md' : '')),
      h('aside', { className: 'SN_projectCheck', 'data-level': level }, h('strong', null, t('project.rating.' + level)), h('p', null, check.reason || t('project.checkFallback'))),
      h('div', { className: 'SN_dialogActions' }, h('button', { type: 'button', className: 'SN_ghostBtn', disabled: busy, onClick: onCancel }, t('project.cancel')),
        h('button', { type: 'submit', className: 'SN_primaryBtn', disabled: busy || !name?.trim() }, t(level === '不建议' ? 'project.override' : 'project.createNew')))));
}

function ConfirmDialog(props) {
  const { title, text, confirmLabel, cancelLabel, onConfirm, onCancel } = props;
  return h('div', {
    className: 'SN_dialogLayer',
    // 遮罩盖住顶栏拖动行；声明排除后，遮罩在窗口顶部也能正常接收点击关闭。
    'data-window-drag-exclude': '',
    onMouseDown: (event) => {
      if (event.target === event.currentTarget) onCancel();
    },
  },
    h('div', { className: 'SN_dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', { className: 'SN_dialogTitle' }, title),
      h('p', { className: 'SN_dialogText' }, text),
      h('div', { className: 'SN_dialogActions' },
        h('button', { type: 'button', className: 'SN_ghostBtn', onClick: onCancel }, cancelLabel),
        h('button', { type: 'button', className: 'SN_primaryBtn', autoFocus: true, onClick: onConfirm }, confirmLabel),
      ),
    ),
  );
}

export { ProjectDialog, ConfirmDialog };
