/** 工作空间标签栏：切换、添加文件夹、右键删除、拖动排序和便签拖放迁移。 */
import { WORKSPACE_ALL_ID, WORKSPACE_POPOVER_WIDTH } from '../constants.js';
import { ActionIcon, CloseIcon, MoreIcon, PlusIcon, SplitViewIcon, LeafIcon } from '../components/icons.js';
import { React, h } from '../react.js';
import { VaultFolderPicker } from '../settings/paths.js';
import { isAbsolutePath, vaultRelative } from '../utils.js';
import { useWorkspaceReorder } from './use-workspace-reorder.js';
import { workspaceShortcutDigit } from './use-workspace-shortcuts.js';
import { WORKSPACE_COLORS, popoverLeftFor } from './workspaces.js';


function WorkspaceBar({
  t, entries, activeId, pinActive, zen = false, visibleIds = [activeId], onTogglePin, onToggleZen = () => {}, vaultPath, notesDir, request, history, dragActive, dropId,
  onSelect, onAdd, onRemove, onSetColor, onReorder, onHoverWorkspace, onClearWorkspaceHover, onDropWorkspace,
}) {
  const barRef = React.useRef(null);
  const stripRef = React.useRef(null);
  const plusRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const addErrorRef = React.useRef('');
  // 三个浮层共用一份状态：添加弹层 / 「…」菜单 / 标签右键菜单。
  const [overlay, setOverlay] = React.useState(null);
  const overlayRef = React.useRef(overlay);
  overlayRef.current = overlay;
  const [addError, setAddError] = React.useState('');
  const [popBox, setPopBox] = React.useState({ left: 4, maxHeight: 0 });
  const [overflow, setOverflow] = React.useState(false);
  const adding = Boolean(overlay && overlay.kind === 'add');
  const menu = overlay && overlay.kind === 'menu' ? overlay : null;
  const moreOpen = Boolean(overlay && overlay.kind === 'more');
  const { drag, startPress, cancelDrag, consumeClick } = useWorkspaceReorder({ entries, onReorder, stripRef });

  function closeOverlay() {
    addErrorRef.current = '';
    setAddError('');
    setOverlay(null);
  }

  // 标签过多时收进「…」；宽度变化、增删标签都会重新判断。
  React.useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const measure = () => {
      const next = strip.scrollWidth > strip.clientWidth + 1;
      setOverflow((current) => (current === next ? current : next));
      if (!next && overlayRef.current && overlayRef.current.kind === 'more') closeOverlay();
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(strip);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [entries, activeId]);

  // 通过数字快捷键选中隐藏标签时，也收起「…」菜单。
  React.useEffect(() => {
    if (overlayRef.current?.kind === 'more') closeOverlay();
  }, [activeId]);

  // 添加弹层跟着「＋」走：优先左对齐，靠右时改为右对齐，并始终夹在标签栏内。
  React.useLayoutEffect(() => {
    if (!adding) return undefined;
    const place = () => {
      const bar = barRef.current, plus = plusRef.current;
      if (!bar || !plus) return;
      const barRect = bar.getBoundingClientRect();
      const plusRect = plus.getBoundingClientRect();
      const panel = bar.closest('.SN_panel');
      const panelBottom = panel ? panel.getBoundingClientRect().bottom : (window.innerHeight || 768);
      setPopBox({
        left: popoverLeftFor(
          { left: plusRect.left - barRect.left, right: plusRect.right - barRect.left },
          bar.clientWidth,
          WORKSPACE_POPOVER_WIDTH,
        ),
        maxHeight: Math.max(160, Math.floor(panelBottom - barRect.bottom - 20)),
      });
    };
    place();
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    if (observer && barRef.current) observer.observe(barRef.current);
    return () => {
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [adding, entries]);

  // 右键菜单：先按指针位置渲染，再夹到面板范围内（避免伸到左侧 DSH 栏下面）。
  React.useLayoutEffect(() => {
    if (!menu || !menuRef.current) return undefined;
    const place = () => {
      const panel = barRef.current?.closest('.SN_panel');
      const bounds = panel?.getBoundingClientRect();
      const box = menuRef.current.getBoundingClientRect();
      const minLeft = (bounds ? bounds.left : 0) + 8;
      const maxLeft = (bounds ? bounds.right : (window.innerWidth || 1024)) - box.width - 8;
      const minTop = (bounds ? bounds.top : 0) + 8;
      const maxTop = (bounds ? bounds.bottom : (window.innerHeight || 768)) - box.height - 8;
      menuRef.current.style.left = Math.max(minLeft, Math.min(menu.x, Math.max(minLeft, maxLeft))) + 'px';
      menuRef.current.style.top = Math.max(minTop, Math.min(menu.y, Math.max(minTop, maxTop))) + 'px';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [menu]);

  React.useEffect(() => {
    if (!overlay) return undefined;
    const outside = (event) => {
      if (barRef.current && barRef.current.contains(event.target)) return;
      closeOverlay();
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, [overlay]);

  // 右键菜单：点到菜单以外的任何位置（包括标签栏空白和别的标签）都立即收起。
  React.useEffect(() => {
    if (!menu) return undefined;
    const outside = (event) => {
      if (menuRef.current && menuRef.current.contains(event.target)) return;
      closeOverlay();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [menu]);

  const dragging = Boolean(drag);
  React.useEffect(() => {
    if (!overlay && !dragging) return undefined;
    const key = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (dragging) {
        cancelDrag();
        return;
      }
      closeOverlay();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [overlay, dragging]);

  const visible = (entry) => visibleIds.includes(entry.id);
  const canSplit = entries.length > 1;
  const splitLabel = t(!canSplit ? 'workspace.splitUnavailable' : pinActive ? 'workspace.splitClose' : 'workspace.splitOpen');

  function activate(entry) {
    if (consumeClick() || drag) return;
    onSelect(entry.id);
  }

  function openMenu(event, entry) {
    event.preventDefault();
    event.stopPropagation();
    cancelDrag();
    setOverlay({ kind: 'menu', id: entry.id, x: event.clientX, y: event.clientY });
  }

  function chooseFolder(raw) {
    if (!raw) { closeOverlay(); return; }
    const relative = isAbsolutePath(raw) ? vaultRelative(vaultPath, raw) : raw;
    const result = onAdd(relative);
    if (result && result.ok === false) {
      // 保留弹层和文件夹列表，用户可以直接改选另一个文件夹。
      const message = result.error || '';
      addErrorRef.current = message;
      setAddError(message);
      return;
    }
    closeOverlay();
  }

  function toggleAdd() {
    if (adding) {
      closeOverlay();
      return;
    }
    addErrorRef.current = '';
    setAddError('');
    setOverlay({ kind: 'add' });
  }

  function toggleMore() {
    if (moreOpen) {
      closeOverlay();
      return;
    }
    addErrorRef.current = '';
    setAddError('');
    setOverlay({ kind: 'more' });
  }

  function pickSystemFolder() {
    if (!request) return Promise.resolve('');
    return request('pickDirectory', { vaultPath: vaultPath, workspace: true })
      .then((value) => (value && typeof value.path === 'string' ? value.path : ''));
  }

  function onTabKeyDown(event, entry) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = entries.findIndex((item) => item.id === entry.id);
    if (index < 0) return;
    const next = entries[index + (event.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    onSelect(next.id);
    const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => callback();
    schedule(() => {
      const tabs = stripRef.current?.querySelectorAll('.SN_wsTab');
      const element = tabs && Array.from(tabs).find((tab) => tab.getAttribute('data-workspace-id') === next.id);
      element?.focus?.();
    });
  }

  function dragEnter(event, entry) {
    if (!dragActive) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    onHoverWorkspace(entry, event.currentTarget);
  }

  function dragDrop(event, entry) {
    if (!dragActive) return;
    event.preventDefault();
    event.stopPropagation();
    onDropWorkspace(event, entry);
  }

  // 标签之间的空隙/标签栏空白处：立即清掉上一条高亮，避免“高亮停在旧标签”。
  function barDragOver(event) {
    if (!dragActive) return;
    if (event.target && typeof event.target.closest === 'function' && event.target.closest('.SN_wsSlot')) return;
    onClearWorkspaceHover();
  }

  function barDragLeave(event) {
    if (!dragActive) return;
    if (event.currentTarget.contains(event.relatedTarget)) return;
    onClearWorkspaceHover();
  }

  // 让当前标签保持在可视区（不滚动整面墙）。
  React.useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector('.SN_wsSlot[data-current="true"]');
    if (!active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 8);
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 8;
  }, [activeId, entries]);

  const menuEntry = menu ? entries.find((entry) => entry.id === menu.id) : null;

  function shortcutBadge(digit) {
    return digit ? h('kbd', { className: 'SN_shortcutKey SN_wsTabHint', 'aria-hidden': 'true' }, `⌘${digit}`) : null;
  }

  function shortcutAria(digit) { return digit ? `Meta+${digit}` : undefined; }

  function renderTab(entry, index) {
    const digit = workspaceShortcutDigit(index);
    const isAll = entry.id === WORKSPACE_ALL_ID;
    const dragging = drag && drag.id === entry.id ? drag : null;
    const title = isAll ? (notesDir || vaultPath || t('workspace.main')) : entry.path + '\n' + t('workspace.reorderHint');
    return h('div', {
      key: entry.id, className: 'SN_wsSlot', 'data-workspace-slot': entry.id,
      'data-current': entry.id === activeId ? 'true' : 'false',
      'data-dragging': dragging ? 'true' : 'false',
      style: dragging ? { '--sn-ws-drag-x': dragging.dx + 'px' } : undefined,
    }, h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': visible(entry) ? 'true' : 'false',
      'aria-label': isAll ? t('workspace.main') : entry.path,
      'aria-keyshortcuts': shortcutAria(digit),
      className: 'SN_wsTab',
      'data-all': isAll ? 'true' : 'false',
      'data-active': visible(entry) ? 'true' : 'false',
      'data-drop': dropId === entry.id ? 'true' : 'false',
      'data-dragging': dragging ? 'true' : 'false',
      'data-workspace-id': entry.id,
      title: title,
      tabIndex: entry.id === activeId ? 0 : -1,
      onClick: () => activate(entry),
      onContextMenu: (event) => openMenu(event, entry),
      onKeyDown: (event) => onTabKeyDown(event, entry),
      onPointerDown: (event) => { if (overlay) closeOverlay(); startPress(event, entry); },
      onLostPointerCapture: cancelDrag,
      onDragEnter: (event) => dragEnter(event, entry),
      onDragOver: (event) => dragEnter(event, entry),
      onDrop: (event) => dragDrop(event, entry),
    },
      dragActive ? h('span', { className: 'SN_wsTabMove', 'aria-hidden': 'true' }, h(ActionIcon, { kind: 'move', size: 12 })) : null,
      h('span', { className: 'SN_wsTabLabel' }, entry.label),
      shortcutBadge(digit),
    ));
  }

  return h('div', {
    className: 'SN_wsBar',
    'data-workspace-bar': '',
    ref: barRef,
    onDragOver: barDragOver,
    onDragLeave: barDragLeave,
  },
    h('div', {
      className: 'SN_wsTabs',
      role: 'tablist', 'aria-multiselectable': visibleIds.length > 1 ? 'true' : undefined,
      'aria-label': t('workspace.aria'),
      ref: stripRef,
      // 鼠标纵向滚轮也能横向浏览隐藏的标签（面板本身不纵向滚动）。
      onWheel: (event) => {
        const strip = stripRef.current;
        if (!strip || strip.scrollWidth <= strip.clientWidth) return;
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        strip.scrollLeft += event.deltaY;
      },
    },
      entries.map(renderTab),
      drag && drag.insertAt !== null
        ? h('span', { className: 'SN_wsCaret', style: { left: drag.caretX + 'px' }, 'aria-hidden': 'true' })
        : null,
    ),
    h('div', { className: 'SN_wsTools' },
      overflow ? h('button', {
        type: 'button',
        className: 'SN_wsTool',
        'data-active': moreOpen ? 'true' : 'false',
        'aria-haspopup': 'menu',
        'aria-expanded': moreOpen ? 'true' : 'false',
        'aria-label': t('workspace.more'),
        title: t('workspace.more'),
        onClick: toggleMore,
      }, h(MoreIcon, null)) : null,
      h('button', {
        type: 'button',
        ref: plusRef,
        className: 'SN_wsTool SN_wsAdd',
        'data-active': adding ? 'true' : 'false',
        'aria-label': t('workspace.add'),
        title: t('workspace.add'),
        'aria-haspopup': 'dialog',
        'aria-expanded': adding ? 'true' : 'false',
        onClick: toggleAdd,
      }, h(PlusIcon, null)),
      moreOpen ? h('div', { className: 'SN_wsMenu SN_wsMoreMenu', role: 'menu', 'aria-label': t('workspace.more') },
        entries.map((entry, index) => h('button', {
          key: entry.id, type: 'button',
          role: 'menuitemcheckbox',
          className: 'SN_wsMenuItem',
          'aria-keyshortcuts': shortcutAria(workspaceShortcutDigit(index)),
          'aria-checked': visible(entry) ? 'true' : 'false',
          'data-active': visible(entry) ? 'true' : 'false',
          onClick: () => { onSelect(entry.id); closeOverlay(); },
        },
          h('span', { className: 'SN_wsMenuCheck', 'aria-hidden': 'true' }, visible(entry) ? '✓' : ''),
          h('span', { className: 'SN_wsMenuLabel' }, entry.label),
          entry.id === WORKSPACE_ALL_ID ? null : h('span', { className: 'SN_wsMenuPathShort' }, entry.path),
          shortcutBadge(workspaceShortcutDigit(index)),
        )),
      ) : null,
    ),
    h('div', { className: 'SN_wsSplitControl' },
      h('button', {
        type: 'button', className: 'SN_wsTool SN_wsZen', 'data-active': zen ? 'true' : 'false',
        'aria-pressed': zen, 'aria-label': t(zen ? 'workspace.zenClose' : 'workspace.zenOpen'),
        title: t(zen ? 'workspace.zenClose' : 'workspace.zenOpen'),
        onClick: () => { closeOverlay(); onToggleZen(); },
      }, h(LeafIcon, null)),
      !zen && canSplit ? h('span', { className: 'SN_shortcutKey SN_wsSplitHint', 'aria-hidden': 'true' },
        h('span', null, t(pinActive ? 'workspace.splitUnlockHint' : 'workspace.splitLockHint')), h('kbd', null, '⌘;'),
      ) : null,
      !zen ? h('button', {
        type: 'button', className: 'SN_wsTool SN_wsSplit', 'data-active': pinActive ? 'true' : 'false',
        disabled: !canSplit, 'aria-pressed': Boolean(pinActive), 'aria-keyshortcuts': canSplit ? 'Meta+;' : undefined,
        'aria-label': splitLabel, title: splitLabel,
        onClick: () => { closeOverlay(); onTogglePin(); },
      }, h(SplitViewIcon, null)) : null,
    ),
    adding ? h('div', {
      className: 'SN_wsPop',
      role: 'dialog',
      'aria-label': t('workspace.addTitle'),
      style: { left: popBox.left + 'px', maxHeight: popBox.maxHeight ? popBox.maxHeight + 'px' : undefined },
    },
      h('div', { className: 'SN_wsPopHead' },
        h('span', { className: 'SN_wsPopTitle' }, t('workspace.addTitle')),
        h('button', {
          type: 'button',
          className: 'SN_wsPopClose',
          'aria-label': t('drawer.close'),
          onClick: closeOverlay,
        }, h(CloseIcon, null)),
      ),
      addError ? h('p', { className: 'SN_settingsError', role: 'alert' }, addError) : null,
      h(VaultFolderPicker, {
        t: t,
        label: t('workspace.chooseFolder'),
        value: '',
        vaultPath: vaultPath,
        history: history || [],
        disabled: false,
        request: request,
        workspace: true,
        placeholder: t('workspace.chooseFolder'),
        open: true,
        excludeFolders: entries.filter((entry) => !entry.all).map((entry) => entry.path)
          .concat('.', vaultRelative(vaultPath, notesDir || '')),
        showCreated: false,
        hideTrigger: true,
        onOpenChange: (open) => {
          // 选择被拒绝时保留弹层展示原因；真正选好或点外部时再收起。
          if (!open && addErrorRef.current === '') closeOverlay();
        },
        onChange: (path) => chooseFolder(path),
        onPick: pickSystemFolder,
      }),
      addError ? null : h('p', { className: 'SN_wsPopHint' }, t('workspace.addHint')),
    ) : null,
    menu && menuEntry ? h('div', {
      className: 'SN_wsMenu',
      role: 'menu',
      'aria-label': t('workspace.actions'),
      ref: menuRef,
      style: { left: menu.x, top: menu.y },
    },
      h('div', { className: 'SN_wsMenuHead' },
        h('span', { className: 'SN_wsMenuTitle', title: menuEntry.path }, menuEntry.label),
        h('span', { className: 'SN_wsMenuPath', title: menuEntry.path }, menuEntry.path),
      ),
      h('div', { className: 'SN_wsColors', role: 'group', 'aria-label': t('workspace.color') },
        WORKSPACE_COLORS.map((color) => h('button', {
          key: color.id,
          type: 'button',
          className: 'SN_wsSwatch',
          'data-active': menuEntry.color === color.id ? 'true' : 'false',
          'aria-label': t('workspace.color.' + color.id),
          'aria-pressed': menuEntry.color === color.id ? 'true' : 'false',
          title: t('workspace.color.' + color.id),
          style: { '--sn-ws-paper': color.light, '--sn-ws-paper-dark': color.dark },
          onClick: () => { onSetColor(menuEntry.id, color.id); closeOverlay(); },
        })),
      ),
      menuEntry.id !== WORKSPACE_ALL_ID ? h('div', { className: 'SN_wsMenuDivider', 'aria-hidden': 'true' }) : null,
      menuEntry.id !== WORKSPACE_ALL_ID ? h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'SN_wsMenuItem SN_wsMenuDelete',
        onClick: () => { onRemove(menu.id); closeOverlay(); },
      }, h(ActionIcon, { kind: 'delete', size: 14 }), h('span', null, t('workspace.remove'))) : null,
    ) : null,
  );
}

export { WorkspaceBar };
