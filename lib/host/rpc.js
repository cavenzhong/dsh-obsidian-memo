/** 已认证 HTTP RPC 传输：认证、路径、请求预算与信封；不执行业务。 */
import { CHANNEL, LIMITS } from '../shared.js'

function registerRpcRoute(ctx, dispatch) {
  ctx.effect(() => {
    const webServer = ctx.get('webServer')
    const connection = ctx.get('connection')
    if (webServer === undefined) return () => {}
    const route = {
      kind: 'prefix',
      path: CHANNEL,
      handler: async (req, res) => {
        const rejection = connection?.requestRejection?.({ headers: req.headers })
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end('method not allowed')
          return
        }
        let pathname
        try { pathname = new URL(req.url ?? CHANNEL, 'http://127.0.0.1').pathname } catch {
          respond(res, 'invalid', { ok: false, error: { code: 'bad-request', message: '请求路径无效', details: {} } })
          return
        }
        const pathEndpoint = pathname.startsWith(`${CHANNEL}/`) ? pathname.slice(CHANNEL.length + 1) : ''
        let raw = ''
        try {
          const limit = pathEndpoint === 'createNote' ? LIMITS.captureRequestBytes
            : ['saveNote', 'toggleTask'].includes(pathEndpoint) ? LIMITS.noteRequestBytes : LIMITS.maxFileBytes
          let bytes = 0
          const chunks = []
          for await (const chunk of req) {
            bytes += Buffer.byteLength(chunk)
            if (bytes > limit) throw new Error('body too large')
            chunks.push(Buffer.from(chunk))
          }
          raw = Buffer.concat(chunks).toString('utf8')
        } catch (error) {
          res.writeHead(400)
          res.end('unreadable body')
          return
        }
        let message
        try {
          message = JSON.parse(raw)
        } catch {
          respond(res, 'invalid', { ok: false, error: { code: 'bad-request', message: 'body is not JSON', details: {} } })
          return
        }
        const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid'
        const endpoint = typeof message?.method === 'string' ? message.method : ''
        if (endpoint === '' || endpoint !== pathEndpoint) {
          respond(res, rpcId, {
            ok: false,
            error: { code: 'bad-request', message: `method ${JSON.stringify(endpoint)} 与路径 ${JSON.stringify(pathname)} 不匹配`, details: {} },
          })
          return
        }
        let result
        try {
          result = await dispatch(endpoint, message.payload ?? {})
        } catch (error) {
          result = { ok: false, error: { code: 'fs-failed', message: error?.message ?? String(error), details: {} } }
        }
        respond(res, rpcId, result)
      },
    }
    return webServer.register(route)
  }, 'sticky-notes: rpc route')
}

function respond(res, rpcId, result) {
  const body = { type: 'server-response', rpcId, result }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export { registerRpcRoute }
