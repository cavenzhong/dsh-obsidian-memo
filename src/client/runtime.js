/** 持有当前宿主连接与翻译函数，集中处理 RPC 信封和错误。 */
import { CHANNEL } from './constants.js';
import { isAbortError, makeError } from './utils.js';

let runtime = null;

async function callRpc(endpoint, payload, signal) {
  if (!runtime || !runtime.connection || !runtime.connection.rpc || typeof runtime.connection.rpc.call !== 'function') {
    throw makeError('offline', runtime && runtime.t ? runtime.t('error.offline') : 'Connection unavailable');
  }
  let result;
  try {
    result = await runtime.connection.rpc.call(CHANNEL, endpoint, payload, signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw makeError('transport', error && error.message ? error.message : String(error));
  }
  if (result && result.ok === true) return result.value;
  const failure = result && result.error ? result.error : null;
  throw makeError(
    failure && typeof failure.code === 'string' ? failure.code : 'failed',
    failure && typeof failure.message === 'string' && failure.message !== ''
      ? failure.message
      : (runtime && runtime.t ? runtime.t('error.failed') : 'Request failed'),
  );
}

function setRuntime(value) { runtime = value; }

export { runtime, callRpc, setRuntime };
