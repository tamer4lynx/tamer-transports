# tamer-transports

Browser-compliant fetch, WebSocket, and EventSource (SSE) for Lynx with embedded native code.

## Installation

```bash
npm install @tamer4lynx/tamer-transports
```

Add to your app's dependencies and run `t4l link`. **Required for HMR and WebSocket** in native Lynx apps.

## Usage

```ts
import { fetch, WebSocket, EventSource } from '@tamer4lynx/tamer-transports'

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
| `fetch` | Polyfill that attempts to meet the browser-standard fetch API (Lynx’s stock fetch does not) |
| `WebSocket` | Polyfill that attempts to meet the browser-standard WebSocket API |
| `EventSource` | Polyfill that attempts to meet the browser-standard EventSource API |

These replace the default implementations when the host does not provide them, enabling HMR, WebSocket, and SSE in Lynx native apps. **Not fully tested** — report issues on GitHub.

## Lynx: background thread

`fetch`, `WebSocket`, and `EventSource` must run on the **background** thread. Use them from `useEffect`, handlers, or other background-only paths. When you need an explicit directive (e.g. state updates after `fetch` in a custom hook), put **`'background only'`** as the first line of that function.

### ReactLynx: WebSocket + state

```tsx
import { useEffect, useState } from '@lynx-js/react';
import { WebSocket } from '@tamer4lynx/tamer-transports';

export function App() {
  const [text, setText] = useState('Hello');

  useEffect(() => {
    'background only';
    let released = false;
    const ws = new WebSocket('wss://example.com/socket');

    ws.onmessage = (event) => {
      if (released) return;
      setText(String(event.data));
    };

    return () => {
      released = true;
      ws.onmessage = null;
      try {
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'cleanup');
        }
      } catch {
        /* ignore */
      }
    };
  }, []);

  return (
    <view>
      <text>{text}</text>
    </view>
  );
}
```

## Platform

Uses **lynx.ext.json**. Run `t4l link` after adding to your app.
