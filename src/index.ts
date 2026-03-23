'background only';

import { installFetchPolyfill } from './polyfills/fetch'
import { installWebSocketPolyfill } from './polyfills/websocket'
import { installEventSourcePolyfill } from './polyfills/event-source'

installFetchPolyfill()
installWebSocketPolyfill()
installEventSourcePolyfill()

// Export values that read from globalThis after polyfills are installed
// We use getters to ensure we always read the current value from globalThis
function getFetchImpl() {
  return globalThis.fetch
}

function getWebSocketImpl() {
  return globalThis.WebSocket
}

function getEventSourceImpl() {
  return globalThis.EventSource
}

// Export wrapper functions/classes that delegate to globalThis at call/construction time
export function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const impl = getFetchImpl()
  if (!impl) {
    throw new Error('fetch is not available. Make sure @tamer4lynx/tamer-transports is properly linked and native modules are registered.')
  }
  return impl(input, init)
}

// Copy static properties from globalThis.fetch if available
if (globalThis.fetch) {
  try {
    Object.setPrototypeOf(fetch, globalThis.fetch)
    Object.getOwnPropertyNames(globalThis.fetch).forEach(name => {
      try {
        const desc = Object.getOwnPropertyDescriptor(globalThis.fetch, name)
        if (desc) Object.defineProperty(fetch, name, desc)
      } catch {}
    })
  } catch {}
}

let warnedWebSocketUnavailable = false
let warnedEventSourceUnavailable = false

class WebSocketUnavailable {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly url: string
  readyState = WebSocketUnavailable.CLOSED
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null
  onerror: ((e: Error) => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null

  constructor(url: string | URL) {
    this.url = typeof url === 'string' ? url : url.href
    if (!warnedWebSocketUnavailable) {
      warnedWebSocketUnavailable = true
      try {
        console.warn(
          '[tamer-transports] WebSocket is not available on this thread (e.g. main thread IFR). Use a background-only module for real connections.',
        )
      } catch {}
    }
  }

  send(_data: string | ArrayBuffer) {}

  close(_code = 1000, _reason = '') {}
}

class EventSourceUnavailable {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readonly url: string
  readyState = EventSourceUnavailable.CLOSED
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  constructor(url: string | URL, _eventSourceInitDict?: EventSourceInit) {
    this.url = typeof url === 'string' ? url : url.href
    if (!warnedEventSourceUnavailable) {
      warnedEventSourceUnavailable = true
      try {
        console.warn(
          '[tamer-transports] EventSource is not available on this thread. Use a background-only module or lynx.EventSource when supported.',
        )
      } catch {}
    }
  }

  close() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return false
  }
}

function createWebSocketExport(): typeof globalThis.WebSocket {
  function WebSocket(
    this: unknown,
    url: string | URL,
    protocols?: string | string[],
  ): InstanceType<typeof globalThis.WebSocket> {
    let Impl = getWebSocketImpl() as typeof globalThis.WebSocket | undefined
    if ((Impl as unknown) === (WebSocket as unknown)) Impl = undefined
    if (!Impl) {
      return new WebSocketUnavailable(url) as unknown as InstanceType<typeof globalThis.WebSocket>
    }
    return new Impl(url as string, protocols as string | string[] | undefined)
  }
  WebSocket.CONNECTING = 0
  WebSocket.OPEN = 1
  WebSocket.CLOSING = 2
  WebSocket.CLOSED = 3
  return WebSocket as unknown as typeof globalThis.WebSocket
}

function createEventSourceExport(): typeof globalThis.EventSource {
  function EventSource(
    this: unknown,
    url: string | URL,
    eventSourceInitDict?: EventSourceInit,
  ): InstanceType<typeof globalThis.EventSource> {
    let Impl = getEventSourceImpl() as typeof globalThis.EventSource | undefined
    if ((Impl as unknown) === (EventSource as unknown)) Impl = undefined
    if (!Impl) {
      return new EventSourceUnavailable(url, eventSourceInitDict) as unknown as InstanceType<
        typeof globalThis.EventSource
      >
    }
    return new Impl(url as string, eventSourceInitDict)
  }
  EventSource.CONNECTING = 0
  EventSource.OPEN = 1
  EventSource.CLOSED = 2
  return EventSource as unknown as typeof globalThis.EventSource
}

export const WebSocket = createWebSocketExport()
export const EventSource = createEventSourceExport()

// Side-effect: make these available globally when module is imported
if (typeof globalThis !== 'undefined') {
  if (!globalThis.fetch) {
    (globalThis as any).fetch = fetch
  }
  if (!globalThis.EventSource) {
    (globalThis as any).EventSource = EventSource
  }
  setTimeout(() => {
    if (!globalThis.WebSocket) {
      (globalThis as any).WebSocket = WebSocket
    }
  }, 1500)
}

