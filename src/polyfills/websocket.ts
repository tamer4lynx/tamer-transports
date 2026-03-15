'background only'

declare const lynx: { getJSModule(id: string): { addListener(e: string, fn: (ev: { payload?: string }) => void): void } }
declare const NativeModules: {
  LynxWebSocketModule?: {
    connect(url: string, id: number): void
    send(id: number, message: string): void
    sendBinary(id: number, base64: string): void
    close(id: number, code: number, reason: string): void
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

type WSHandlers = {
  onopen: (() => void) | null
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null
  onerror: ((e: Error) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
}

const webSockets = new Map<number, WSHandlers>()
let nextId = 1

export function installWebSocketPolyfill() {
  const mod = NativeModules?.LynxWebSocketModule
  if (!mod) return

  const bridge = lynx.getJSModule('GlobalEventEmitter')

  bridge.addListener('websocket:open', (event: { payload?: string }) => {
    const { id } = JSON.parse(event.payload ?? '{}')
    const ws = webSockets.get(id)
    if (ws?.onopen) ws.onopen()
  })

  bridge.addListener('websocket:message', (event: { payload?: string }) => {
    const { id, data, type } = JSON.parse(event.payload ?? '{}')
    const ws = webSockets.get(id)
    if (!ws?.onmessage) return
    const payloadData = type === 'binary' ? base64ToArrayBuffer(data) : data
    ws.onmessage({ data: payloadData })
  })

  bridge.addListener('websocket:error', (event: { payload?: string }) => {
    const { id, message } = JSON.parse(event.payload ?? '{}')
    const ws = webSockets.get(id)
    if (ws?.onerror) ws.onerror(new Error(message))
  })

  bridge.addListener('websocket:close', (event: { payload?: string }) => {
    const { id, code, reason } = JSON.parse(event.payload ?? '{}')
    const ws = webSockets.get(id)
    if (ws?.onclose) ws.onclose({ code, reason })
    webSockets.delete(id)
  })

  const WebSocketPolyfill = class WebSocket {
    id: number
    url: string
    onopen: (() => void) | null = null
    onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null
    onerror: ((e: Error) => void) | null = null
    onclose: ((ev: { code: number; reason: string }) => void) | null = null

    constructor(url: string) {
      this.id = nextId++
      this.url = url
      webSockets.set(this.id, this)
      mod!.connect(url, this.id)
    }

    send(data: string | ArrayBuffer) {
      if (typeof data === 'string') {
        mod!.send(this.id, data)
      } else {
        mod!.sendBinary(this.id, arrayBufferToBase64(data))
      }
    }

    close(code = 1000, reason = 'Normal closure') {
      mod!.close(this.id, code, reason)
    }
  }

  ;(globalThis as unknown as Record<string, unknown>).WebSocket = WebSocketPolyfill
}
