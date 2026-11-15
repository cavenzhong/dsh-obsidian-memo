/** 设置 →「便签」页的标题模式三卡、文件名限制提示与模板编辑。 */
import { FILE_NAME_PATTERN_MAX, FILE_NAME_TOKENS, TITLE_MODES } from '../constants.js';
import { React, h } from '../react.js';
import { buildPreviewName, insertPatternToken, nextTitleMode } from './note-title-pattern.js';

/** 三张便签纸插画：高亮位置分别对应文件名 / 正文首行 / 一级标题。 */
function TitleModeIcon(props) {
  const mode = props && props.mode;
  const muted = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.34 };
  const accent = 'var(--sn-accent)';
  return h('svg', {
    width: 46, height: 52, viewBox: '0 0 46 52', fill: 'none',
    'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
  },
    // 便签纸与折角
    h('rect', { x: 9.5, y: 5.5, width: 27, height: 41, rx: 3.5, stroke: 'currentColor', strokeWidth: 1.5, opacity: 0.32 }),
    h('path', { d: 'M28.5 5.5v9h8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round', opacity: 0.32 }),
    mode === 'filename'
      ? [
        // 文件名标签 + 一条引线
        h('rect', { key: 'tag', x: 13, y: 21, width: 20, height: 8, rx: 4, fill: accent, opacity: 0.92 }),
        h('path', { key: 'link', d: 'M23 19.5v-4.5M18.5 12.5h9', stroke: accent, strokeWidth: 1.6, strokeLinecap: 'round', opacity: 0.75 }),
        h('path', { key: 'l1', d: 'M15 35h16M15 40h11', ...muted }),
      ]
      : mode === 'firstLine'
        ? [
          h('rect', { key: 'first', x: 14, y: 14, width: 18, height: 4.5, rx: 2.25, fill: accent, opacity: 0.92 }),
          h('path', { key: 'l1', d: 'M14 25h18M14 31h14M14 37h17', ...muted }),
        ]
        : [
          // 大号 # + 标题条
          h('path', { key: 'h1', d: 'M18.5 13.5l-2.5 12M26.5 13.5l-2.5 12', stroke: accent, strokeWidth: 2.2, strokeLinecap: 'round' }),
          h('path', { key: 'h2', d: 'M14.5 18h14M13.5 23h14', stroke: accent, strokeWidth: 2, strokeLinecap: 'round', opacity: 0.9 }),
          h('path', { key: 'l1', d: 'M14 33h18M14 39h12', ...muted }),
        ],
  );
}

function TitleModeSettings(props) {
  const { t, mode, pattern, disabled, onChangeMode, onChangePattern } = props;
  const current = TITLE_MODES.includes(mode) ? mode : TITLE_MODES[0];
  const patternRef = React.useRef(null);
  const preview = buildPreviewName(pattern, { title: t('settings.fileNamePreviewTitle') });

  function handleKeyDown(event) {
    if (disabled) return;
    const next = nextTitleMode(current, event.key);
    if (next === null) return;
    event.preventDefault();
    onChangeMode(next);
    const group = event.currentTarget && event.currentTarget.parentElement;
    const buttons = group && typeof group.querySelectorAll === 'function'
      ? group.querySelectorAll('[role="radio"]')
      : null;
    const target = buttons && buttons[TITLE_MODES.indexOf(next)];
    if (target && typeof target.focus === 'function') target.focus();
  }

  function insertToken(token) {
    if (disabled) return;
    const input = patternRef.current;
    const value = typeof pattern === 'string' ? pattern : '';
    const start = input && typeof input.selectionStart === 'number' ? input.selectionStart : value.length;
    const end = input && typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
    const next = insertPatternToken(value, token, start, end);
    onChangePattern(next.value);
    if (input && typeof input.setSelectionRange === 'function') {
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(next.caret, next.caret);
      }, 0);
    }
  }

  return h('div', { className: 'SN_drawerSection SN_titleMode', 'data-sn-title-mode': '' },
    h('div', { className: 'SN_drawerSectionHead' },
      h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.titleMode'))),
    h('p', { className: 'SN_drawerSectionHint' }, t('settings.titleModeHint')),
    h('div', {
      className: 'SN_titleModeGrid', role: 'radiogroup', 'aria-label': t('settings.titleMode'),
    },
      TITLE_MODES.map((item) => h('button', {
        key: item,
        type: 'button',
        role: 'radio',
        'aria-checked': current === item,
        'aria-disabled': disabled ? 'true' : undefined,
        disabled: disabled,
        tabIndex: current === item ? 0 : -1,
        className: 'SN_titleModeCard',
        'data-mode': item,
        onClick: () => { if (!disabled) onChangeMode(item); },
        onKeyDown: handleKeyDown,
      },
        h('span', { className: 'SN_titleModeArt' }, h(TitleModeIcon, { mode: item })),
        h('span', { className: 'SN_titleModeName' }, t('settings.titleMode.' + item)),
        h('span', { className: 'SN_titleModeNote' }, t('settings.titleMode.' + item + 'Note')),
        current === item ? h('span', { className: 'SN_titleModeCheck', 'aria-hidden': 'true' }, '✓') : null,
      )),
    ),
    current === 'filename'
      ? h('p', { className: 'SN_titleModeFilenameHint' }, t('settings.titleMode.filenameHint'))
      : h('div', { className: 'SN_titleModeFile' },
        h('label', { className: 'SN_field' },
          h('span', { className: 'SN_fieldLabel' }, t('settings.fileNamePattern')),
          h('input', {
            ref: patternRef,
            type: 'text',
            className: 'SN_textInput',
            value: typeof pattern === 'string' ? pattern : '',
            maxLength: FILE_NAME_PATTERN_MAX,
            disabled: disabled,
            spellCheck: false,
            autoComplete: 'off',
            'aria-label': t('settings.fileNamePattern'),
            onChange: (event) => onChangePattern(event.target.value),
          }),
        ),
        h('div', { className: 'SN_titleModeTokens' },
          FILE_NAME_TOKENS.map((token) => h('button', {
            key: token,
            type: 'button',
            className: 'SN_titleModeToken',
            disabled: disabled,
            title: t('settings.fileNameToken.' + token.slice(1, -1)),
            onClick: () => insertToken(token),
          }, token)),
        ),
        h('p', { className: 'SN_titleModePreview' }, t('settings.fileNamePatternPreview', { name: preview + '.md' })),
        h('p', { className: 'SN_titleModeFileHint' }, t('settings.fileNamePatternHint')),
      ),
  );
}

export { TitleModeSettings, TitleModeIcon };
