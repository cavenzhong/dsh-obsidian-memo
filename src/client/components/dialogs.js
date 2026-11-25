/** 重复评论确认框；不发送 RPC。 */
import { h } from '../react.js';

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

export { ConfirmDialog };
