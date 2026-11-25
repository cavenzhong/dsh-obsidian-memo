/** Zen：无卡片的标题列表与空详情态。 */
import { React, h } from '../react.js';

function useZenNote({ enabled, loaded, notes, noteDrawerRef, editing, editingRef, restoringDraftRef, savingNoteRef, onOpen, onClose }) {
  React.useEffect(() => {
    if (!enabled || !loaded || !notes || editingRef.current || restoringDraftRef.current || savingNoteRef.current) return;
    const current = noteDrawerRef.current;
    if (current && notes.some((note) => note.path === current.path)) return;
    if (notes[0]) onOpen(notes[0]);
    else if (current) onClose();
  }, [enabled, loaded, notes, editing, onOpen, onClose]);
}

function ZenWorkspaceList({ model, selectedPath, actionsRef, dragNote, onOpen, t }) {
  const notes = model?.sortedNotes || [];
  return h('nav', { className: 'SN_zenList', 'aria-label': t('workspace.zenList') },
    notes.length
      ? notes.map((note) => h('button', {
        key: note.path,
        type: 'button',
        className: 'SN_zenRow',
        'data-selected': note.path === selectedPath ? 'true' : 'false',
        'data-dragging': dragNote?.path === note.path ? 'true' : 'false',
        'aria-current': note.path === selectedPath ? 'true' : undefined,
        draggable: !note.pending,
        onClick: () => onOpen(note),
        onDragStart(event) {
          if (note.pending) { event.preventDefault(); return; }
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-dsh-memo', note.path);
          const rect = event.currentTarget.getBoundingClientRect();
          const doc = event.currentTarget.ownerDocument;
          if (doc?.body && event.dataTransfer.setDragImage) {
            const image = doc.createElement('canvas');
            image.width = image.height = 1;
            image.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none';
            doc.body.appendChild(image);
            event.dataTransfer.setDragImage(image, 0, 0);
            setTimeout(() => image.remove(), 0);
          }
          const started = actionsRef.current.onDragStart(note, {
            x: event.clientX, y: event.clientY, width: rect.width, height: rect.height,
            offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
          }, event.currentTarget);
          if (started === false) event.preventDefault();
        },
        onDragEnd: () => actionsRef.current.onDragEnd(),
      }, h('span', { className: 'SN_zenRowTitle' }, note.title || note.name || '')))
      : h('p', { className: 'SN_zenEmpty' }, t('workspace.zenEmpty')),
  );
}

function ZenDetailEmpty({ t }) {
  return h('div', { className: 'SN_zenDetailEmpty', role: 'status' }, t('workspace.zenSelectNote'));
}

export { useZenNote, ZenDetailEmpty, ZenWorkspaceList };
