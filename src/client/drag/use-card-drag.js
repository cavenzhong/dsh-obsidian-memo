/** 持有一次拖拽会话；统一 drop/dragend 与取消。 */
import { React } from '../react.js';

function useCardDrag({
  aliveRef, moveWorkspaceNote, requestDeepSeek, runArchive, runDelete,
  setDateMenu, setHoverPath, setSortMenu,
}) {
  const [dragSession, setDragSession] = React.useState(null);
  const dragSessionRef = React.useRef(null), dragMotionRef = React.useRef(null);
  const leaveTimer = React.useRef(null);
  const dragNote = dragSession?.note || null;

  const [dropTarget, setDropTarget] = React.useState(null);
  const dropAction = dropTarget?.kind || null, dropTargetId = dropTarget?.id || null;

  React.useEffect(() => {
    if (!dragNote) return undefined;
    // 空白墙面也接收本次内部拖放：否则浏览器先执行拒绝拖放的原生回弹，
    // 延迟 dragend 后才轮到自定义回落。操作栏仍先处理 drop，再冒泡到此处。
    const accept = (event) => {
      const session = dragSessionRef.current;
      if (!session || session.ending || !Array.from(event.dataTransfer?.types || []).includes('application/x-dsh-memo')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    };
    const end = (event) => {
      if (event.type === 'drop') {
        if (!Array.from(event.dataTransfer?.types || []).includes('application/x-dsh-memo')) return;
        event.preventDefault();
      }
      return endCardDrag();
    };
    const key = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); endCardDrag(); }
    };
    document.addEventListener('dragenter', accept, true);
    document.addEventListener('dragover', accept, true);
    document.addEventListener('drop', end);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', end);
    return () => {
      clearTimeout(leaveTimer.current);
      document.removeEventListener('dragenter', accept, true);
      document.removeEventListener('dragover', accept, true);
      document.removeEventListener('drop', end);
      document.removeEventListener('keydown', key, true); window.removeEventListener('blur', end);
    };
  }, [Boolean(dragNote)]);

  function endCardDrag(mode = 'return', operation) {
    const session = dragSessionRef.current;
    if (!session || session.ending) return session?.finished || Promise.resolve();
    session.ending = true; clearTimeout(leaveTimer.current);
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
    setSortMenu(false); setDateMenu(false);
  }

  /** 立即清掉拖放目标（离开标签栏空白处时用，不走 150ms 防抖）。 */
  function clearDropTarget() {
    const session = dragSessionRef.current;
    if (!session || session.ending) return;
    clearTimeout(leaveTimer.current);
    setDropTarget(null);
  }

  function hoverDragAction(kind, targetId = null) {
    if (!dragSessionRef.current || dragSessionRef.current.ending) return;
    clearTimeout(leaveTimer.current);
    // Chromium may report a null relatedTarget between the button and its floating rows.
    if (!kind) {
      const session = dragSessionRef.current;
      leaveTimer.current = setTimeout(() => {
        if (dragSessionRef.current === session && !session.ending) setDropTarget(null);
      }, 150);
      return;
    }
    setDropTarget((current) => {
      const id = targetId || null;
      return current?.kind === kind && current.id === id ? current : { kind, id };
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

  function archiveDrop(event) {
    const session = dragSessionRef.current;
    if (!session || session.ending) return;
    const note = session.note;
    const path = event.dataTransfer.getData('application/x-dsh-memo');
    if (path !== note.path) { endCardDrag(); return; }
    endCardDrag('drop', runArchive(note));
  }

  /** 把便签拖到工作空间标签上，松手即移动到该文件夹。 */
  function workspaceDrop(event, workspace) {
    const session = dragSessionRef.current;
    if (!session || session.ending || !workspace) return;
    const note = session.note;
    const path = event.dataTransfer.getData('application/x-dsh-memo');
    if (path !== note.path) { endCardDrag(); return; }
    endCardDrag('drop', moveWorkspaceNote(note, workspace));
  }

  /** 拖到发送位后结束拖拽，再打开共享工作区/形式菜单。 */
  function deepSeekDrop(event) {
    const session = dragSessionRef.current;
    if (!session || session.ending) return;
    const note = session.note;
    const path = event.dataTransfer.getData('application/x-dsh-memo');
    if (path !== note.path) { endCardDrag(); return; }
    endCardDrag('drop');
    requestDeepSeek(note, event.currentTarget);
  }


  return { dragSession, dragSessionRef, dragMotionRef, dragNote, dropAction, dropTargetId, endCardDrag, startCardDrag, hoverDragAction, clearDropTarget, deleteDrop, archiveDrop, deepSeekDrop, workspaceDrop };
}

export { useCardDrag };
