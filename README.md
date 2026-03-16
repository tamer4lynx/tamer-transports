# tamer-transports

Browser-compliant fetch, WebSocket, and EventSource (SSE) for Lynx with embedded native code.

## Installation

```bash
npm install tamer-transports
```

Add to your app's dependencies and run `t4l link`. **Required for HMR and WebSocket** in native Lynx apps.

## Usage

```ts
import { fetch, WebSocket, EventSource } from 'tamer-transports'

// Fetch (native implementation)
const res = await fetch('https://api.example.com/data')
const data = await res.json()

// WebSocket
const ws = new WebSocket('wss://echo.websocket.org')
ws.onopen = () => ws.send('hello')
ws.onmessage = (e) => console.log(e.data)

// EventSource (SSE)
const es = new EventSource('https://api.example.com/stream')
es.onmessage = (e) => console.log(e.data)
```

## API

| Export | Description |
|--------|-------------|
| `fetch` | Native fetch polyfill |
| `WebSocket` | Native WebSocket polyfill |
| `EventSource` | Native EventSource (SSE) polyfill |

These replace the default implementations when the host does not provide them, enabling HMR, WebSocket, and SSE in Lynx native apps.

## Platform

Uses **lynx.ext.json**. Run `t4l link` after adding to your app.
