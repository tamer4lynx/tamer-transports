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

// Export classes that read from globalThis at construction time
// This ensures the polyfills are available even if they install asynchronously
export const WebSocket: typeof globalThis.WebSocket = (() => {
  const Impl = getWebSocketImpl()
  if (Impl) return Impl
  
  // Return a stub class if WebSocket is not available
  class WebSocketStub {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    
    constructor(url: string) {
      throw new Error('WebSocket is not available. Make sure @tamer4lynx/tamer-transports is properly linked and native modules are registered.')
    }
  }
  return WebSocketStub as unknown as typeof globalThis.WebSocket
})()

export const EventSource: typeof globalThis.EventSource = (() => {
  const Impl = getEventSourceImpl()
  if (Impl) return Impl
  
  // Return a stub class if EventSource is not available
  class EventSourceStub {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSED = 2
    
    constructor(url: string, eventSourceInitDict?: EventSourceInit) {
      throw new Error('EventSource is not available. Make sure @tamer4lynx/tamer-transports is properly linked.')
    }
  }
  return EventSourceStub as unknown as typeof globalThis.EventSource
})()

// Side-effect: make these available globally when module is imported
if (typeof globalThis !== 'undefined') {
  if (!globalThis.fetch) {
    (globalThis as any).fetch = fetch
  }
  if (!globalThis.WebSocket) {
    (globalThis as any).WebSocket = WebSocket
  }
  if (!globalThis.EventSource) {
    (globalThis as any).EventSource = EventSource
  }
}

