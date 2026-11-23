/** 阅读/编辑抽屉视图，接收草稿、布局和操作回调。 */
import { formatDiagnostic } from '../i18n/diagnostics.js';
import { ActionIcon, ChevronIcon, CloseIcon, DeepSeekIcon, ObsidianIcon, PinIcon } from '../components/icons.js';
import { Fragment, React, h } from '../react.js';
import { NoteBlock, NoteComment } from './blocks.js';
import { DEFAULT_NOTE_COLOR } from '../styles/tokens.js';
import { formatTime } from '../utils.js';
import { emojiLabel } from '../wall/model.js';
import { useEditorPosition } from './use-editor-position.js';
import { useListShortcuts } from './list-shortcuts.js';
import { useTaskReorder } from './use-task-reorder.js';

function NoteDrawer(props) {
  const {
    t, drawer, editing, bodyDraft, saving, drawerWidth, resizing, titleDraft, onTitleChange, titleMode, pinned,
    inline, onTogglePinned, drawerActions, commentsLayout, commentsActions, onClose, onRetry, onStartEdit,
    onBodyChange, onSave, onCancelEdit, onResizeStart, onResizeReset, onToggleTask, taskBusy,
    editPositionRef, onEditPositionChange, onReorderTask,
  } = props;
  const editFromTitle = React.useRef(false);
  const listShortcuts = useListShortcuts({ editing, path: drawer.path, saving });
  const editorPosition = useEditorPosition({ editing, path: drawer.path, editPositionRef, onEditPositionChange, onBodySelection: listShortcuts.refresh });
  const bodyField = editorPosition.fieldProps('body', !editFromTitle.current, onBodyChange);
  const drawerStyle = typeof drawerWidth === 'number' && Number.isFinite(drawerWidth)
    ? {
      width: drawerWidth + 'px',
      minWidth: 'min(320px,100%)',
      maxWidth: pinned ? 'min(960px,100%)' : 'min(960px,80%)',
    }
    : pinned
      // 锁定态没拖过宽：默认 34%，但不超过「面板宽 - 260」（且至少 320）。
      ? {
        width: '34%',
        minWidth: 'min(320px,100%)',
        maxWidth: 'max(320px, min(960px, calc(100% - 260px)))',
      }
      : undefined;
  const summary = drawer.summary || {};
  const full = drawer.full || null;
  const source = full || summary;
  const title = source.title || source.name || '';
  const tag = source.tag || null;
  const updated = source.mtime ? t('drawer.updated', { time: formatTime(source.mtime) }) : '';
  const blocks = full && Array.isArray(full.blocks) ? full.blocks : [];
  const comments = full && Array.isArray(full.comments) ? full.comments : [];
  const projects = source.projects;
  const canEdit = Boolean(full);

  const taskDragProps = useTaskReorder({ path: drawer.path, body: full?.body, bodyLineOffset: full?.bodyLineOffset || 0, editing, busy: taskBusy || saving || drawer.loading, onReorderTask, t });

  function handleBodyDoubleClick(event) {
    if (!canEdit) return;
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    // 双击按钮 / 空白边缘不算（§7.3）。
    if (target.closest('button')) return;
    const inText = target.closest('.SN_blockP, .SN_blockH, .SN_blockLi, .SN_blockQuote, .SN_blockCode, .SN_commentCard, .SN_projects');
    if (!inText && blocks.length > 0) return;
    editFromTitle.current = false;
    onStartEdit();
  }

  const bodyNode = h('div', {
    className: 'SN_noteDrawerBody',
    onDoubleClick: handleBodyDoubleClick,
  },
    drawer.loading && !full ? h('div', { className: 'SN_noteViewHint' }, t('drawer.loading')) : null,
    drawer.error
      ? h('div', { className: 'SN_noteViewError' },
        h('span', null, formatDiagnostic(t, drawer.error)),
        h('button', { type: 'button', className: 'SN_textBtn', onClick: onRetry }, t('drawer.retry')),
      )
      : null,
    !drawer.loading && !drawer.error && blocks.length === 0
      ? h('p', { className: 'SN_noteViewEmpty' }, t('drawer.editHint'))
      : null,
    blocks.map((block, index) => h(NoteBlock, { key: index, block: block, path: drawer.path, onToggleTask, taskBusy, taskDrag: taskDragProps(block), t })),
    projects ? h('div', { className: 'SN_projects' },
      h('span', { className: 'SN_projectsLabel' }, t('drawer.projects')),
      h('span', { className: 'SN_projectsValue' }, String(projects)),
    ) : null,
  );

  // 折叠只隐藏评论列表；预设始终可见，生成中禁用按钮而不替换它们。
  const emojiButtons = drawerActions && Array.isArray(drawerActions.emojis) ? drawerActions.emojis : [];
  const commentPending = Boolean(drawerActions?.pending);
  const commentEmojiRow = drawerActions
    ? h('div', { className: 'SN_commentEmojiRow', role: 'group', 'aria-label': t('card.aiComment') },
      commentPending
        ? h('span', { className: 'SN_pending', role: 'status' },
          h('span', { className: 'SN_pendingDot', 'aria-hidden': 'true' }),
          t(drawerActions.pending.textKey || 'card.pending', { name: drawerActions.pending.name }),
        )
        : null,
      emojiButtons.length === 0
        ? (!commentPending ? h('span', { className: 'SN_aiEmpty' }, t('card.noPresets')) : null)
        : [
          h('span', { key: 'hint', className: 'SN_commentAIHint', 'aria-hidden': 'true' }, t('card.aiComment')),
          ...emojiButtons.map((emoji) => h('button', {
            key: emoji.id || emoji.emoji,
            type: 'button',
            className: 'SN_aiBtn',
            disabled: commentPending,
            'aria-label': emojiLabel(emoji) || emoji.emoji || t('card.aiComment'),
            onClick: (event) => {
              event.stopPropagation();
              drawerActions.onComment(emoji);
            },
          },
            h('span', { className: 'SN_aiEmoji', 'aria-hidden': 'true' }, emoji.emoji || '✨'),
            h('span', { className: 'SN_aiLabel', 'aria-hidden': 'true' }, emoji.label || emoji.emoji || ''),
          )),
        ],
    )
    : null;

  // 评论区固定底部：标题行可折叠；顶边可上下拖动调整高度（双击恢复默认）；编辑态隐藏。
  // 暂无评论时强制折叠；有评论后才恢复用户保存的折叠/拉高状态。
  const hasComments = comments.length > 0;
  const collapsed = !hasComments || Boolean(commentsLayout && commentsLayout.commentsCollapsed);
  const resizingComments = Boolean(commentsLayout && commentsLayout.resizingComments);
  const commentsHeight = commentsLayout && typeof commentsLayout.commentsHeight === 'number'
    && Number.isFinite(commentsLayout.commentsHeight) ? commentsLayout.commentsHeight : null;
  const commentsStyle = commentsHeight === null || collapsed
    ? undefined
    : { height: commentsHeight + 'px', maxHeight: 'min(72%, calc(100% - 260px))' };
  const commentsLabel = comments.length > 0 ? t('drawer.commentsCount', { count: comments.length }) : t('drawer.comments');
  const commentsToggle = h('button', {
    type: 'button',
    className: 'SN_commentToggle',
    disabled: !hasComments,
    'aria-expanded': collapsed ? 'false' : 'true',
    'aria-controls': 'SN_noteDrawerCommentsBody',
    title: !hasComments ? t('drawer.noComments') : collapsed ? t('drawer.commentsExpand') : t('drawer.commentsCollapse'),
    onClick: (event) => {
      event.stopPropagation();
      if (!hasComments) return;
      if (commentsLayout && typeof commentsLayout.onToggle === 'function') commentsLayout.onToggle();
    },
  },
    h(ChevronIcon, { collapsed: collapsed }),
    h('span', { className: 'SN_noteViewSection' }, commentsLabel),
  );
  const commentsNode = h('section', {
    className: 'SN_noteDrawerComments',
    'aria-label': commentsLabel,
    'data-collapsed': collapsed ? 'true' : 'false',
    'data-resizing': resizingComments ? 'true' : 'false',
    style: commentsStyle,
  },
    h('div', {
      className: 'SN_noteDrawerCommentsHandle',
      role: 'separator',
      'aria-orientation': 'horizontal',
      'aria-label': t('drawer.commentsResize'),
      'aria-hidden': collapsed || undefined,
      title: t('drawer.commentsResize'),
      'data-disabled': collapsed ? 'true' : 'false',
      'data-resizing': resizingComments ? 'true' : 'false',
      onPointerDown: collapsed ? undefined : commentsLayout?.onResizeStart,
      onDoubleClick: collapsed ? undefined : commentsLayout?.onResizeReset,
    }),
    h('div', { className: 'SN_noteDrawerCommentsHead' },
      commentsToggle,
      commentEmojiRow,
    ),
    collapsed
      ? null
      : h('div', { className: 'SN_noteDrawerCommentsBody', id: 'SN_noteDrawerCommentsBody' },
        comments.length === 0
          ? h('p', { className: 'SN_noteViewHint SN_commentEmpty' }, t('drawer.noComments'))
          : comments.map((comment, index) => h(NoteComment, {
            key: index,
            comment: comment,
            deleting: Boolean(commentsActions && commentsActions.deletingIndex === index),
            deleteLabel: t('drawer.commentDelete'),
            onDelete: commentsActions && typeof commentsActions.onDelete === 'function'
              ? () => commentsActions.onDelete(index, comment) : undefined,
          })),
      ),
  );

  // 抽屉操作条（§7.3.2）：header 分割线下方；锁定/未锁定都显示，编辑态隐藏。
  // 0.16.6：一行放完——左侧归档 / 到项目 / 删除 / 复制全文，右侧紫色 Obsidian 图文入口。
  const actionsNode = drawerActions
    ? h('div', { className: 'SN_drawerActions' },
      h('div', { className: 'SN_drawerActionLeft' },
        h('div', { className: 'SN_drawerActionTop' }, [
          { kind: 'archive', label: t('card.archive'), onClick: drawerActions.onArchive,
            disabled: Boolean(drawerActions.pending) },
          { kind: 'project', label: t('card.project'), onClick: drawerActions.onProject, disabled: Boolean(drawerActions.pending) },
          { kind: 'delete', label: t('card.delete'), onClick: drawerActions.onDelete, disabled: Boolean(drawerActions.pending) },
          { kind: 'copy', label: t('drawer.copy'), onClick: drawerActions.onCopy },
          { kind: 'deepseek', label: t('send.action'), onClick: (event) => drawerActions.onDeepSeek(event.currentTarget) },
        ].map(({ kind, label, ...button }) => h('button', {
          key: kind, type: 'button', ...button,
          className: 'SN_drawerActionBtn'
            + (kind === 'delete' ? ' SN_drawerDeleteBtn' : '')
            + (kind === 'deepseek' ? ' SN_deepseekAction' : ''),
          'aria-label': label,
        }, kind === 'deepseek'
          ? h(DeepSeekIcon, { size: 15 })
          : h(ActionIcon, { kind, size: 15 }), h('span', { className: 'SN_aiLabel', 'aria-hidden': 'true' }, label)))),
      ),
      h('button', {
        type: 'button', className: 'SN_mini SN_obsidianBtn',
        'aria-label': t('card.obsidian'), onClick: drawerActions.onOpenObsidian,
      }, h(ObsidianIcon, null), h('span', { className: 'SN_obsidianText' }, t('card.obsidian'))),
    )
    : null;
  const headNode = h('div', { className: 'SN_noteDrawerHead' },
    h('div', { className: 'SN_noteDrawerHeadMain' },
      editing
        ? h('div', { className: 'SN_titleEditorFit', 'data-title': titleDraft },
          h('textarea', {
            className: 'SN_titleEditor',
            value: titleDraft,
            rows: 1,
            wrap: 'soft',
            spellCheck: false,
            disabled: saving,
            'aria-label': titleMode === 'filename' ? t('drawer.titleAria') : t('drawer.titleAriaBody'),
            ...editorPosition.fieldProps('title', editFromTitle.current, (value) => onTitleChange(value.replace(/[\r\n]+/g, ' '))),
            onKeyDown: (event) => {
              // 标题是一行数据，允许视觉折行但不输入换行。
              if (event.key === 'Enter' && !event.isComposing && !event.nativeEvent?.isComposing && event.keyCode !== 229) {
                event.preventDefault();
              }
            },
          }),
        )
        : h('h2', {
          className: 'SN_noteDrawerTitle',
          title: title,
          onDoubleClick: canEdit ? () => {
            editFromTitle.current = true;
            onStartEdit();
          } : undefined,
        }, title),
      editing && titleMode && titleMode !== 'filename'
        ? h('p', { className: 'SN_noteDrawerTitleHint' }, t(titleDraft.trim() === ''
          ? 'drawer.titleEmptyHint'
          : titleMode === 'heading' ? 'drawer.titleFromBodyHeading' : 'drawer.titleFromBodyFirstLine'))
        : null,
      h('div', { className: 'SN_noteDrawerMeta' },
        tag ? h('span', { className: 'SN_noteDrawerTag', title: tag }, tag) : null,
        updated ? h('span', null, updated) : null,
      ),
    ),
    h('div', { className: 'SN_noteDrawerHeadActions' },
      // 关闭按钮在上、固定按钮在下，操作列纵排以释放标题宽度。
      pinned
        ? null
        : h('button', {
          type: 'button',
          className: 'SN_iconBtn',
          onClick: onClose,
          'aria-label': t('drawer.close'),
          title: t('drawer.close'),
        }, h(CloseIcon, null)),
      // 锁定态不渲染关闭按钮（只留锁定/解锁）；Esc 仍可关。
      h('button', {
        type: 'button',
        className: 'SN_iconBtn',
        'data-active': pinned ? 'true' : 'false',
        'aria-pressed': pinned ? 'true' : 'false',
        'aria-label': pinned ? t('drawer.unlock') : t('drawer.lock'),
        title: pinned ? t('drawer.unlock') : t('drawer.lock'),
        onClick: onTogglePinned,
      }, h(PinIcon, { pinned: pinned })),
    ),
  );
  const drawerNode = h('aside', {
    className: 'SN_noteDrawer',
    'data-pinned': pinned ? 'true' : 'false',
    // DSH 0.2.2-rc.2 起 macOS 只对 data-window-drag[-controls] 内的控件自动 no-drag；
    // 抽屉盖在顶栏的拖动行上，必须显式排除自己的可见矩形，否则头部按钮会变成拖窗口。
    'data-window-drag-exclude': '',
    role: 'dialog',
    'aria-label': t('drawer.aria'),
    style: {
      ...drawerStyle,
      '--sn-card-bg': (props.paper && props.paper.light) || source.color || DEFAULT_NOTE_COLOR,
      '--sn-card-bg-dark': (props.paper && props.paper.dark) || source.darkColor || source.color || DEFAULT_NOTE_COLOR,
    },
  },
    h('div', {
      className: 'SN_noteDrawerHandle',
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': t('drawer.resize'),
      title: t('drawer.resize'),
      'data-resizing': resizing ? 'true' : 'false',
      onPointerDown: onResizeStart,
      onDoubleClick: onResizeReset,
    }),
    editing
      ? h(Fragment, null,
        h('div', { className: 'SN_noteEditContent', ...editorPosition.contentProps },
          headNode,
          h('textarea', {
            className: 'SN_noteEditor',
            value: bodyDraft,
            spellCheck: false,
            disabled: saving,
            'aria-label': t('drawer.bodyAria'),
            ...bodyField,
            ...listShortcuts.fieldProps((result) => editorPosition.applyBodyChange(result, onBodyChange)),
            onBlur(event) { listShortcuts.reset(); bodyField.onBlur(event); },
          }),
        ),
        h('div', { className: 'SN_noteEditBar' },
          h('div', { className: 'SN_noteEditHints' },
            h('span', { className: 'SN_noteEditHint' }, t(saving ? 'drawer.saving' : listShortcuts.showHint ? 'drawer.listShortcutHint' : 'drawer.shortcutHint'))),
          h('div', { className: 'SN_noteEditActions' },
            h('button', {
              type: 'button',
              className: 'SN_ghostBtn',
              disabled: saving,
              onClick: onCancelEdit,
            }, t('drawer.cancel')),
            h('button', {
              type: 'button',
              className: 'SN_primaryBtn',
              disabled: saving,
              onClick: onSave,
            }, saving ? t('drawer.saving') : t('drawer.save')),
          ),
        ),
      )
      : h(Fragment, null, headNode, actionsNode, bodyNode, commentsNode),
  );

  if (inline) return drawerNode;
  return h('div', { className: 'SN_noteDrawerLayer' }, drawerNode);
}

export { NoteDrawer };
