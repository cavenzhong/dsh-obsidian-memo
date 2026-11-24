/** 每个空间独立持有滚动元素和分页；日期、排序与快捷记录由主面板共享。 */
import { WORKSPACE_ALL_ID } from '../constants.js';
import { filterNotesByWorkspace } from '../panel/workspaces.js';
import { React, h } from '../react.js';
import { filterNotesByDate, sortNotes } from './model.js';
import { useWallContent } from './use-wall-content.js';
import { useWallPaging } from './use-wall-paging.js';

function useWorkspaceWallModels({ paneEntries, view, dateFilter, dateRealtime, nowTick, dateEnabled, sortId }) {
  const { vaultPath, includeSubfolders } = view.settings || {};
  return React.useMemo(() => paneEntries.map((entry) => {
    const topOnly = entry.primary === true && includeSubfolders === false;
    const notes = filterNotesByWorkspace(view.notes, entry.path, vaultPath, { topOnly });
    const filteredNotes = filterNotesByDate(notes, dateFilter, dateRealtime, nowTick, undefined, dateEnabled);
    return { entry, filteredNotes, sortedNotes: sortNotes(filteredNotes, sortId), workspaceEmpty: !notes.length,
      workspaceNeedsSubfolders: topOnly && entry.path !== '.' };
  }), [paneEntries, view.notes, vaultPath, includeSubfolders, dateFilter, dateRealtime, nowTick, dateEnabled, sortId]);
}

function WorkspaceWall({ model, active, split, onSelect, onBackTopChange, ...props }) {
  const { entry, filteredNotes, sortedNotes, workspaceEmpty, workspaceNeedsSubfolders } = model;
  const wallRef = React.useRef(null);
  const paging = useWallPaging({ ...props, wallRef, sortedNotes });
  React.useEffect(() => {
    if (!filteredNotes.length) onBackTopChange(entry.id, false);
    return () => onBackTopChange(entry.id, false);
  }, [Boolean(filteredNotes.length), entry.id, onBackTopChange]);
  const { renderContent } = useWallContent({
    ...props, ...paging, wallRef, filteredNotes, sortedNotes, workspaceEmpty, workspaceNeedsSubfolders,
    workspaceActive: entry.path !== '.' || split, workspaceLabel: entry.label, workspacePrimary: entry.primary === true,
    onExitWorkspace: () => onSelect(WORKSPACE_ALL_ID),
    setShowBackTop: (show) => onBackTopChange(entry.id, show),
  });
  return h('section', {
    className: 'SN_workspacePane', 'data-wall-workspace': entry.id, 'data-current': active ? 'true' : 'false',
    'aria-label': entry.label,
    onPointerDownCapture: split ? (event) => { if (event.button === 0) onSelect(entry.id); } : undefined,
    onFocusCapture: split ? () => onSelect(entry.id) : undefined,
  },
    split ? h('div', { className: 'SN_workspacePaneLabel', title: entry.label }, entry.label) : null,
    renderContent(),
  );
}

export { WorkspaceWall, useWorkspaceWallModels };
