/** 仓库字段和库内文件夹下拉，支持历史、浏览和新建。 */
import { Fragment, React, h } from '../react.js';
import { isAbsolutePath, joinPath } from '../utils.js';

function vaultRelative(vault, value) {
  const clean = (path) => String(path || '').split(String.fromCharCode(92)).join('/');
  let root = clean(vault);
  while (root.endsWith('/')) root = root.slice(0, -1);
  const path = clean(value);
  if (root && path === root) return '.';
  return root && path.startsWith(root + '/') ? path.slice(root.length + 1) : path;
}

function VaultFolderPicker({ t, label, value, vaultPath, history, disabled, onChange, onPick, request, placeholder }) {
  const [open, setOpen] = React.useState(false);
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
  React.useEffect(() => {
    setOpen(false); setCreating(false); setCreatingBusy(false); setLoading(false); setCreated(''); setError('');
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
    const outside = (event) => { if (!wrap.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, [open]);
  React.useEffect(() => {
    if (!open || !request || !vaultPath) return undefined;
    let alive = true;
    setLoading(true); setError(''); setFolders([]);
    request('listFolders', { vaultPath }).then((result) => { if (alive) setFolders(result.folders || []); })
      .catch((cause) => { if (alive) fail(cause); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, vaultPath]);
  const choose = (path) => { onChange(path); setOpen(false); setQuery(''); setCreating(false); setCreated(''); };
  const recent = [...new Set((history || []).map((path) => vaultRelative(vaultPath, path)).filter((path) => !isAbsolutePath(path)))];
  const options = [...new Set(recent.concat(folders))].filter((path) => path.toLowerCase().includes(query.toLowerCase()));
  return h('div', { className: 'SN_folderPicker', ref: wrap, onKeyDown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } } },
    h('button', { type: 'button', className: 'SN_folderTrigger', disabled: disabled || !vaultPath, title: value || '',
      'aria-label': label, 'aria-haspopup': 'dialog', 'aria-expanded': open, onClick: () => setOpen(!open) },
      h('span', null, value ? vaultRelative(vaultPath, value) : placeholder || t('settings.chooseFolder')), h('span', { 'aria-hidden': 'true' }, '⌄')),
    open ? h('div', { className: 'SN_folderMenu', role: 'dialog', 'aria-label': label, 'data-up': menuLayout.up ? 'true' : 'false', style: { maxHeight: menuLayout.height } },
      h('button', { type: 'button', className: 'SN_folderOption', disabled: loading, onClick: () => setCreating(!creating) }, '＋ ', t('settings.newFolder')),
      creating ? h('div', { className: 'SN_folderCreateSection' }, h('form', { className: 'SN_folderCreate', onSubmit: (event) => {
        event.preventDefault(); if (!name.trim() || loading) return; setLoading(true); setCreatingBusy(true); setError(''); setCreated('');
        request('createFolder', { vaultPath, path: name.trim() }).then((result) => { if (isCurrent()) { choose(result.path); setCreated(vaultRelative(vaultPath, result.path)); setName(''); } })
          .catch((cause) => { if (isCurrent()) fail(cause); }).finally(() => { if (isCurrent()) { setLoading(false); setCreatingBusy(false); } });
      } }, h('input', { className: 'SN_textInput', value: name, autoFocus: true, 'aria-label': t('settings.folderName'),
        placeholder: t('settings.folderName'), onChange: (event) => setName(event.target.value), disabled: loading }),
        h('button', { type: 'submit', className: 'SN_ghostBtn SN_smallBtn', disabled: loading || !name.trim() }, t(creatingBusy ? 'settings.creatingFolder' : 'settings.create'))),
        h('p', { className: 'SN_fieldHint' }, t('settings.newFolderHint')),
        name.trim() ? h('code', { className: 'SN_configPath' }, t('settings.createAt') + ': ' + joinPath(vaultPath, name.trim())) : null) : null,
      h('button', { type: 'button', className: 'SN_folderOption', disabled: loading, onClick: () => {
        Promise.resolve().then(onPick).then((path) => { if (isCurrent()) { if (path) choose(path); else setOpen(false); } })
          .catch((cause) => { if (isCurrent()) fail(cause); });
      } }, t('settings.browseFolder')),
      value ? h('button', { type: 'button', className: 'SN_folderOption', onClick: () => choose('') }, t('settings.clearFolder')) : null,
      h('input', { className: 'SN_textInput', value: query, 'aria-label': t('settings.searchFolder'), placeholder: t('settings.searchFolder'), onChange: (event) => setQuery(event.target.value) }),
      loading ? h('p', { className: 'SN_fieldHint', role: 'status' }, t('panel.loading')) : null,
      error ? h('p', { className: 'SN_settingsError', role: 'alert' }, error) : null,
      h('div', { className: 'SN_folderOptions' }, options.map((path) => h('button', { key: path, type: 'button', className: 'SN_folderOption',
        onClick: () => choose(path), title: path }, h('span', null, path === '.' ? t('settings.vaultRoot') : path),
        recent.includes(path) ? h('small', null, t('settings.recent')) : null))),
    ) : null,
    created ? h('p', { className: 'SN_fieldHint SN_folderCreated', role: 'status' }, t('settings.folderCreated', { path: created })) : null);
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
