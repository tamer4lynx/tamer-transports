import { installFetchPolyfill } from './polyfills/fetch'
import { installWebSocketPolyfill } from './polyfills/websocket'
import { installEventSourcePolyfill } from './polyfills/event-source'

installFetchPolyfill()
installWebSocketPolyfill()
installEventSourcePolyfill()

export const fetch = globalThis.fetch
export const WebSocket = globalThis.WebSocket
export const EventSource = globalThis.EventSource

