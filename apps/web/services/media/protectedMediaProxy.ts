// Only course activity bytes and their streaming endpoints belong to this proxy.
// Authentication is verified by the API, including for anonymous public readers.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const resource = (prefix: string) => new RegExp(`^${prefix}_${UUID}$`, 'i')

export function protectedMediaPath(parts: string[]): string | null {
  if (!parts.length || parts.some(p => !p || p === '.' || p === '..' || /[%\\/?#:]/.test(p) ||
      Array.from(p).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) return null
  if (parts[0] === 'content') {
    if (parts[1] !== 'orgs' || !resource('org').test(parts[2] || '') ||
        parts[3] !== 'courses' || !resource('course').test(parts[4] || '') ||
        parts[5] !== 'activities' || !resource('activity').test(parts[6] || '') || parts.length < 8) return null
  } else {
    if (parts.slice(0, 3).join('/') !== 'api/v1/stream') return null
    const audio = parts[3] === 'block' && parts[4] === 'audio'
    if (!['video', 'hls', 'captions', 'block', 'block-hls'].includes(parts[3])) return null
    const start = audio ? 5 : 4
    if (!resource('org').test(parts[start] || '') || !resource('course').test(parts[start + 1] || '') ||
        !resource('activity').test(parts[start + 2] || '')) return null
    const block = parts[3] === 'block' || parts[3] === 'block-hls'
    if (block && !resource('block').test(parts[start + 3] || '')) return null
    if (parts.length < start + (block ? 5 : 4)) return null
  }
  return '/' + parts.map(encodeURIComponent).join('/')
}

const privateHeaders = () => new Headers({
  'Cache-Control': 'private, no-store',
  'Vary': 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "sandbox; default-src 'none'",
})

function failure(status: number, head: boolean): Response {
  const headers = privateHeaders()
  headers.set('Content-Type', 'text/plain; charset=utf-8')
  return new Response(head ? null : 'Media request failed', { status, headers })
}

/** No client headers, refresh tokens, query strings or destinations are relayed. */
export async function proxyProtectedMedia(
  request: Request,
  parts: string[],
  accessToken: string | undefined,
  backendBase: string,
  fetchUpstream: typeof fetch = fetch,
): Promise<Response> {
  const head = request.method === 'HEAD'
  if (request.method !== 'GET' && !head) return failure(405, head)
  const path = protectedMediaPath(parts)
  if (!path || new URL(request.url).search) return failure(400, head)

  try {
    const upstream = new URL(backendBase)
    if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password ||
        upstream.search || upstream.hash || !['', '/'].includes(upstream.pathname)) return failure(502, head)
    const headers = new Headers({ 'Accept-Encoding': 'identity' })
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    for (const name of ['range', 'if-range']) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    const response = await fetchUpstream(upstream.origin + path, {
      method: request.method, headers, cache: 'no-store', redirect: 'manual', signal: request.signal,
    })
    const outgoing = privateHeaders()

    // S3 video endpoints redirect after authorization. Never follow the redirect
    // server-side with the session credential. The browser fetches storage using
    // the API's existing presigned URL, without our HTTP-only cookie/header.
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined)
      const location = response.headers.get('location') || ''
      const target = new URL(location)
      if (target.protocol !== 'https:' || target.username || target.password ||
          (accessToken && (location.includes(accessToken) || location.includes(encodeURIComponent(accessToken))))) return failure(502, head)
      outgoing.set('Location', target.href)
      return new Response(null, { status: response.status, headers: outgoing })
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      const result = failure(response.status >= 400 ? response.status : 502, head)
      // Needed for an unsatisfiable byte range; don't relay upstream error bodies.
      const range = response.headers.get('content-range')
      if (response.status === 416 && range) result.headers.set('Content-Range', range)
      return result
    }
    const encoded = response.headers.get('content-encoding')
    if (response.status === 206 && encoded && encoded !== 'identity') {
      await response.body?.cancel().catch(() => undefined)
      return failure(502, head) // Decoding would invalidate the byte-range headers.
    }
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition']) {
      const value = response.headers.get(name)
      if (value && !(name === 'content-length' && encoded && encoded !== 'identity')) outgoing.set(name, value)
    }
    // Never execute a stored HTML/SVG document on the authenticated app origin.
    const mime = (outgoing.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const inline = /^(image\/(png|jpeg|gif|webp|avif|bmp)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/pdf|text\/vtt|application\/(vnd.apple.mpegurl|x-mpegurl)|audio\/mpegurl)$/.test(mime)
    if (!inline) {
      outgoing.set('Content-Type', 'application/octet-stream')
      outgoing.set('Content-Disposition', 'attachment')
    }
    if (head) await response.body?.cancel().catch(() => undefined)
    return new Response(head ? null : response.body, { status: response.status, headers: outgoing })
  } catch {
    // Transport errors may contain URLs/credentials: expose neither body nor log.
    return failure(502, head)
  }
}
