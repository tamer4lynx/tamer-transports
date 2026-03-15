'background only'

declare const TextCodecHelper: { decode(buffer: ArrayBuffer): string } | undefined

function decodeChunk(chunk: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(chunk)
  if (typeof TextCodecHelper !== 'undefined') {
    const buf = chunk.byteLength === chunk.buffer.byteLength
      ? chunk.buffer
      : chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
    return TextCodecHelper.decode(buf as ArrayBuffer)
  }
  return String.fromCharCode.apply(null, Array.from(chunk))
}

class EventTargetLike {
  private _listeners: Record<string, Array<(ev: { type: string; data?: string; lastEventId?: string }) => void>> = {}
  addEventListener(type: string, fn: (ev: { type: string; data?: string; lastEventId?: string }) => void) {
    (this._listeners[type] ??= []).push(fn)
  }
  removeEventListener(type: string, fn: (ev: unknown) => void) {
    const arr = this._listeners[type]
    if (arr) this._listeners[type] = arr.filter((f) => f !== fn)
  }
  dispatchEvent(ev: { type: string; data?: string; lastEventId?: string }) {
    (this._listeners[ev.type] ?? []).forEach((fn) => fn(ev))
    return true
  }
}

export class FetchEventSourcePolyfill extends EventTargetLike {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readonly url: string
  readonly withCredentials: boolean
  readyState: number = FetchEventSourcePolyfill.CONNECTING

  private _closed = false
  private _abortController: AbortController | null = null
  private _onopen: ((ev: Event) => void) | null = null
  private _onmessage: ((ev: MessageEvent) => void) | null = null
  private _onerror: ((ev: Event) => void) | null = null

  constructor(url: string, options?: EventSourceInit) {
    super()
    this.url = url
    this.withCredentials = options?.withCredentials ?? false
    this._connect()
  }

  private async _connect() {
    if (this._closed) return
    this._abortController = new AbortController()
    try {
      const res = await fetch(this.url, {
        headers: { Accept: 'text/event-stream' },
        signal: this._abortController.signal,
      })
      if (!res.ok || !res.body) {
        this._dispatchError()
        return
      }
      this.readyState = FetchEventSourcePolyfill.OPEN
      this._dispatch(this._makeEvent('open'))
      await this._readStream(res.body)
    } catch {
      if (!this._closed) this._dispatchError()
    } finally {
      this.readyState = FetchEventSourcePolyfill.CLOSED
    }
  }

  private async _readStream(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader()
    let buffer = ''
    let eventType = 'message'
    let data = ''
    let lastEventId = ''

    try {
      while (!this._closed) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decodeChunk(value)
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim()
          else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trim()
          else if (line.startsWith('id:')) lastEventId = line.slice(3).trim()
          else if (line === '' && data !== '') {
            this._dispatch(this._makeEvent(eventType, { data, lastEventId }))
            eventType = 'message'
            data = ''
          }
        }
      }
    } catch {
      if (!this._closed) this._dispatchError()
    }
  }

  private _dispatch(ev: { type: string; data?: string; lastEventId?: string }) {
    this.dispatchEvent(ev)
    if (ev.type === 'open' && this._onopen) this._onopen(ev as unknown as Event)
    else if (ev.type === 'message' && this._onmessage) this._onmessage(ev as unknown as MessageEvent)
    else if (ev.type === 'error' && this._onerror) this._onerror(ev as unknown as Event)
  }

  private _dispatchError() {
    this._dispatch({ type: 'error' })
  }

  private _makeEvent(type: string, init?: { data?: string; lastEventId?: string }) {
    return { type, ...init }
  }

  close() {
    this._closed = true
    this._abortController?.abort()
    this.readyState = FetchEventSourcePolyfill.CLOSED
  }

  get onopen() { return this._onopen }
  set onopen(fn: ((ev: Event) => void) | null) { this._onopen = fn }
  get onmessage() { return this._onmessage }
  set onmessage(fn: ((ev: MessageEvent) => void) | null) { this._onmessage = fn }
  get onerror() { return this._onerror }
  set onerror(fn: ((ev: Event) => void) | null) { this._onerror = fn }
}

export function installEventSourcePolyfill() {
  const g = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : ({} as Record<string, unknown>))
  if (typeof (g as Record<string, unknown>).EventSource !== 'undefined') return
  ;(g as Record<string, unknown>).EventSource = FetchEventSourcePolyfill
}
