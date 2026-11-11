/** 持有一次拖拽会话；统一 drop/dragend、归档停靠和取消。 */
import { focusCaptureOnTab } from '../capture/keyboard.js';
import { React } from '../react.js';

function useCardDrag({
  aliveRef, archiveTargets, findTarget, openProjectDialog, panelRef, pushToast, runArchive, runDelete,
  setDateMenu, setDrawerArchive, setHoverPath, setSortMenu, tRef,
}) {
  const [dragSession, setDragSession] = React.useState(null);
  const dragSessionRef = React.useRef(null), dragMotionRef = React.useRef(null), captureFocusRef = React.useRef(false);
  const dragNote = dragSession?.note || null;

  React.useLayoutEffect(() => {
    if (!dragNote && captureFocusRef.current) {
      captureFocusRef.current = false;
      panelRef.current?.querySelector('.SN_captureTitle')?.focus();
    }
  }, [dragNote]);
  const [dropTarget, setDropTarget] = React.useState(null);
  const dropAction = dropTarget?.kind || null, dropTargetId = dropTarget?.id || null;

  React.useEffect(() => {
    if (!dragNote) return undefined;
    // 空白墙面也接收本次内部拖放：否则浏览器先执行拒绝拖放的原生回弹，
    // 延迟 dragend 后才轮到自定义回落。操作栏仍先处理 drop，再冒泡到此处。
    const accept = (event) => {
      const session = dragSessionRef.current;
      if (!session || session.ending || session.parked || !Array.from(event.dataTransfer?.types || []).includes('application/x-dsh-memo')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    };
    const end = (event) => {
      if (event.type === 'drop') {
        if (dragSessionRef.current?.parked || !Array.from(event.dataTransfer?.types || []).includes('application/x-dsh-memo')) return;
        event.preventDefault();
      }
      return endCardDrag();
    };
    const key = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); endCardDrag(); }
      else if (event.key === 'Enter' && dragSessionRef.current?.parked) {
        const panel = panelRef.current;
        focusCaptureOnTab(event, {
          panel, form: panel?.querySelector('.SN_capture'), busy: false,
          // 等 React 提交输入岛可见状态后再聚焦，避免聚焦仍隐藏的 textarea。
          title: { focus() { captureFocusRef.current = true; endCardDrag(); } },
        });
      }
    };
    const dismissParked = (event) => {
      if (!dragSessionRef.current?.parked || event.target?.closest?.('.SN_dropItem[data-action="archive"]')) return;
      endCardDrag();
    };
    document.addEventListener('dragenter', accept, true);
    document.addEventListener('dragover', accept, true);
    document.addEventListener('drop', end);
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', dismissParked, true);
    document.addEventListener('focusin', dismissParked, true);
    window.addEventListener('blur', end);
    return () => {
      document.removeEventListener('dragenter', accept, true);
      document.removeEventListener('dragover', accept, true);
      document.removeEventListener('drop', end);
      document.removeEventListener('keydown', key, true); window.removeEventListener('blur', end);
      document.removeEventListener('pointerdown', dismissParked, true);
      document.removeEventListener('focusin', dismissParked, true);
    };
  }, [Boolean(dragNote)]);

  function endCardDrag(mode = 'return', operation) {
    const session = dragSessionRef.current;
    if (!session || session.ending) return session?.finished || Promise.resolve();
    session.ending = true;
    if (session.parked) setDropTarget(null);
    // drop 与 dragend 共用一次收尾；文件操作并行进行，不先闪回原卡片再移除。
    const animation = dragMotionRef.current?.finish(mode, session.source);
    session.finished = Promise.all([animation, operation]).then(() => {
      if (dragSessionRef.current !== session || !aliveRef.current) return;
      dragSessionRef.current = null;
      setDragSession(null); setDropTarget(null);
    });
    return session.finished;
  }

  function startCardDrag(note, point, source) {
    if (dragSessionRef.current) return false;
    const session = { note, point, source, ending: false };
    dragSessionRef.current = session;
    setDragSession(session); setDropTarget(null); setHoverPath(null);
    setDrawerArchive(false); setSortMenu(false); setDateMenu(false);
  }

  function hoverDragAction(kind, targetId) {
    if (!dragSessionRef.current || dragSessionRef.current.ending || dragSessionRef.current.parked) return;
    setDropTarget((current) => {
      if (!kind) return current ? null : current;
      return current?.kind === kind && current.id === (targetId || null) ? current : { kind, id: targetId || null };
    });
  }

  function deleteDrop(event) {
    const session = dragSessionRef.current;
    if (!session || session.ending) return;
    const note = session.note;
    const path = event.dataTransfer.getData('application/x-dsh-memo');
    if (path !== note.path) { endCardDrag(); return; }
    endCardDrag('drop', runDelete(note));
  }

  function archiveDrop(event, targetId) {
    const session = dragSessionRef.current;
    if (!session || session.ending) return;
    const note = session.note;
    const path = event.dataTransfer.getData('application/x-dsh-memo');
    if (path !== note.path) { endCardDrag(); return; }
    if (targetId) { endCardDrag('drop', runArchive(note, targetId)); return; }
    if (!archiveTargets.length) {
      endCardDrag();
      pushToast({ text: tRef.current('archive.emptyHint'), kind: 'info', timeout: 6000 });
      return;
    }
    const anchor = event.currentTarget?.closest?.('.SN_dropItem[data-action="archive"]');
    if (!anchor) { endCardDrag(); return; }
    // 放到归档区但未选目录：停止跟随鼠标，预览停在按钮正中，保留底部目录菜单。
    session.parked = true;
    dragMotionRef.current?.park(anchor);
    setDragSession(Object.assign({}, session));
    setDropTarget({ kind: 'archive', id: null });
  }

  function chooseArchiveTarget(targetId) {
    const session = dragSessionRef.current;
    if (!session?.parked || session.ending || !findTarget(targetId)) return;
    endCardDrag('drop', runArchive(session.note, targetId));
  }

  function projectDrop(event) {
    const session = dragSessionRef.current;
    if (!session || session.ending) return;
    const note = session.note;
    const path = event.dataTransfer.getData('application/x-dsh-memo');
    endCardDrag().then(() => { if (aliveRef.current && path === note.path) openProjectDialog(note); });
  }

  return { dragSession, dragSessionRef, dragMotionRef, dragNote, dropAction, dropTargetId, endCardDrag, startCardDrag, hoverDragAction, deleteDrop, archiveDrop, chooseArchiveTarget, projectDrop };
}

export { useCardDrag };
