/** Cordis Host entry: compose per-plugin services and the authenticated RPC route. */
import { createConfiguration } from './host/configuration.js'
import { createScanCoordinator } from './host/scanning.js'
import { createSessionState } from './host/session.js'
import { createVaultPaths } from './host/vault.js'
import { createWriteCoordinator } from './host/writes.js'
import { createImageReader } from './host/images.js'
import { createNoteEndpoints } from './host/notes.js'
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
      if (['vaultPath', 'notesDir', 'includeSubfolders'].some((key) => previous[key] !== next[key])) resetScan()
      if (previous.vaultPath !== next.vaultPath || previous.notesDir !== next.notesDir) clearImagePaths()
    } })

  const { invalidateScan, resetScan, scanOnce, invalidateAndScan, scanner } = createScanCoordinator({ getSettings })

  const { purgeExpiredState, liveJobs, runningJob, startJob, finishJob, jobsFingerprint, jobs, undos, deleteUndos, commentUndos } = createSessionState()

  const { resolved, requireNotes, assertNotePath } = createVaultPaths({ getSettings })

  const { withNoteWrite } = createWriteCoordinator()

  const { endpointReadImage, clearImagePaths } = createImageReader({ assertNotePath, requireNotes })

  const { endpointNote, endpointSaveNote, endpointCreateNote, endpointToggleTask, endpointOpenInObsidian } = createNoteEndpoints({ assertNotePath, getSettings, invalidateAndScan, requireNotes, resolved, scanOnce, scanner })

  const { endpointComment, endpointOpenProject } = createAiEndpoints({
    assertNotePath, ctx, finishJob, getSettings, invalidateAndScan, invalidateScan, jobs, requireNotes,
    runningJob, startJob, withNoteWrite,
  })

  const { endpointDeleteComment, endpointUndoDeleteComment } = createCommentEndpoints({
    assertNotePath, commentUndos, invalidateAndScan, purgeExpiredState, scanner, withNoteWrite,
  })

  const { endpointArchive, endpointUndoArchive, endpointDeleteNote, endpointUndoDelete, endpointTrash } = createMutationEndpoints({
    assertNotePath, clearImagePaths, deleteUndos, invalidateAndScan, invalidateScan, jobs,
    purgeExpiredState, requireNotes, resolved, undos, withNoteWrite,
  })

  const { endpointState, endpointSettings, endpointRescan } = createStateEndpoints({
    getSettings, jobsFingerprint, liveJobs, publicSettings, queueSettings, refreshConfig, resetScan,
    scanOnce, settingsFingerprint,
  })

  const { endpointListFolders, endpointCreateFolder, endpointChooseConfigDirectory, endpointPickDirectory } = createFolderEndpoints({ ctx, getSettings })

  const endpoints = {
    state: endpointState,
    settings: endpointSettings,
    note: endpointNote,
    saveNote: endpointSaveNote,
    createNote: endpointCreateNote,
    toggleTask: endpointToggleTask,
    readImage: endpointReadImage,
    comment: endpointComment,
    deleteComment: endpointDeleteComment,
    undoDeleteComment: endpointUndoDeleteComment,
    archive: endpointArchive,
    undoArchive: endpointUndoArchive,
    deleteNote: endpointDeleteNote,
    undoDelete: endpointUndoDelete,
    openProject: endpointOpenProject,
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
  debugLog('通道已注册；便签目录：', getSettings().notesDir || '未配置')
}
