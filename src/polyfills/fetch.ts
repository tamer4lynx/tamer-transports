'background only'

declare const NativeModules: {
  LynxFetchModule?: {
    request(url: string, optionsJson: string, callback: (resultJson: string) => void): void
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

export function installFetchPolyfill() {
  const mod = NativeModules?.LynxFetchModule
  if (!mod) return

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

    return new Promise((resolve, reject) => {
      mod!.request(url, JSON.stringify(options), (resultJson: string) => {
        try {
          const result = JSON.parse(resultJson)
          if (result.error) {
            reject(new Error(result.error))
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
          resolve(res)
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  ;(globalThis as unknown as Record<string, unknown>).fetch = nativeFetch
}
