'background only'

declare const NativeModules: {
  LynxFetchModule?: {
    request(url: string, optionsJson: string, callback: (resultJson: string) => void): void
    cancel?(requestId: number): void
  }
}

declare const lynx: { fetch?: typeof globalThis.fetch } | undefined

function ensureLynxFetchOnGlobal() {
  if (typeof globalThis.fetch === 'function') return
  const f = typeof lynx !== 'undefined' && lynx?.fetch
  if (typeof f === 'function') {
    ;(globalThis as unknown as Record<string, typeof globalThis.fetch>).fetch = f.bind(lynx) as typeof globalThis.fetch
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function bodyToPayload(body: BodyInit | null): Promise<{ body?: string; bodyBase64?: string }> {
  if (body == null) return {}
  if (typeof body === 'string') return { body }
  if (body instanceof ArrayBuffer) return { bodyBase64: arrayBufferToBase64(body) }
  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.byteLength)
    const view = body as Uint8Array
    for (let i = 0; i < view.length; i++) bytes[i] = view[i]
    return { bodyBase64: arrayBufferToBase64(bytes.buffer) }
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    const buf = await body.arrayBuffer()
    return { bodyBase64: arrayBufferToBase64(buf) }
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return { body: body.toString() }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return Promise.reject(new Error('FormData body not yet supported'))
  }
  return Promise.reject(new Error('Unsupported body type'))
}

function nativeFetchErrorToMessage(err: unknown): string {
  if (err == null) return 'Request failed'
  if (typeof err === 'string') return err || 'Request failed'
  if (typeof err === 'number' || typeof err === 'boolean') return String(err)
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>
    const m = o.message
    if (typeof m === 'string' && m) return m
    const s = o.localizedDescription
    if (typeof s === 'string' && s) return s
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

function toRejectError(e: unknown): Error {
  if (e instanceof Error) return e
  return new Error(nativeFetchErrorToMessage(e))
}

export function installFetchPolyfill() {
  const mod = NativeModules?.LynxFetchModule
  if (!mod || typeof mod.request !== 'function') {
    ensureLynxFetchOnGlobal()
    return
  }

  const request = mod.request.bind(mod)
  const cancel = typeof mod.cancel === 'function' ? mod.cancel.bind(mod) : undefined

  let nextRequestId = 1

  function shouldStream(headersObj: Record<string, string>, opts: RequestInit): boolean {
    const streamFlag = (opts as RequestInit & { stream?: boolean }).stream === true
    if (streamFlag) return true
    const accept = Object.entries(headersObj).find(([k]) => k.toLowerCase() === 'accept')?.[1]
    return typeof accept === 'string' && accept.toLowerCase().includes('text/event-stream')
  }

  const nativeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const opts = init ?? {}
    const headers = opts.headers
    let headersObj: Record<string, string> = {}
    if (headers instanceof Headers) {
      headers.forEach((v, k) => { headersObj[k] = v })
    } else if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      headersObj = headers as Record<string, string>
    }

    const bodyPayload = await bodyToPayload(opts.body ?? null)
    const options = {
      method: opts.method ?? 'GET',
      headers: headersObj,
      ...bodyPayload,
    }
    const stream = shouldStream(headersObj, opts)

    return new Promise((resolve, reject) => {
      const requestId = nextRequestId++
      const onAbort = () => cancel?.(requestId)
      opts.signal?.addEventListener?.('abort', onAbort)
      const cleanup = () => opts.signal?.removeEventListener?.('abort', onAbort)

      if (!stream) {
        request(url, JSON.stringify(options), (resultJson: string) => {
          try {
            const result = JSON.parse(resultJson)
            if (result.error != null && result.error !== false && result.error !== '') {
              cleanup()
              reject(new Error(nativeFetchErrorToMessage(result.error)))
              return
            }
            const bodyInit = result.bodyBase64 != null
              ? base64ToArrayBuffer(result.bodyBase64)
              : (result.body ?? '')
            const res = new Response(bodyInit, {
              status: result.status,
              statusText: result.statusText,
              headers: result.headers ?? {},
            })
            cleanup()
            resolve(res)
          } catch (e) {
            cleanup()
            reject(toRejectError(e))
          }
        })
        return
      }

      let controller: ReadableStreamDefaultController<Uint8Array> | null = null
      let settled = false
      const bodyStream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          controller = ctrl
        },
        cancel() {
          cancel?.(requestId)
          cleanup()
        },
      })

      const streamOptions = {
        ...options,
        stream: true,
        requestId,
      }

      request(url, JSON.stringify(streamOptions), (resultJson: string) => {
        try {
          const result = JSON.parse(resultJson)
          if (result.error != null && result.error !== false && result.error !== '') {
            cleanup()
            const msg = nativeFetchErrorToMessage(result.error)
            if (!settled) {
              settled = true
              reject(new Error(msg))
            } else {
              controller?.error(new Error(msg))
            }
            return
          }

          switch (result.event) {
            case 'headers': {
              if (settled) return
              settled = true
              const res = new Response(bodyStream, {
                status: result.status,
                statusText: result.statusText,
                headers: result.headers ?? {},
              })
              resolve(res)
              return
            }
            case 'chunk': {
              if (result.dataBase64 != null) {
                controller?.enqueue(new Uint8Array(base64ToArrayBuffer(result.dataBase64)))
              } else if (typeof result.data === 'string') {
                const bytes = new Uint8Array(result.data.length)
                for (let i = 0; i < result.data.length; i++) bytes[i] = result.data.charCodeAt(i)
                controller?.enqueue(bytes)
              }
              return
            }
            case 'end': {
              cleanup()
              controller?.close()
              return
            }
            case 'error': {
              cleanup()
              const error = new Error(result.message ?? 'Streaming request failed')
              if (!settled) {
                settled = true
                reject(error)
              } else {
                controller?.error(error)
              }
              return
            }
          }
        } catch (e) {
          cleanup()
          reject(toRejectError(e))
        }
      })
    })
  }

  ;(globalThis as unknown as Record<string, unknown>).fetch = nativeFetch
}
