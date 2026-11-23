/** 浏览器级界面偏好，不参与设置草稿或 Host 配置。 */
import { h } from '../react.js';

function LanguageSettings({ t, value = 'system', onChange }) {
  return h('section', { className: 'SN_drawerSection' },
    h('label', { className: 'SN_field' },
      h('span', { className: 'SN_drawerSectionTitle' }, t('settings.language')),
      h('select', { className: 'SN_select', value, disabled: !onChange, onChange: (event) => onChange?.(event.target.value) },
        h('option', { value: 'system' }, t('settings.languageSystem')),
        h('option', { value: 'zh', lang: 'zh-CN' }, '简体中文'),
        h('option', { value: 'en', lang: 'en' }, 'English'))),
    h('p', { className: 'SN_fieldHint' }, t('settings.languageHint')));
}

export { LanguageSettings };
