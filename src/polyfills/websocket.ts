'background only'

declare const lynx: { getJSModule(id: string): { addListener(e: string, fn: (ev: { payload?: string }) => void): void } }
declare const NativeModules: {
  /** Lynx engine built-in uses connect(url, protocols, options, id) — do not use for this polyfill. */
  TamerTransportsWebSocketModule?: {
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

type WebSocketInstance = {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null
  onerror: ((e: Error) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
}

const CONNECTING = 0
const OPEN = 1
const CLOSING = 2
const CLOSED = 3

const webSockets = new Map<number, WebSocketInstance>()
let nextId = 1

function tamerWebSocketModuleReady(
  mod: NonNullable<typeof NativeModules.TamerTransportsWebSocketModule>,
): boolean {
  return (
    typeof mod.connect === 'function' &&
    typeof mod.send === 'function' &&
    typeof mod.sendBinary === 'function' &&
    typeof mod.close === 'function'
  )
}

export function installWebSocketPolyfill() {
  function tryInstall() {
    const mod = NativeModules?.TamerTransportsWebSocketModule
    if (!mod || !tamerWebSocketModuleReady(mod)) return false

  let bridge: { addListener(e: string, fn: (ev: { payload?: string }) => void): void }
  try {
    bridge = lynx.getJSModule('GlobalEventEmitter')
  } catch {
    return false
  }

  const nativeConnect = mod.connect.bind(mod)
  const nativeSend = mod.send.bind(mod)
  const nativeSendBinary = mod.sendBinary.bind(mod)
  const nativeClose = mod.close.bind(mod)

  bridge.addListener('websocket:open', (event: { payload?: string }) => {
    const { id } = JSON.parse(event.payload ?? '{}')
    const ws = webSockets.get(id)
    if (ws) {
      ws.readyState = OPEN
      if (ws.onopen) ws.onopen()
    }
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
    if (ws) {
      ws.readyState = CLOSED
      if (ws.onerror) ws.onerror(new Error(message))
    }
    webSockets.delete(id)
  })

  bridge.addListener('websocket:close', (event: { payload?: string }) => {
    const { id, code, reason } = JSON.parse(event.payload ?? '{}')
    const ws = webSockets.get(id)
    if (ws) {
      ws.readyState = CLOSED
      if (ws.onclose) ws.onclose({ code, reason })
    }
    webSockets.delete(id)
  })

  const WebSocketPolyfill = class WebSocket {
    static readonly CONNECTING = CONNECTING
    static readonly OPEN = OPEN
    static readonly CLOSING = CLOSING
    static readonly CLOSED = CLOSED

    id: number
    url: string
    readyState: number = CONNECTING
    onopen: (() => void) | null = null
    onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null
    onerror: ((e: Error) => void) | null = null
    onclose: ((ev: { code: number; reason: string }) => void) | null = null

    constructor(url: string) {
      this.id = nextId++
      this.url = url
      webSockets.set(this.id, this)
      nativeConnect(url, this.id)
    }

    send(data: string | ArrayBuffer) {
      if (typeof data === 'string') {
        nativeSend(this.id, data)
      } else {
        nativeSendBinary(this.id, arrayBufferToBase64(data))
      }
    }

    close(code = 1000, reason = 'Normal closure') {
      if (this.readyState === CONNECTING || this.readyState === OPEN) {
        this.readyState = CLOSING
        nativeClose(this.id, code, reason)
      }
    }
  }

    ;(globalThis as unknown as Record<string, unknown>).WebSocket = WebSocketPolyfill
    return true
  }
  if (tryInstall()) return
  let attempts = 0
  const retry = () => {
    if (tryInstall() || ++attempts >= 10) return
    setTimeout(retry, 100)
  }
  setTimeout(retry, 0)
}
