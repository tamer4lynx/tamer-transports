'background only'

declare const NativeModules: {
  LynxFetchModule?: {
    request(url: string, optionsJson: string, callback: (resultJson: string) => void): void
  }
}

export function installFetchPolyfill() {
  const mod = NativeModules?.LynxFetchModule
  if (!mod) return

  const nativeFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const opts = init ?? {}
    const headers = opts.headers
    let headersObj: Record<string, string> = {}
    if (headers instanceof Headers) {
      headers.forEach((v, k) => { headersObj[k] = v })
    } else if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      headersObj = headers as Record<string, string>
    }
    const options = {
      method: opts.method ?? 'GET',
      headers: headersObj,
      body: opts.body != null ? (typeof opts.body === 'string' ? opts.body : null) : null,
    }
    if (opts.body != null && typeof opts.body !== 'string') {
      return Promise.reject(new Error('Lynx fetch polyfill supports string body only'))
    }

    return new Promise((resolve, reject) => {
      mod!.request(url, JSON.stringify(options), (resultJson: string) => {
        try {
          const result = JSON.parse(resultJson)
          if (result.error) {
            reject(new Error(result.error))
            return
          }
          const res = new Response(result.body, {
            status: result.status,
            statusText: result.statusText,
            headers: result.headers,
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
