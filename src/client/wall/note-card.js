/** 可 memo 的卡片展示与事件转发；通过稳定 actions ref 调用交互。 */
import { ActionIcon, ObsidianIcon } from '../components/icons.js';
import { MAX_CARD_COMMENT_GROUPS } from '../constants.js';
import { imageCacheKey } from '../images/cache.js';
import { CardThumb } from '../images/components.js';
import { React, h } from '../react.js';
import { DEFAULT_NOTE_COLOR } from '../styles/tokens.js';
import { cardCommentGroups, cardImages, emojiLabel } from './model.js';

const NoteCard = React.memo(function NoteCard(props) {
  const {
    note, emojis, pending, hoverActive, drawerOpen, actions,
  } = props;
  const t = actions.current.t;
  const color = typeof note.color === 'string' && note.color !== '' ? note.color : DEFAULT_NOTE_COLOR;
  // Host 的深色配套纸色；缺失（旧数据/未升级 Host）时回退到浅色纸色。
  const darkColor = typeof note.darkColor === 'string' && note.darkColor !== '' ? note.darkColor : color;
  const title = note.title || note.name || '';
  const excerpt = typeof note.excerpt === 'string' ? note.excerpt : '';
  // 有图时：标题仍 3 行、摘要 1 行、评论 1 类；缩略图排在评论条之后并贴卡片底部左侧。
  const { items: images, more: moreImages } = cardImages(note);
  const hasImages = images.length > 0;
  // 卡片只显示「emoji + label + 加粗条数」，不显示评论正文；点击整张卡片打开右侧面板。
  const commentGroups = cardCommentGroups(note);
  const visibleGroups = commentGroups.slice(0, hasImages ? 1 : MAX_CARD_COMMENT_GROUPS);
  const restGroups = Math.max(0, commentGroups.length - visibleGroups.length);
  const disabled = Boolean(pending);
  // 菜单随整张卡片悬停/聚焦出现；此时统一隐藏图片预览。
  const menuVisible = Boolean(!pending && !drawerOpen && !props.dragging && hoverActive);
  const emojiList = Array.isArray(emojis) ? emojis : [];
  const stop = (event) => event.stopPropagation();

  return h('div', {
    className: 'SN_card',
    'data-note-path': note.path,
    'data-menu': menuVisible ? 'true' : 'false',
    'data-images': hasImages ? 'true' : 'false',
    'data-drawer': drawerOpen ? 'true' : 'false',
    'data-dragging': props.dragging ? 'true' : 'false',
    draggable: !disabled && !props.preview,
    onDragStart: (event) => {
      if (disabled || event.target.closest?.('button,a,input,textarea')) { event.preventDefault(); return; }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-dsh-memo', note.path);
      const rect = event.currentTarget?.getBoundingClientRect();
      const doc = event.currentTarget?.ownerDocument;
      if (doc?.body && event.dataTransfer.setDragImage) {
        // 系统拖影始终盖住页面，改用透明拖影 + 同一 portal 内的卡片与动作提示。
        const image = doc.createElement('canvas');
        image.width = image.height = 1;
        image.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none';
        doc.body.appendChild(image);
        event.dataTransfer.setDragImage(image, 0, 0);
        setTimeout(() => image.remove(), 0);
      }
      const started = actions.current.onDragStart(note, {
        x: event.clientX, y: event.clientY, width: rect?.width, height: rect?.height,
        offsetX: rect ? event.clientX - rect.left : 0, offsetY: rect ? event.clientY - rect.top : 0,
      }, event.currentTarget);
      if (started === false) event.preventDefault();
    },
    onDragEnd: () => actions.current.onDragEnd(),
    style: { '--sn-card-bg': color, '--sn-card-bg-dark': darkColor },
    tabIndex: props.preview ? -1 : 0,
    role: 'group',
    'aria-label': title,
    title: t('card.openHint'),
    // 单击打开右侧抽屉（event.detail===1 守卫：双击的第二次 click 不触发“开→关”）。
    onClick: (event) => {
      if (event.detail !== 1) return;
      actions.current.onOpen(note);
    },
    onKeyDown: (event) => {
      if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Backspace') {
        event.preventDefault(); event.stopPropagation();
        if (!disabled) actions.current.onDelete(note);
      }
    },
    // 0.13.4：整张卡片 hover/focus 就视为「菜单出现」，不再只监听 emoji 行。
    onMouseEnter: () => actions.current.onCardEnter(note),
    // 鼠标移出但焦点还留在卡片内（比如刚点过 emoji/按钮）时保持菜单状态，避免图片闪现。
    onMouseLeave: (event) => actions.current.onCardLeave(
      note,
      typeof document !== 'undefined' && event.currentTarget.contains(document.activeElement),
    ),
    onFocus: () => actions.current.onCardEnter(note),
    onBlur: (event) => {
      const next = event.relatedTarget;
      if (!next || !event.currentTarget.contains(next)) actions.current.onCardLeave(note);
    },
  },
    h('div', { className: 'SN_cardClip' },
      // 标题独占宽度；文件夹 tag 只在同一菜单激活时覆盖在右上角。
      h('div', { className: 'SN_cardHead' },
        h('h3', { className: 'SN_cardTitle', title: title },
          h('span', { className: 'SN_cardTitleText' }, title),
        ),
      ),
      note.tag ? h('div', { className: 'SN_cardTagLayer' },
        h('span', { className: 'SN_cardTag', title: note.tag }, note.tag)) : null,
      // 0.13.9：没有正文就不渲染摘要行（不再显示占位文案）。
      excerpt ? h('p', {
        className: 'SN_cardExcerpt',
        'data-compact': hasImages ? 'true' : 'false',
      }, excerpt) : null,
      visibleGroups.length === 0 && restGroups === 0 ? null : h('div', { className: 'SN_cardComments' },
        visibleGroups.map((group, index) => h('span', {
          className: 'SN_cCommentGroup',
          key: `${group.emoji}|${group.label}|${index}`,
          title: [group.emoji, group.label].filter(Boolean).join(' '),
        },
          group.emoji ? h('span', { className: 'SN_cCommentEmoji', 'aria-hidden': 'true' }, group.emoji) : null,
          group.label ? h('span', { className: 'SN_cCommentLabel' }, group.label) : null,
          h('span', { className: 'SN_cCommentCount' }, String(group.count)),
        )),
        restGroups > 0 ? h('span', { className: 'SN_cCommentMore' }, t('card.moreCommentGroups', { count: restGroups })) : null,
      ),
      // 0.13 修正：图片条排在评论条之后，margin-top:auto 贴卡片底部、align-self:flex-start 靠左。
      hasImages
        ? h('div', { className: 'SN_cardImages' },
          images.map((image, index) => h(CardThumb, {
            key: imageCacheKey(note.path, image.source) + '#' + index,
            path: note.path,
            image: image,
          })),
          moreImages > 0
            ? h('span', { className: 'SN_moreImages' }, t('card.moreImages', { count: moreImages }))
            : null,
        )
        : null,
      pending
        ? h('div', { className: 'SN_cardActions', 'data-visible': 'true', onDoubleClick: stop },
          h('span', { className: 'SN_pending' },
            h('span', { className: 'SN_pendingDot', 'aria-hidden': 'true' }),
            t('card.pending'),
          ),
        )
        : drawerOpen
          ? null
          : h('div', {
            className: 'SN_cardActions',
            'data-visible': menuVisible ? 'true' : undefined,
            onDoubleClick: stop,
          },
            // 修正轮：所有 AI emoji 预设平铺一行（最多 12 枚，flex-wrap 自动换行），
            // 每枚 27×27 只画 emoji 字形；hover / 键盘 focus 时按钮上方浮出 label 小标签。
            h('div', {
              className: 'SN_aiRow',
              role: 'group',
              'aria-label': t('card.aiComment'),
            },
              emojiList.length === 0
                ? h('span', { className: 'SN_aiEmpty' }, t('card.noPresets'))
                : emojiList.map((emoji) => h('button', {
                  key: emoji.id || emoji.emoji,
                  type: 'button',
                  className: 'SN_aiBtn',
                  disabled: disabled,
                  // 标签由上方 .SN_aiLabel 小标签展示，不用原生 title，避免双 tooltip。
                  'aria-label': emojiLabel(emoji) || emoji.emoji || t('card.aiComment'),
                  onClick: (event) => {
                    event.stopPropagation();
                    actions.current.onPreset(note, emoji);
                  },
                },
                  h('span', { className: 'SN_aiEmoji', 'aria-hidden': 'true' }, emoji.emoji || '✨'),
                  h('span', { className: 'SN_aiLabel', 'aria-hidden': 'true' }, emoji.label || emoji.emoji || ''),
                )),
            ),
            h('div', { className: 'SN_actionDivider', 'aria-hidden': 'true' }),
            h('div', { className: 'SN_actionRow' },
              h('button', {
                type: 'button',
                className: 'SN_mini',
                disabled: disabled,
                onClick: (event) => {
                  event.stopPropagation();
                  actions.current.onCopy(note);
                },
              }, h(ActionIcon, { kind: 'copy', size: 13 }), t('card.copy')),
              // 归档 / 到项目统一从拖拽栏进入；卡片只保留复制与 Obsidian。
              h('button', {
                type: 'button',
                className: 'SN_mini SN_obsidianBtn',
                disabled: disabled,
                title: t('card.obsidian'),
                'aria-label': t('card.obsidian'),
                onClick: (event) => {
                  event.stopPropagation();
                  actions.current.onOpenObsidian(note);
                },
              },
                h(ObsidianIcon, null),
                h('span', { className: 'SN_obsidianText' }, t('card.obsidian')),
              ),
            ),
          ),
    ),
  );
});

NoteCard.displayName = 'NoteCard';

export { NoteCard };
