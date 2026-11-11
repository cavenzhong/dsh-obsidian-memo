/** 图片压缩与尺寸设置视图。 */
import { readImageCompression } from '../capture/images.js';
import { h } from '../react.js';

function ImageProcessingSettings({ t, value, disabled, onChange, children }) {
  const config = readImageCompression(value);
  const numeric = (field, min, max, label) => h('label', { className: 'SN_field' },
    h('span', { className: 'SN_fieldLabel' }, t(label)),
    h('input', { type: 'number', className: 'SN_textInput', key: field + ':' + config[field],
      defaultValue: config[field], min, max, step: 1, disabled: disabled || !config.enabled,
      'aria-label': t(label), onBlur: (event) => {
        const raw = event.target.value.trim();
        const next = readImageCompression({ ...config, [field]: raw === '' ? config[field] : Number(raw) });
        onChange(next); event.target.value = String(next[field]);
      }, onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); } },
    }));
  return h('div', { className: 'SN_drawerSection', 'data-sn-image-processing': '' },
    h('div', { className: 'SN_drawerSectionHead' }, h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.images'))),
    children,
    h('label', { className: 'SN_imageSettingToggle' },
      h('input', { type: 'checkbox', checked: config.enabled, disabled,
        onChange: (event) => onChange({ ...config, enabled: event.target.checked }) }),
      h('span', null, t('settings.compressWebp'))),
    h('p', { className: 'SN_drawerSectionHint' }, t('settings.imagesHint')),
    h('div', { className: 'SN_imageSettingNumbers' },
      numeric('quality', 1, 100, 'settings.imageQuality'),
      numeric('maxDimension', 256, 8192, 'settings.imageResolution')),
  );
}

export { ImageProcessingSettings };
