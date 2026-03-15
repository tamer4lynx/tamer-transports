import { installFetchPolyfill } from './polyfills/fetch'
import { installWebSocketPolyfill } from './polyfills/websocket'
import { installEventSourcePolyfill } from './polyfills/event-source'

installFetchPolyfill()
installWebSocketPolyfill()
installEventSourcePolyfill()

export { fetch, WebSocket, EventSource } from './index'
