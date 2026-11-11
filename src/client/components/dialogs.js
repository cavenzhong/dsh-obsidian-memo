/** 项目名称和重复评论确认框；不发送 RPC。 */
import { h } from '../react.js';

function ProjectDialog(props) {
  const { t, note, name, busy, onName, onConfirm, onCancel } = props;
  const title = note.title || note.name || '';
  return h('div', {
    className: 'SN_dialogLayer',
    onMouseDown: (event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    },
  },
    h('div', { className: 'SN_dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('project.title') },
      h('h2', { className: 'SN_dialogTitle' }, t('project.title')),
      h('p', { className: 'SN_dialogText' }, t('project.desc', { name: title })),
      h('label', { className: 'SN_field' },
        h('span', { className: 'SN_fieldLabel' }, t('project.nameLabel')),
        h('input', {
          type: 'text',
          className: 'SN_textInput',
          autoFocus: true,
          value: name,
          disabled: busy,
          placeholder: t('project.namePlaceholder'),
          onChange: (event) => onName(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              if (!busy) onConfirm();
            }
          },
        }),
      ),
      h('div', { className: 'SN_dialogActions' },
        h('button', { type: 'button', className: 'SN_ghostBtn', disabled: busy, onClick: onCancel }, t('project.cancel')),
        h('button', {
          type: 'button',
          className: 'SN_primaryBtn',
          disabled: busy || name.trim() === '',
          onClick: onConfirm,
        }, busy ? t('project.busy') : t('project.confirm')),
      ),
    ),
  );
}

function ConfirmDialog(props) {
  const { title, text, confirmLabel, cancelLabel, onConfirm, onCancel } = props;
  return h('div', {
    className: 'SN_dialogLayer',
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
