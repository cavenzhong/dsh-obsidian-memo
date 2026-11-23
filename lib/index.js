/** Cordis Host entry: compose per-plugin services and the authenticated RPC route. */
import { createConfiguration } from './host/configuration.js'
import { createScanCoordinator } from './host/scanning.js'
import { createSessionState } from './host/session.js'
import { createVaultPaths } from './host/vault.js'
import { createWriteCoordinator } from './host/writes.js'
import { createImageReader } from './host/images.js'
import { createNoteEndpoints } from './host/notes.js'
import { createProjects } from './host/projects.js'
import { createAiEndpoints } from './host/ai-jobs.js'
import { createCommentEndpoints } from './host/comments.js'
import { createMutationEndpoints } from './host/mutations.js'
import { createStateEndpoints } from './host/state.js'
import { createFolderEndpoints } from './host/folders.js'
import { createDispatcher } from './host/dispatch.js'
import { debugLog } from './host/environment.js'
import { registerRpcRoute } from './host/rpc.js'

export const name = 'sticky-notes'
export const inject = ['connection', 'webServer', 'llm', 'agentDefaultModel', 'directoryPickerController']

export async function apply(ctx, config) {
  const {
    queueSettings, publicSettings, settingsFingerprint, refreshConfig, endpointSaveSettings,
    endpointConfigFile, endpointChooseConfigFile, getSettings,
  } = await createConfiguration({ config, onSettingsChange(next, previous) {
      if (['vaultPath', 'notesDir', 'includeSubfolders', 'titleMode', 'projectKey', 'archiveMode', 'archiveFolderName', 'archiveDir'].some((key) => previous[key] !== next[key])) resetScan()
      if (previous.vaultPath !== next.vaultPath || previous.notesDir !== next.notesDir) clearImagePaths()
    } })

  const { invalidateScan, resetScan, scanOnce, invalidateAndScan, scanner } = createScanCoordinator({ getSettings })

  const { purgeExpiredState, liveJobs, runningJob, startJob, finishJob, jobsFingerprint, jobs, undos, deleteUndos, commentUndos } = createSessionState()

  const { resolved, requireNotes, assertNotePath, assertActiveWorkspace } = createVaultPaths({ getSettings })

  const { withNoteWrite, withNoteWrites } = createWriteCoordinator()

  const { endpointReadImage, clearImagePaths } = createImageReader({ assertNotePath, requireNotes })

  const { endpointNote, endpointNoteFile, endpointSaveNote, endpointCreateNote, endpointToggleTask, endpointReorderTask, endpointOpenInObsidian } = createNoteEndpoints({ assertNotePath, assertActiveWorkspace, getSettings, invalidateAndScan, requireNotes, resolved, scanOnce, scanner })

  const { endpointComment } = createAiEndpoints({ assertNotePath, ctx, finishJob, getSettings, invalidateScan, jobs, runningJob, startJob, withNoteWrite })
  const projects = createProjects({ assertNotePath, ctx, finishJob, getSettings, invalidateScan, jobs, requireNotes, startJob, withNoteWrites })

  const { endpointDeleteComment, endpointUndoDeleteComment } = createCommentEndpoints({
    assertNotePath, commentUndos, getSettings, invalidateAndScan, purgeExpiredState, scanner, withNoteWrite,
  })

  const { endpointArchive, endpointUndoArchive, endpointMoveNote, endpointUndoMove, endpointDeleteNote, endpointUndoDelete, endpointTrash } = createMutationEndpoints({
    assertNotePath, assertActiveWorkspace, clearImagePaths, deleteUndos, invalidateAndScan, invalidateScan, jobs,
    purgeExpiredState, requireNotes, resolved, scanner, undos, withNoteWrite, withNoteWrites,
  })

  const { endpointState, endpointSettings, endpointRescan } = createStateEndpoints({
    getSettings, jobsFingerprint, liveJobs, publicSettings, queueSettings, refreshConfig, resetScan,
    scanOnce, settingsFingerprint,
  })

  const { endpointListFolders, endpointCreateFolder, endpointChooseConfigDirectory, endpointPickDirectory } = createFolderEndpoints({ assertActiveWorkspace, ctx, getSettings })

  const endpoints = {
    state: endpointState,
    settings: endpointSettings,
    note: endpointNote,
    noteFile: endpointNoteFile,
    saveNote: endpointSaveNote,
    createNote: endpointCreateNote,
    toggleTask: endpointToggleTask,
    reorderTask: endpointReorderTask,
    readImage: endpointReadImage,
    comment: endpointComment,
    deleteComment: endpointDeleteComment,
    undoDeleteComment: endpointUndoDeleteComment,
    archive: endpointArchive,
    undoArchive: endpointUndoArchive,
    moveNote: endpointMoveNote,
    undoMove: endpointUndoMove,
    deleteNote: endpointDeleteNote,
    undoDelete: endpointUndoDelete,
    ...projects,
    openInObsidian: endpointOpenInObsidian,
    saveSettings: endpointSaveSettings,
    configFile: endpointConfigFile,
    listFolders: endpointListFolders,
    createFolder: endpointCreateFolder,
    chooseConfigDirectory: endpointChooseConfigDirectory,
    chooseConfigFile: endpointChooseConfigFile,
    trash: endpointTrash,
    pickDirectory: endpointPickDirectory,
    rescan: endpointRescan,
  }

  const dispatch = createDispatcher({ endpoints, queueSettings, withNoteWrite })

  registerRpcRoute(ctx, dispatch)
  debugLog('通道已注册；默认工作空间：', getSettings().notesDir || '未配置')
}
