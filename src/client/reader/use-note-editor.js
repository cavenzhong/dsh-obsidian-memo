/** 持有抽屉读取、草稿、保存与任务写入；拒绝迟到回调覆盖新会话。 */
import { clearStoredPinnedNote } from '../preferences.js';
import { React } from '../react.js';
import { callRpc } from '../runtime.js';
import { isAbortError } from '../utils.js';

function useNoteEditor(options) {
  const { tRef, aliveRef, controllersRef, request, refreshNow, replaceNote, replaceRenamedNote,
  pushToast, pushErrorToast, onOpen, onClose } = options;
  const [noteDrawer, setNoteDrawer] = React.useState(null); // { path, summary, full, loading, error }
  const noteDrawerRef = React.useRef(null);
  const drawerAbortRef = React.useRef(null);
  const [editing, setEditing] = React.useState(false);
  const editingRef = React.useRef(false);
  const [bodyDraft, setBodyDraft] = React.useState('');
  const bodyDraftRef = React.useRef('');
  const [titleDraft, setTitleDraft] = React.useState('');
  const [savingNote, setSavingNote] = React.useState(false);
  const savingNoteRef = React.useRef(false);
  const [taskBusy, setTaskBusy] = React.useState(false);
  const taskBusyRef = React.useRef(false);
  const editorSessionRef = React.useRef(0);
  function updateDrawer(value) {
    const next = typeof value === 'function' ? value(noteDrawerRef.current) : value;
    noteDrawerRef.current = next;
    setNoteDrawer(next);
  }
  React.useEffect(() => () => {
    if (drawerAbortRef.current) drawerAbortRef.current.abort();
  }, []);
  function closeNoteDrawer() {
    // noteDrawerRef 可能为空（首次打开前/关闭后），判空后再读 summary（0.13 修复）。
    editorSessionRef.current += 1;
    const closing = noteDrawerRef.current;
    if (editingRef.current && closing) {
      const full = closing.full;
      const original = full && typeof full.body === 'string' ? full.body : '';
      const summaryName = closing.summary && typeof closing.summary.name === 'string' ? closing.summary.name : '';
      const originalName = (full && (full.name || full.title)) || summaryName || '';
      if (bodyDraftRef.current !== original || titleDraft.trim() !== originalName) {
        pushToast({ text: tRef.current('drawer.editDiscarded'), kind: 'info' });
      }
    }
    if (drawerAbortRef.current) {
      drawerAbortRef.current.abort();
      drawerAbortRef.current = null;
    }
    onClose();
    editingRef.current = false;
    bodyDraftRef.current = '';
    savingNoteRef.current = false;
    setEditing(false);
    setBodyDraft('');
    setSavingNote(false);
    // 0.13.4：主动关闭后不再记住这篇（锁定态重进时改为选当前筛选第一篇）。
    clearStoredPinnedNote();
    updateDrawer(null);
  }

  async function loadNote(path) {
    if (typeof path !== 'string' || path === '') return;
    if (!noteDrawerRef.current || noteDrawerRef.current.path !== path) return;
    updateDrawer((current) => (current && current.path === path
      ? Object.assign({}, current, { loading: true, error: null })
      : current));
    if (drawerAbortRef.current) drawerAbortRef.current.abort();
    const controller = new AbortController();
    drawerAbortRef.current = controller;
    controllersRef.current.add(controller);
    try {
      const full = await callRpc('note', { path: path }, controller.signal);
      if (!aliveRef.current || controller.signal.aborted || drawerAbortRef.current !== controller || editingRef.current) return;
      updateDrawer((current) => {
        if (!current || current.path !== path) return current;
        return Object.assign({}, current, {
          full: full && typeof full === 'object' ? full : null,
          summary: full && typeof full === 'object' ? full : current.summary,
          loading: false,
          error: null,
        });
      });
    } catch (error) {
      if (isAbortError(error)) return;
      if (!aliveRef.current || controller.signal.aborted || drawerAbortRef.current !== controller) return;
      updateDrawer((current) => {
        if (!current || current.path !== path) return current;
        return Object.assign({}, current, {
          loading: false,
          error: error && error.message ? error.message : String(error),
        });
      });
    } finally {
      controllersRef.current.delete(controller);
      if (drawerAbortRef.current === controller) drawerAbortRef.current = null;
    }
  }

  function openNoteDrawer(note) {
    if (!note || typeof note.path !== 'string') return;
    editorSessionRef.current += 1;
    onOpen();
    editingRef.current = false;
    bodyDraftRef.current = '';
    savingNoteRef.current = false;
    setEditing(false);
    setBodyDraft('');
    setSavingNote(false);
    updateDrawer({ path: note.path, summary: note, full: null, loading: true, error: null });
    loadNote(note.path);
  }

  function handleBodyChange(value) {
    bodyDraftRef.current = value;
    setBodyDraft(value);
  }

  function startEditing() {
    if (taskBusyRef.current || savingNoteRef.current) return;
    const current = noteDrawerRef.current;
    if (!current || !current.full) return;
    if (typeof current.full.body !== 'string') return;
    if (drawerAbortRef.current) drawerAbortRef.current.abort();
    updateDrawer(Object.assign({}, current, { loading: false }));
    bodyDraftRef.current = current.full.body;
    setBodyDraft(current.full.body);
    setTitleDraft(current.full.name || current.full.title || '');
    editingRef.current = true;
    setEditing(true);
  }

  async function toggleTask(sourceLine, checked) {
    const current = noteDrawerRef.current;
    if (!current || !current.full || editingRef.current || taskBusyRef.current) return;
    taskBusyRef.current = true;
    setTaskBusy(true);
    try {
      const result = await request('toggleTask', { path: current.path, sourceLine, checked, expectedBody: current.full.body });
      if (result.note) replaceNote(result.note);
      await loadNote(current.path);
      await refreshNow(false);
    } catch (error) {
      if (!isAbortError(error)) pushErrorToast(error);
      await loadNote(current.path);
    } finally {
      taskBusyRef.current = false;
      if (aliveRef.current) setTaskBusy(false);
    }
  }

  function cancelEditing() {
    if (savingNoteRef.current) return;
    const current = noteDrawerRef.current;
    const full = current && current.full;
    const original = full && typeof full.body === 'string' ? full.body : '';
    const summaryName = current && current.summary && typeof current.summary.name === 'string' ? current.summary.name : '';
    const originalName = (full && (full.name || full.title)) || summaryName || '';
    if (bodyDraftRef.current !== original || titleDraft.trim() !== originalName) {
      pushToast({ text: tRef.current('drawer.editDiscarded'), kind: 'info' });
    }
    editingRef.current = false;
    bodyDraftRef.current = '';
    setEditing(false);
    setBodyDraft('');
    if (current) loadNote(current.path);
  }

  function saveEditing() {
    const current = noteDrawerRef.current;
    if (!current || savingNoteRef.current) return;
    const path = current.path;
    const session = editorSessionRef.current;
    const body = bodyDraftRef.current;
    const original = current.full && typeof current.full.body === 'string' ? current.full.body : '';
    const summaryName = current.summary && typeof current.summary.name === 'string' ? current.summary.name : '';
    const originalName = (current.full && (current.full.name || current.full.title)) || summaryName || '';
    const name = titleDraft.trim();
    if (!name) {
      pushErrorToast(new Error('便签文件名不能为空'));
      return;
    }
    if (body === original && name === originalName) {
      editingRef.current = false;
      bodyDraftRef.current = '';
      setEditing(false);
      setBodyDraft('');
      return;
    }
    savingNoteRef.current = true;
    setSavingNote(true);
    request('saveNote', { path: path, body: body, name: name, expectedRevision: current.full && current.full.contentRevision })
      .then((value) => {
        if (!aliveRef.current) return;
        const savedNote = value && value.note;
        if (savedNote) {
          if (typeof savedNote.path === 'string' && savedNote.path !== path) replaceRenamedNote(path, savedNote);
          else replaceNote(savedNote);
        }
        // 用户在保存途中切换/关闭了抽屉：不要动新抽屉的编辑态。
        const stillOpen = Boolean(editorSessionRef.current === session && noteDrawerRef.current && noteDrawerRef.current.path === path);
        if (stillOpen) {
          if (savedNote && savedNote.path !== path) {
            noteDrawerRef.current = { path: savedNote.path, summary: savedNote, full: null, loading: true, error: null };
            updateDrawer(noteDrawerRef.current);
          }
          editingRef.current = false;
          bodyDraftRef.current = '';
          setEditing(false);
          setBodyDraft('');
          setTitleDraft(savedNote ? savedNote.name : name);
          loadNote(savedNote ? savedNote.path : path);
          pushToast({ text: tRef.current('drawer.saved'), kind: 'success' });
        }
        return refreshNow(false);
      })
      .catch((error) => {
        if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
      })
      .then(() => {
        if (editorSessionRef.current !== session) return;
        savingNoteRef.current = false;
        if (aliveRef.current) setSavingNote(false);
      });
  }

  return { noteDrawer, noteDrawerRef, editing, editingRef, bodyDraft, titleDraft, setTitleDraft,
  savingNote, savingNoteRef, taskBusy, closeNoteDrawer, loadNote, openNoteDrawer,
  handleBodyChange, startEditing, toggleTask, cancelEditing, saveEditing };
}

export { useNoteEditor };
