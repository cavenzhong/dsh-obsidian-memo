/** 无状态的路径、时间、版本与错误处理辅助函数。 */


function formatVersionLabel(version) {
  const raw = typeof version === 'string' ? version.trim() : '';
  const match = raw.match(/^v?(\d+\.\d+(?:\.\d+){0,2})/i);
  return match ? match[1] : '';
}

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isAbortError(error) {
  return Boolean(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
}

function isAbsolutePath(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (value.charAt(0) === '/') return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return value.indexOf('\\\\') === 0;
}

function joinPath(base, child) {
  if (typeof base !== 'string' || base === '') return String(child || '');
  if (typeof child !== 'string' || child === '') return base;
  const separator = base.indexOf('\\') >= 0 && base.charAt(0) !== '/' ? '\\' : '/';
  return base.replace(/[\\/]+$/, '') + separator + child.replace(/^[\\/]+/, '');
}

function baseName(value) {
  if (typeof value !== 'string' || value === '') return '';
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.length === 0 ? value : parts[parts.length - 1];
}

function resolvedPath(vaultPath, path) {
  if (typeof path !== 'string' || path === '') return '';
  if (isAbsolutePath(path)) return path;
  return joinPath(vaultPath, path);
}

function formatTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
  try {
    const date = new Date(ms);
    const pad = (value) => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  } catch (error) {
    return '';
  }
}

export { formatVersionLabel, makeError, isAbortError, cloneJson, isAbsolutePath, joinPath, baseName, resolvedPath, formatTime };
