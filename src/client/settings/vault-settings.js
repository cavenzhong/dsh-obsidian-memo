/** Automatic draft vault checks and explicit handoff to Obsidian's vault manager. */
import { React, h } from '../react.js';
import { SettingsPathField } from './paths.js';
import { isAbortError } from '../utils.js';

const CLI_DOCS = 'https://help.obsidian.md/cli';
const DOWNLOAD = 'https://obsidian.md/download';
const CLI_STATES = ['unverified', 'ready', 'cli-missing', 'cli-disabled', 'cli-not-running', 'cli-not-ready', 'vault-mismatch', 'links-disabled'];

function VaultSettingsField(props) {
  const { t, value, firstSetup, request, disabled, onPatch } = props;
  const scope = typeof value === 'string' ? value.trim() : '';
  const canRequest = typeof request === 'function';
  const [result, setResult] = React.useState(null);
  const [handoff, setHandoff] = React.useState(null);
  const current = React.useRef(null);
  const contextRef = React.useRef(null);
  const generation = React.useRef(0);
  const handoffGeneration = React.useRef(0);
  const typedScope = React.useRef(null);
  if (contextRef.current?.scope !== scope || contextRef.current.canRequest !== canRequest) {
    contextRef.current = { scope, canRequest };
  }
  const context = contextRef.current;
  current.current = request;

  async function check() {
    const path = context.scope;
    const send = current.current;
    if (contextRef.current !== context || !path || typeof send !== 'function') return;
    const ticket = ++generation.current;
    const isCurrent = () => generation.current === ticket && contextRef.current === context;
    setResult({ context, status: 'checking' });
    try {
      const outcome = await send('checkVault', { path, verifyCli: true, onlyRunning: true });
      if (isCurrent()) setResult({ ...outcome, context, status: outcome?.status || 'check-error' });
    } catch (error) {
      if (isCurrent() && !isAbortError(error)) setResult({ context, status: 'check-error' });
    }
  }

  React.useEffect(() => {
    // Opening settings and choosing a folder are immediate; only typing needs a debounce.
    const typed = typedScope.current === scope;
    typedScope.current = null;
    let timer;
    if (scope && canRequest) {
      if (typed) timer = setTimeout(check, 260);
      else void check();
    }
    return () => { clearTimeout(timer); generation.current += 1; };
  }, [context]);

  React.useEffect(() => {
    setHandoff(null);
    return () => { handoffGeneration.current += 1; };
  }, [scope]);

  function editPath(patch) {
    const next = patch.vaultPath?.trim();
    if (next !== scope) typedScope.current = next;
    onPatch?.(patch);
  }

  async function openManager(mode) {
    const ticket = ++handoffGeneration.current;
    const isCurrent = () => handoffGeneration.current === ticket && contextRef.current.scope === scope;
    if (!isCurrent() || typeof request !== 'function') return;
    setHandoff({ scope, status: 'opening' });
    try {
      const outcome = await request('openVaultManager', { mode, ...(mode === 'register' ? { path: scope } : {}) });
      if (isCurrent()) setHandoff(outcome?.opened ? null : { scope, status: 'error' });
    } catch (error) {
      if (isCurrent() && !isAbortError(error)) setHandoff({ scope, status: 'error' });
    }
  }

  const state = result?.context === context ? result : null;
  const status = state?.status || (scope ? (canRequest ? 'checking' : 'check-error') : '');
  const activity = handoff?.scope === scope ? handoff.status : '';
  const cliCheck = CLI_STATES.includes(status);
  const badge = status ? h('span', { className: 'SN_vaultBadge',
    'data-tone': status === 'ready' ? 'ready' : ['checking', 'unverified'].includes(status) ? 'neutral' : 'warning',
    role: 'status' }, status === 'ready' ? '✓ ' : ['checking', 'unverified'].includes(status) ? '' : '! ', t('settings.vaultStatus.' + status)) : null;
  const button = (key, action, busy = false) => h('button', { type: 'button', className: 'SN_ghostBtn SN_smallBtn',
    disabled: disabled || busy || !canRequest, onClick: action }, t(key));
  const link = (url, key) => h('a', { className: 'SN_vaultLink', href: url, target: '_blank', rel: 'noopener noreferrer' }, t(key));
  const showInstall = activity === 'error' || (status !== 'ready' && (firstSetup || ['plain', 'unregistered', ...CLI_STATES].includes(status)));
  const canCreate = firstSetup && !scope;
  const canRegister = state?.canRegister === true;
  const setupMode = canCreate ? 'new' : canRegister ? 'register' : '';
  const displayDetails = scope || firstSetup || activity;
  return h('section', { className: 'SN_vaultSettings', 'data-sn-vault-settings': '' },
    h(SettingsPathField, { ...props, badge, onPatch: editPath,
      browseAction: button('settings.vaultRecheck', check, !scope || status === 'checking') }),
    displayDetails ? h('div', { className: 'SN_vaultDiagnostics' },
      status && !['checking', 'ready'].includes(status) ? h('p', { className: 'SN_fieldHint' },
        t(status === 'unregistered' && !canRegister ? 'settings.vaultHint.unregisteredParent' : 'settings.vaultHint.' + status)) : null,
      state?.vaultPath && (state.isSubfolder || status === 'unregistered' && !canRegister) ? h('p', { className: 'SN_fieldHint SN_vaultLocation' },
        t('settings.vaultLocation'), h('code', null, state.vaultPath)) : null,
      state?.paths?.map((path) => h('code', { key: path, className: 'SN_vaultConflictPath' }, path)),
      (canRegister || canCreate || showInstall) ? h('div', { className: 'SN_vaultActions' },
        canCreate ? button('settings.vaultCreate', () => openManager('new'), activity === 'opening') : null,
        canRegister ? button('settings.vaultRegister', () => openManager('register'), activity === 'opening') : null,
        showInstall ? link(DOWNLOAD, 'settings.vaultDownload') : null,
        showInstall && (cliCheck || firstSetup) ? link(CLI_DOCS, 'settings.vaultCliDocs') : null,
      ) : null,
      setupMode ? h('ol', { className: 'SN_vaultHelp SN_vaultSteps' },
        h('li', null, t('settings.vaultHandoff.' + setupMode)),
        h('li', null, t('settings.vaultHandoff.enableLinks')),
        h('li', null, t(setupMode === 'new' ? 'settings.vaultHandoff.returnNew' : 'settings.vaultHandoff.returnRegister')),
      ) : null,
      activity === 'error' ? h('p', { className: 'SN_vaultHelp', role: 'status' }, t('settings.vaultHandoff.error')) : null,
    ) : null,
  );
}

export { VaultSettingsField };
