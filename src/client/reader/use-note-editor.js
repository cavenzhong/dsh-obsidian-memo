/** 持有抽屉读取、草稿、保存与任务写入；拒绝迟到回调覆盖新会话。 */
import { DEFAULT_TITLE_MODE } from '../constants.js';
import { clearStoredPinnedNote } from '../preferences.js';
import { React } from '../react.js';
import { createEditorDraftStore, readEditorDraft } from './editor-draft.js';
import { callRpc } from '../runtime.js';
import { applyTitleEdit, createTitleEdit, deriveTitle, normalizeTitleMode } from './title-line.js';
import { isAbortError } from '../utils.js';

function useNoteEditor(options) {
  const { tRef, aliveRef, controllersRef, request, refreshNow, replaceNote, replaceRenamedNote,
  pushToast, pushErrorToast, onOpen, onClose, notesForRestore } = options;
  const titleMode = normalizeTitleMode(options.titleMode || DEFAULT_TITLE_MODE);
  const [noteDrawer, setNoteDrawer] = React.useState(null); // { path, summary, full, loading, error }
  const noteDrawerRef = React.useRef(null);
  const drawerAbortRef = React.useRef(null);
  const [editing, setEditing] = React.useState(false);
  const editingRef = React.useRef(false);
  const [bodyDraft, setBodyDraft] = React.useState('');
  const bodyDraftRef = React.useRef('');
  const [titleDraft, setTitleDraft] = React.useState('');
  const titleDraftRef = React.useRef('');
  const titleModeRef = React.useRef(titleMode);
  titleModeRef.current = titleMode;
  // 本次编辑会话使用的模式：编辑期间设置变化不打断当前草稿。
  const editModeRef = React.useRef(titleMode);
  const titleEditRef = React.useRef(null);
  const [savingNote, setSavingNote] = React.useState(false);
  const savingNoteRef = React.useRef(false);
  const [taskBusy, setTaskBusy] = React.useState(false);
  const taskBusyRef = React.useRef(false);
  const editorSessionRef = React.useRef(0);
  const draftSessionRef = React.useRef(null), resumeDraftRef = React.useRef(null);
  const editPositionRef = React.useRef(null);
  const restoreCheckedRef = React.useRef(false);
  const [draftStore] = React.useState(createEditorDraftStore);
  function updateTitleDraft(value) {
    titleDraftRef.current = value;
    setTitleDraft(value);
  }
  function updateDrawer(value) {
    const next = typeof value === 'function' ? value(noteDrawerRef.current) : value;
    noteDrawerRef.current = next;
    setNoteDrawer(next);
  }
  React.useEffect(() => {
    window.addEventListener?.('pagehide', draftStore.flush);
    return () => {
      draftStore.flush();
      window.removeEventListener?.('pagehide', draftStore.flush);
      drawerAbortRef.current?.abort();
    };
  }, [draftStore]);
  React.useEffect(() => {
    if (!Array.isArray(notesForRestore) || restoreCheckedRef.current) return;
    restoreCheckedRef.current = true;
    if (noteDrawerRef.current) return;
    const draft = readEditorDraft();
    // 使用当前库的完整扫描列表（而非日期筛选）；不对其它库或未知路径发请求。
    const note = draft && notesForRestore.find((item) => item.path === draft.path);
    if (note) openNoteDrawer(note, draft);
  }, [notesForRestore]);

  function persistDraft() {
    const session = draftSessionRef.current;
    if (!session) return null;
    const body = bodyDraftRef.current, title = titleDraftRef.current;
    const titleBase = session.mode !== 'filename' ? titleEditRef.current?.body : undefined;
    const draft = { ...session, body, title, titleBase: titleBase === body ? undefined : titleBase,
      position: editPositionRef.current ?? undefined };
    draftStore.queue(draft);
    return draft;
  }
  function discardDraft() {
    draftStore.discard(draftSessionRef.current || resumeDraftRef.current);
    draftSessionRef.current = null;
    resumeDraftRef.current = null;
    editPositionRef.current = null;
  }
  function dirty(closing) {
    const full = closing && closing.full;
    const original = full && typeof full.body === 'string' ? full.body : '';
    if (bodyDraftRef.current !== original) return true;
    if (editModeRef.current !== 'filename') return false;
    const summaryName = closing && closing.summary && typeof closing.summary.name === 'string' ? closing.summary.name : '';
    const originalName = (full && (full.name || full.title)) || summaryName || '';
    return titleDraftRef.current.trim() !== originalName;
  }
  function closeNoteDrawer() {
    // noteDrawerRef 可能为空（首次打开前/关闭后），判空后再读 summary（0.13 修复）。
    editorSessionRef.current += 1;
    const closing = noteDrawerRef.current;
    if (editingRef.current && closing && dirty(closing)) {
      pushToast({ text: tRef.current('drawer.editDiscarded'), kind: 'info' });
    }
    if (drawerAbortRef.current) {
      drawerAbortRef.current.abort();
      drawerAbortRef.current = null;
    }
    onClose();
    discardDraft();
    editingRef.current = false;
    bodyDraftRef.current = '';
    titleEditRef.current = null;
    updateTitleDraft('');
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
      const current = noteDrawerRef.current;
      if (!current || current.path !== path) return;
      const loaded = full && typeof full === 'object' ? full : null;
      updateDrawer({ ...current, full: loaded, summary: loaded || current.summary, loading: false, error: null });
      const draft = resumeDraftRef.current;
      if (draft?.path === path && typeof loaded?.body === 'string') {
        resumeDraftRef.current = null;
        enterEditing(loaded, path, draft);
      }
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

  function openNoteDrawer(note, resumeDraft = null) {
    if (!note || typeof note.path !== 'string') return;
    editorSessionRef.current += 1;
    onOpen();
    discardDraft();
    resumeDraftRef.current = resumeDraft;
    editingRef.current = false;
    bodyDraftRef.current = '';
    titleEditRef.current = null;
    savingNoteRef.current = false;
    setEditing(false);
    setBodyDraft('');
    updateTitleDraft('');
    setSavingNote(false);
    updateDrawer({ path: note.path, summary: note, full: null, loading: true, error: null });
    loadNote(note.path);
  }

  function handleBodyChange(value) {
    if (savingNoteRef.current) return;
    bodyDraftRef.current = value;
    setBodyDraft(value);
    // 正文模式：在正文里改首行 / H1 时，标题框跟着变（可能为空）。
    if (editModeRef.current !== 'filename') {
      titleEditRef.current = createTitleEdit(value, editModeRef.current);
      const derived = titleEditRef.current.source.title;
      if (derived !== titleDraftRef.current) updateTitleDraft(derived);
    }
    persistDraft();
  }

  function handleTitleChange(value) {
    if (savingNoteRef.current) return;
    const mode = editModeRef.current;
    updateTitleDraft(value);
    if (mode === 'filename') { persistDraft(); return; }
    // 同一轮标题输入始终基于原始目标；清空、** 等中间态不重新定位。
    const edit = titleEditRef.current;
    if (!edit) return;
    const next = applyTitleEdit(edit, value);
    if (next !== bodyDraftRef.current) {
      bodyDraftRef.current = next;
      setBodyDraft(next);
    }
    persistDraft();
  }

  function handleEditPositionChange(position) {
    if (!draftSessionRef.current || savingNoteRef.current) return;
    const previous = editPositionRef.current;
    if (previous && Object.keys(position).every((key) => previous[key] === position[key])) return;
    editPositionRef.current = position;
    persistDraft();
  }

  function startEditing() {
    if (editingRef.current || taskBusyRef.current || savingNoteRef.current) return;
    const current = noteDrawerRef.current;
    if (!current || !current.full) return;
    if (typeof current.full.body !== 'string') return;
    if (drawerAbortRef.current) drawerAbortRef.current.abort();
    updateDrawer(Object.assign({}, current, { loading: false }));
    enterEditing(current.full, current.path);
  }

  function enterEditing(full, path, draft = null) {
    const mode = draft?.mode ?? titleModeRef.current;
    const body = draft?.body ?? full.body;
    editPositionRef.current = draft?.position ?? null;
    draftSessionRef.current = {
      id: draft?.id ?? `${Date.now()}-${Math.random()}`,
      path, mode, revision: draft ? draft.revision : (full.contentRevision ?? null),
    };
    editModeRef.current = mode;
    titleEditRef.current = createTitleEdit(draft?.titleBase ?? body, mode);
    bodyDraftRef.current = body;
    setBodyDraft(body);
    updateTitleDraft(draft?.title ?? (mode === 'filename' ? (full.name || full.title || '') : titleEditRef.current.source.title));
    editingRef.current = true;
    setEditing(true);
    if (!draft) persistDraft();
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
    if (current && dirty(current)) {
      pushToast({ text: tRef.current('drawer.editDiscarded'), kind: 'info' });
    }
    discardDraft();
    editingRef.current = false;
    bodyDraftRef.current = '';
    titleEditRef.current = null;
    setEditing(false);
    setBodyDraft('');
    if (current) loadNote(current.path);
  }

  function saveEditing() {
    const current = noteDrawerRef.current;
    if (!current || !editingRef.current || savingNoteRef.current) return;
    const path = current.path;
    const session = editorSessionRef.current;
    const body = bodyDraftRef.current;
    const original = current.full && typeof current.full.body === 'string' ? current.full.body : '';
    const summaryName = current.summary && typeof current.summary.name === 'string' ? current.summary.name : '';
    const originalName = (current.full && (current.full.name || current.full.title)) || summaryName || '';
    const mode = editModeRef.current;
    const name = titleDraftRef.current.trim();
    if (mode === 'filename' && !name) {
      pushErrorToast(new Error(tRef.current('drawer.filenameRequired')));
      return;
    }
    if (body === original && (mode !== 'filename' || name === originalName)) {
      discardDraft();
      editingRef.current = false;
      bodyDraftRef.current = '';
      titleEditRef.current = null;
      setEditing(false);
      setBodyDraft('');
      return;
    }
    savingNoteRef.current = true;
    setSavingNote(true);
    // 正文模式不发送 name：标题已在 body 里，保存不重命名文件。
    const submitted = persistDraft();
    draftStore.flush();
    const payload = { path: path, body: body, expectedRevision: draftSessionRef.current?.revision };
    if (mode === 'filename') payload.name = name;
    request('saveNote', payload)
      .then((value) => {
        draftStore.discard(submitted, true);
        if (!aliveRef.current) return;
        const savedNote = value && value.note;
        if (savedNote) {
          if (typeof savedNote.path === 'string' && savedNote.path !== path) replaceRenamedNote(path, savedNote);
          else replaceNote(savedNote);
        }
        // 用户在保存途中切换/关闭了抽屉：不要动新抽屉的编辑态。
        const stillOpen = Boolean(editorSessionRef.current === session && noteDrawerRef.current && noteDrawerRef.current.path === path);
        if (stillOpen) {
          draftSessionRef.current = null;
          if (savedNote && savedNote.path !== path) {
            noteDrawerRef.current = { path: savedNote.path, summary: savedNote, full: null, loading: true, error: null };
            updateDrawer(noteDrawerRef.current);
          }
          editingRef.current = false;
          bodyDraftRef.current = '';
          titleEditRef.current = null;
          setEditing(false);
          setBodyDraft('');
          updateTitleDraft(savedNote
            ? (mode === 'filename' ? savedNote.name : deriveTitle(body, mode))
            : name);
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

  // setTitleDraft 保留旧接口语义，但同样经由 handleTitleChange，避免只改 state 不更新 ref。
  return { noteDrawer, noteDrawerRef, editing, editingRef, restoringDraftRef: resumeDraftRef, editTitleMode: editing ? editModeRef.current : titleMode,
  bodyDraft, titleDraft, setTitleDraft: handleTitleChange, editPositionRef, handleEditPositionChange,
  savingNote, savingNoteRef, taskBusy, closeNoteDrawer, loadNote, openNoteDrawer,
  handleBodyChange, handleTitleChange, startEditing, toggleTask, cancelEditing, saveEditing };
}

export { useNoteEditor };
