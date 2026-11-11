/** 空态与 toast 的展示组件；操作由调用方传入。 */
import { h } from '../react.js';

function CenterState(props) {
  return h('div', { className: 'SN_center' },
    props.mark ? h('div', { className: 'SN_centerMark', 'aria-hidden': 'true' }, props.mark) : null,
    h('h2', { className: 'SN_centerTitle' }, props.title),
    props.text ? h('p', { className: 'SN_centerText' }, props.text) : null,
    props.actionLabel
      ? h('button', {
        type: 'button',
        className: 'SN_primaryBtn',
        onClick: props.onAction,
        disabled: Boolean(props.actionDisabled),
      }, props.actionLabel)
      : null,
  );
}

function ToastStack(props) {
  const { toasts, onDismiss } = props;
  if (!toasts || toasts.length === 0) return null;
  return h('div', { className: 'SN_toasts', 'aria-live': 'polite' },
    toasts.map((item) => {
      // 0.13：一条 toast 可以带多个操作按钮（如「去设置 / 知道了」）；兼容旧的单个 action。
      const actions = Array.isArray(item.actions) && item.actions.length > 0
        ? item.actions
        : (item.action ? [item.action] : []);
      return h('div', {
        key: item.id,
        className: 'SN_toast',
        'data-kind': item.kind,
        role: 'status',
      },
        h('span', { className: 'SN_toastText' }, item.text),
        actions.map((action, index) => h('button', {
          key: index,
          type: 'button',
          className: 'SN_toastAction',
          onClick: () => {
            onDismiss(item.id);
            action.run();
          },
        }, action.label)),
      );
    }),
  );
}

export { CenterState, ToastStack };
