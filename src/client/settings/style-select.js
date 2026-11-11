/** callout 样式选择菜单。 */
import { React, h } from '../react.js';
import { CALLOUT_IDS } from './callouts.js';

function StyleSelect(props) {
  const { t, value, disabled, onChange } = props;
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (wrapRef.current && target && wrapRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [open]);
  const current = CALLOUT_IDS.indexOf(value) >= 0 ? value : 'note';
  const labelFor = (id) => t('settings.calloutValue', { style: t('callout.' + id) });
  return h('div', { className: 'SN_styleWrap', ref: wrapRef },
    h('button', {
      type: 'button',
      className: 'SN_styleBtn',
      disabled: disabled,
      'aria-haspopup': 'menu',
      'aria-expanded': open ? 'true' : 'false',
      'aria-label': t('settings.callout'),
      title: labelFor(current),
      onClick: () => setOpen((flag) => !flag),
    }, h('span', { className: 'SN_styleText' }, labelFor(current))),
    open
      ? h('div', {
        className: 'SN_styleMenu',
        role: 'menu',
        'aria-label': t('settings.callout'),
      },
        CALLOUT_IDS.map((id) => h('button', {
          key: id,
          type: 'button',
          className: 'SN_styleItem',
          role: 'menuitemradio',
          'aria-checked': id === current ? 'true' : 'false',
          'data-active': id === current ? 'true' : 'false',
          onClick: () => {
            onChange(id);
            setOpen(false);
          },
        },
          h('span', { className: 'SN_styleCheck', 'aria-hidden': 'true' }, id === current ? '✓' : ''),
          h('span', null, labelFor(id)),
        )),
      )
      : null,
  );
}

export { StyleSelect };
