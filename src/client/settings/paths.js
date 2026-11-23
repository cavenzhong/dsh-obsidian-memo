/** 仓库字段和库内文件夹下拉，支持历史、浏览和新建。 */
import { formatDiagnostic } from '../i18n/diagnostics.js';
import { Fragment, React, h } from '../react.js';
import { isAbsolutePath, joinPath, vaultRelative } from '../utils.js';

function VaultFolderPicker({ t, label, value, vaultPath, history, disabled, onChange, onPick, request, placeholder, open: controlledOpen, onOpenChange, showCreated, hideTrigger, excludeFolders, workspace = false }) {
  // 0.18：工作空间需要在“选择被拒绝”时保持菜单打开，支持受控 open；设置页仍用内部状态。
  const [innerOpen, setInnerOpen] = React.useState(false);
  const isControlled = typeof controlledOpen === 'boolean';
  const open = isControlled ? controlledOpen : innerOpen;
  // 0.18：工作空间弹层复用同一个文件夹选择器，打开/关闭需要同步给外层弹层。
  const openChangeRef = React.useRef(onOpenChange);
  openChangeRef.current = onOpenChange;
  function applyOpen(next) {
    if (!isControlled) setInnerOpen(next);
    if (typeof openChangeRef.current === 'function') openChangeRef.current(next);
  }
  const [folders, setFolders] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState('');
  const [created, setCreated] = React.useState('');
  const [creatingBusy, setCreatingBusy] = React.useState(false);
  const wrap = React.useRef(null);
  const scope = React.useRef({ vaultPath, alive: true });
  scope.current.vaultPath = vaultPath;
  React.useEffect(() => {
    scope.current.alive = true;
    return () => { scope.current.alive = false; };
  }, []);
  const isCurrent = () => scope.current.alive && scope.current.vaultPath === vaultPath;
  const previousVaultRef = React.useRef(vaultPath);
  React.useEffect(() => {
    // 只在仓库真正变化时收起；首次挂载不受影响（工作空间的受控 open 保持展开）。
    if (previousVaultRef.current === vaultPath) return;
    previousVaultRef.current = vaultPath;
    applyOpen(false); setCreating(false); setCreatingBusy(false); setLoading(false); setCreated(''); setError('');
  }, [vaultPath]);
  const [menuLayout, setMenuLayout] = React.useState({ up: false, height: 340 });
  React.useLayoutEffect(() => {
    if (!open || !wrap.current?.getBoundingClientRect) return undefined;
    const measure = () => {
      const rect = wrap.current.getBoundingClientRect();
      const body = wrap.current.closest('.SN_drawerBody');
      const bounds = body?.getBoundingClientRect();
      const top = Math.max(8, bounds?.top || 0);
      const bottom = Math.min(window.innerHeight - 8, bounds?.bottom || window.innerHeight);
      const below = bottom - rect.bottom - 6, above = rect.top - top - 6;
      const up = below < 260 && above > below;
      setMenuLayout({ up, height: Math.max(80, Math.min(340, up ? above : below)) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);
  const fail = (cause) => setError(cause.message || String(cause));
  React.useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!wrap.current?.contains(event.target)) applyOpen(false); };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, [open]);
  React.useEffect(() => {
    if (!open || !request || !vaultPath) return undefined;
    let alive = true;
    setLoading(true); setError(''); setFolders([]);
    request('listFolders', workspace ? { vaultPath, workspace } : { vaultPath }).then((result) => { if (alive) setFolders(result.folders || []); })
      .catch((cause) => { if (alive) fail(cause); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, vaultPath, workspace]);
  const choose = (path) => { onChange(path); applyOpen(false); setQuery(''); setCreating(false); setCreated(''); };
  // 已经挂成标签的文件夹（以及「所有」占用的仓库根）不再重复列出。
  const normalizeOption = (path) => {
    const cleaned = String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return cleaned === '' || cleaned === '.' || cleaned === './' ? '.' : cleaned;
  };
  const recent = [...new Set((history || []).map((path) => vaultRelative(vaultPath, path)).filter((path) => !isAbsolutePath(path)))];
  const listed = workspace ? folders.map(normalizeOption) : folders;
  const excluded = new Set((Array.isArray(excludeFolders) ? excludeFolders : []).map(normalizeOption));
  // 工作空间的最近目录也需通过 Host 的过滤，避免从配置历史重新挂回归档目录。
  const allowed = workspace ? new Set(listed) : null;
  const options = [...new Set(recent.concat(listed))]
    .filter((path) => !allowed || allowed.has(path))
    .filter((path) => !excluded.has(normalizeOption(path)))
    .filter((path) => path.toLowerCase().includes(query.toLowerCase()));
  return h('div', { className: 'SN_folderPicker', ref: wrap, onKeyDown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); applyOpen(false); } } },
    // 0.18：工作空间弹层自带标题和关闭按钮，不再重复一个触发器。
    hideTrigger === true ? null : h('button', { type: 'button', className: 'SN_folderTrigger', disabled: disabled || !vaultPath, title: value || '',
      'aria-label': label, 'aria-haspopup': 'dialog', 'aria-expanded': open, onClick: () => applyOpen(!open) },
      h('span', null, value ? vaultRelative(vaultPath, value) : placeholder || t('settings.chooseFolder')), h('span', { 'aria-hidden': 'true' }, '⌄')),
    open ? h('div', { className: 'SN_folderMenu', role: 'dialog', 'aria-label': label, 'data-up': menuLayout.up ? 'true' : 'false', style: { maxHeight: menuLayout.height } },
      h('button', { type: 'button', className: 'SN_folderOption', disabled: loading, onClick: () => setCreating(!creating) }, '＋ ', t('settings.newFolder')),
      creating ? h('div', { className: 'SN_folderCreateSection' }, h('form', { className: 'SN_folderCreate', onSubmit: (event) => {
        event.preventDefault(); if (!name.trim() || loading) return; setLoading(true); setCreatingBusy(true); setError(''); setCreated('');
        request('createFolder', { vaultPath, path: name.trim(), ...(workspace ? { workspace } : {}) }).then((result) => { if (isCurrent()) { choose(result.path); setCreated(vaultRelative(vaultPath, result.path)); setName(''); } })
          .catch((cause) => { if (isCurrent()) fail(cause); }).finally(() => { if (isCurrent()) { setLoading(false); setCreatingBusy(false); } });
      } }, h('input', { className: 'SN_textInput', value: name, autoFocus: true, 'aria-label': t('settings.folderName'),
        placeholder: t('settings.folderName'), onChange: (event) => setName(event.target.value), disabled: loading }),
        h('button', { type: 'submit', className: 'SN_ghostBtn SN_smallBtn', disabled: loading || !name.trim() }, t(creatingBusy ? 'settings.creatingFolder' : 'settings.create'))),
        h('p', { className: 'SN_fieldHint' }, t('settings.newFolderHint')),
        name.trim() ? h('code', { className: 'SN_configPath' }, t('settings.createAt') + ': ' + joinPath(vaultPath, name.trim())) : null) : null,
      h('button', { type: 'button', className: 'SN_folderOption', disabled: loading, onClick: () => {
        Promise.resolve().then(onPick).then((path) => { if (isCurrent()) { if (path) choose(path); else applyOpen(false); } })
          .catch((cause) => { if (isCurrent()) fail(cause); });
      } }, t('settings.browseFolder')),
      value ? h('button', { type: 'button', className: 'SN_folderOption', onClick: () => choose('') }, t('settings.clearFolder')) : null,
      h('input', { className: 'SN_textInput', value: query, 'aria-label': t('settings.searchFolder'), placeholder: t('settings.searchFolder'), onChange: (event) => setQuery(event.target.value) }),
      loading ? h('p', { className: 'SN_fieldHint', role: 'status' }, t('panel.loading')) : null,
      error ? h('p', { className: 'SN_settingsError', role: 'alert' }, formatDiagnostic(t, error)) : null,
      h('div', { className: 'SN_folderOptions' }, options.map((path) => h('button', { key: path, type: 'button', className: 'SN_folderOption',
        onClick: () => choose(path), title: path }, h('span', null, path === '.' ? t('settings.vaultRoot') : path),
        recent.includes(path) ? h('small', null, t('settings.recent')) : null))),
    ) : null,
    created && showCreated !== false ? h('p', { className: 'SN_fieldHint SN_folderCreated', role: 'status' }, t('settings.folderCreated', { path: created })) : null);
}

function SettingsPathField(props) {
  const {
    t, label, hint, value, field, disabled, picking,
    onPatch, onPick, vaultPath, history, request,
  } = props;
  return h('div', { className: 'SN_field' },
    h('span', { className: 'SN_fieldLabel' }, label),
    field !== 'vaultPath' && vaultPath ? h(VaultFolderPicker, { t, label, value, vaultPath, history, disabled: disabled || picking !== null, request,
      onChange: (path) => onPatch({ [field]: path }), onPick: () => onPick(field) }) : h(Fragment, null,
    h('input', {
      type: 'text',
      className: 'SN_textInput',
      value: value || '',
      spellCheck: false,
      disabled: disabled,
      'aria-label': label,
      onChange: (event) => onPatch({ [field]: event.target.value }),
    }),
    h('div', { className: 'SN_pathActions' },
      h('button', {
        type: 'button',
        className: 'SN_ghostBtn SN_smallBtn',
        disabled: disabled || picking !== null,
        onClick: () => onPick(field),
      }, picking === field ? t('settings.picking') : t('settings.pick')),
    ),
    ),
    hint ? h('p', { className: 'SN_fieldHint' }, hint) : null,
  );
}

export { vaultRelative, VaultFolderPicker, SettingsPathField };
