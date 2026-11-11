/** 阅读/编辑抽屉视图，接收草稿、布局和操作回调。 */
import { ActionIcon, CloseIcon, ObsidianIcon, PinIcon } from '../components/icons.js';
import { Fragment, React, h } from '../react.js';
import { NoteBlock, NoteComment } from './blocks.js';
import { DEFAULT_NOTE_COLOR } from '../styles/tokens.js';
import { formatTime } from '../utils.js';
import { emojiLabel } from '../wall/model.js';

function NoteDrawer(props) {
  const {
    t, drawer, editing, bodyDraft, saving, drawerWidth, resizing, titleDraft, onTitleChange, pinned,
    inline, onTogglePinned, drawerActions, onClose, onRetry, onStartEdit, onBodyChange, onSave,
    onCancelEdit, onResizeStart, onResizeReset, onToggleTask, taskBusy,
  } = props;
  // 第 4 轮：标题编辑用多行 textarea 完整显示，高度随内容自适应（不支持 field-sizing 的浏览器靠这里）。
  const titleEditorRef = React.useRef(null);
  React.useEffect(() => {
    const el = titleEditorRef.current;
    if (!el || !editing) return;
    el.style.height = 'auto';
    const next = Math.min(132, Math.max(24, el.scrollHeight || 24));
    el.style.height = next + 'px';
  }, [editing, titleDraft]);
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

  function handleBodyDoubleClick(event) {
    if (!canEdit) return;
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    // 双击按钮 / 空白边缘不算（§7.3）。
    if (target.closest('button')) return;
    const inText = target.closest('.SN_blockP, .SN_blockH, .SN_blockLi, .SN_blockQuote, .SN_blockCode, .SN_commentCard, .SN_projects');
    if (!inText && blocks.length > 0) return;
    onStartEdit();
  }

  const bodyNode = h('div', {
    className: 'SN_noteDrawerBody',
    onDoubleClick: handleBodyDoubleClick,
  },
    drawer.loading && !full ? h('div', { className: 'SN_noteViewHint' }, t('drawer.loading')) : null,
    drawer.error
      ? h('div', { className: 'SN_noteViewError' },
        h('span', null, drawer.error),
        h('button', { type: 'button', className: 'SN_textBtn', onClick: onRetry }, t('drawer.retry')),
      )
      : null,
    !drawer.loading && !drawer.error && blocks.length === 0
      ? h('p', { className: 'SN_noteViewEmpty' }, t('drawer.editHint'))
      : null,
    blocks.map((block, index) => h(NoteBlock, { key: index, block: block, path: drawer.path, onToggleTask, taskBusy })),
    projects ? h('div', { className: 'SN_projects' },
      h('span', { className: 'SN_projectsLabel' }, t('drawer.projects')),
      h('span', { className: 'SN_projectsValue' }, String(projects)),
    ) : null,
  );

  // 0.13 评论固定区：flex:none、max-height:42%、min-height:96px、自身滚动、上边框；编辑态隐藏。
  const commentsNode = h('section', { className: 'SN_noteDrawerComments', 'aria-label': t('drawer.comments', { count: comments.length }) },
    h('div', { className: 'SN_noteDrawerCommentsHead' },
      h('h3', { className: 'SN_noteViewSection' }, t('drawer.comments', { count: comments.length })),
    ),
    comments.length === 0
      ? h('p', { className: 'SN_noteViewHint SN_commentEmpty' }, t('drawer.noComments'))
      : h('div', { className: 'SN_noteDrawerCommentsBody' },
        comments.map((comment, index) => h(NoteComment, { key: index, comment: comment })),
      ),
  );

  // 抽屉操作条（§7.3.2）：header 分割线下方；锁定/未锁定都显示，编辑态隐藏。
  // 左 = AI emoji；右上 = 归档 / 到项目 / 删除 / 复制全文；右下 = 紫色 Obsidian 图文入口。
  const actionsNode = drawerActions
    ? h('div', { className: 'SN_drawerActions' },
      h('div', { className: 'SN_drawerActionLeft' },
        drawerActions.pending
          ? h('span', { className: 'SN_pending' },
            h('span', { className: 'SN_pendingDot', 'aria-hidden': 'true' }),
            t('card.pending'),
          )
          : (Array.isArray(drawerActions.emojis) ? drawerActions.emojis : []).length === 0
            ? h('span', { className: 'SN_aiEmpty' }, t('card.noPresets'))
            : (drawerActions.emojis || []).map((emoji) => h('button', {
              key: emoji.id || emoji.emoji,
              type: 'button',
              className: 'SN_aiBtn',
              'aria-label': emojiLabel(emoji) || emoji.emoji || t('card.aiComment'),
              onClick: (event) => {
                event.stopPropagation();
                drawerActions.onComment(emoji);
              },
            },
              h('span', { className: 'SN_aiEmoji', 'aria-hidden': 'true' }, emoji.emoji || '✨'),
              h('span', { className: 'SN_aiLabel', 'aria-hidden': 'true' }, emoji.label || emoji.emoji || ''),
            )),
      ),
      h('div', { className: 'SN_drawerActionRight' },
        h('div', { className: 'SN_drawerActionTop' }, [
          { kind: 'archive', label: t('card.archive'), onClick: drawerActions.onToggleArchive,
            disabled: Boolean(drawerActions.pending), 'data-sn-drawer-menu-trigger': '',
            'aria-haspopup': 'menu', 'aria-expanded': drawerActions.archiveOpen ? 'true' : 'false' },
          { kind: 'project', label: t('card.project'), onClick: drawerActions.onProject, disabled: Boolean(drawerActions.pending) },
          { kind: 'delete', label: t('card.delete'), onClick: drawerActions.onDelete, disabled: Boolean(drawerActions.pending) },
          { kind: 'copy', label: t('drawer.copy'), onClick: drawerActions.onCopy },
        ].map(({ kind, label, ...button }) => h('button', {
          key: kind, type: 'button', ...button,
          className: 'SN_drawerActionBtn' + (kind === 'delete' ? ' SN_drawerDeleteBtn' : ''),
          'aria-label': label,
        }, h(ActionIcon, { kind, size: 15 }), h('span', { className: 'SN_aiLabel', 'aria-hidden': 'true' }, label)))),
        h('button', {
          type: 'button', className: 'SN_mini SN_obsidianBtn',
          'aria-label': t('card.obsidian'), onClick: drawerActions.onOpenObsidian,
        }, h(ObsidianIcon, null), h('span', { className: 'SN_obsidianText' }, t('card.obsidian'))),
        drawerActions.archiveOpen
          ? h('div', {
            className: 'SN_drawerMenu',
            role: 'menu',
            ref: drawerActions.menuRef,
            'aria-label': t('archive.aria'),
            onClick: (event) => event.stopPropagation(),
          },
            h('div', { className: 'SN_menuTitle' }, t('archive.menuTitle')),
            (Array.isArray(drawerActions.targets) ? drawerActions.targets : []).length === 0
              ? h('div', { className: 'SN_menuEmpty' }, t('archive.emptyHint'))
              : (drawerActions.targets || []).map((target) => h('button', {
                key: target.id,
                type: 'button',
                className: 'SN_menuItem',
                role: 'menuitem',
                onClick: (event) => {
                  event.stopPropagation();
                  drawerActions.onArchive(target.id);
                },
              },
                h('span', { className: 'SN_menuLabel' }, target.label || target.id),
                h('span', { className: 'SN_menuPath', title: target.path }, target.path),
              )),
          )
          : null,
      ),
    )
    : null;
  const drawerNode = h('aside', {
    className: 'SN_noteDrawer',
    'data-pinned': pinned ? 'true' : 'false',
    role: 'dialog',
    'aria-label': t('drawer.aria'),
    style: { ...drawerStyle, '--sn-card-bg': source.color || DEFAULT_NOTE_COLOR, '--sn-card-bg-dark': source.darkColor || source.color || DEFAULT_NOTE_COLOR },
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
    h('div', { className: 'SN_noteDrawerHead' },
      h('div', { className: 'SN_noteDrawerHeadMain' },
        editing
          // 第 4 轮：标题编辑改成多行 textarea，完整换行显示，不再需要横向滚动到文件名尾部。
          ? h('textarea', {
            className: 'SN_titleEditor',
            ref: titleEditorRef,
            value: titleDraft,
            rows: 1,
            maxLength: 60,
            wrap: 'soft',
            spellCheck: false,
            'aria-label': '便签文件名',
            onChange: (event) => onTitleChange(event.target.value.replace(/[\r\n]+/g, ' ')),
            onKeyDown: (event) => {
              // 文件名不能换行：Enter 不输入换行（保存仍用 Cmd/Ctrl+S 或按钮）。
              if (event.key === 'Enter') event.preventDefault();
            },
          })
          : h('h2', {
            className: 'SN_noteDrawerTitle',
            title: title,
            // 0.13：双击标题进入编辑态（编辑态标题就是 input）；标题不再带 byline。
            onDoubleClick: canEdit ? onStartEdit : undefined,
          }, title),
        h('div', { className: 'SN_noteDrawerMeta' },
          tag ? h('span', { className: 'SN_noteDrawerTag', title: tag }, tag) : null,
          updated ? h('span', null, updated) : null,
        ),
      ),
      h('div', { className: 'SN_noteDrawerHeadActions' },
        h('button', {
          type: 'button',
          className: 'SN_iconBtn',
          'data-active': pinned ? 'true' : 'false',
          'aria-pressed': pinned ? 'true' : 'false',
          'aria-label': pinned ? t('drawer.unlock') : t('drawer.lock'),
          title: pinned ? t('drawer.unlock') : t('drawer.lock'),
          onClick: onTogglePinned,
        }, h(PinIcon, { pinned: pinned })),
        // 第 3 轮：锁定态不渲染关闭按钮（只留锁定/解锁）；Esc 仍可关。
        pinned
          ? null
          : h('button', {
            type: 'button',
            className: 'SN_iconBtn',
            onClick: onClose,
            'aria-label': t('drawer.close'),
            title: t('drawer.close'),
          }, h(CloseIcon, null)),
      ),
    ),
    editing
      ? h('div', { className: 'SN_noteEdit' },
        h('textarea', {
          className: 'SN_noteEditor',
          value: bodyDraft,
          spellCheck: false,
          autoFocus: true,
          disabled: saving,
          'aria-label': t('drawer.bodyAria'),
          onChange: (event) => onBodyChange(event.target.value),
        }),
        h('div', { className: 'SN_noteEditBar' },
          h('span', { className: 'SN_noteEditHint' }, saving ? t('drawer.saving') : t('drawer.shortcutHint')),
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
      : h(Fragment, null, actionsNode, bodyNode, commentsNode),
  );

  if (inline) return drawerNode;
  return h('div', { className: 'SN_noteDrawerLayer' }, drawerNode);
}

export { NoteDrawer };
