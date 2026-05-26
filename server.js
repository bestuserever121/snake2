import { createServer as createHttpServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { handleConnection } from './src/server/room-manager.js'

const port = Number(process.env.PORT ?? 5273)
const isProd = process.env.NODE_ENV === 'production'
const httpServer = createHttpServer()

if (isProd) {
  const sirv = (await import('sirv')).default
  const serve = sirv('./dist', {
    single: true,
    setHeaders(res, pathname) {
      if (pathname.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  })
  httpServer.on('request', (req, res) => serve(req, res))
} else {
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
    },
    appType: 'spa',
  })
  httpServer.on('request', (req, res) => {
    vite.middlewares(req, res, () => {
      res.statusCode = 404
      res.end('Not found')
    })
  })
}

const wss = new WebSocketServer({ noServer: true })
httpServer.on('upgrade', (req, socket, head) => {
  const { url } = req
  if (url && url.startsWith('/ws')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  }
})

wss.on('connection', (ws) => handleConnection(ws))

httpServer.listen(port, () => {
  const mode = isProd ? 'production' : 'dev'
  console.log(`Snake Arena Online (${mode}) ready on port ${port}`)
})
