import { afterEach, describe, expect, mock, test } from 'bun:test'
import { protectedMediaPath, proxyProtectedMedia } from '../services/media/protectedMediaProxy.ts'
import * as media from '../services/media/media.ts'

const id = '12345678-1234-1234-1234-123456789abc'
const org = `org_${id}`, course = `course_${id}`, activity = `activity_${id}`, block = `block_${id}`
const parts = ['content', 'orgs', org, 'courses', course, 'activities', activity, 'dynamic', 'blocks', 'imageBlock', block, 'diagram.jpeg']
const base = 'http://api.lvh.me:18136'
const req = (method = 'GET', headers = {}, suffix = '') => new Request(`http://app.lvh.me:13136/api/protected-media/${parts.join('/')}${suffix}`, { method, headers })
const proxy = (request, token, upstream, path = parts, backend = base) => proxyProtectedMedia(request, path, token, backend, upstream)
const privateResponse = response => {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('set-cookie')).toBeNull()
}

// A mock of the existing API guard, not an implementation of course policy.
// Checks that the proxy neither overrides denials nor makes its own grants.
const policy = publicCourse => async (_url, options) => {
  const token = options.headers.get('authorization')
  const status = ['Bearer fixture-admin', 'Bearer fixture-author'].includes(token) || (!token && publicCourse)
    ? 200 : token === 'Bearer fixture-learner' ? 403 : 401
  return new Response(status === 200 ? 'image-bytes' : 'sensitive upstream error', { status, headers: { 'content-type': 'image/jpeg' } })
}

describe('API authentication and authorization remain authoritative', () => {
  for (const [identity, status] of [[undefined, 401], ['admin', 200], ['author', 200], ['learner', 403], ['expired', 401], ['revoked', 401]]) {
    test(`${identity || 'anonymous'} receives ${status} for private unpublished media`, async () => {
      const response = await proxy(req(), identity && `fixture-${identity}`, policy(false))
      expect(response.status).toBe(status)
      privateResponse(response)
      expect(await response.text()).toBe(status === 200 ? 'image-bytes' : 'Media request failed')
    })
  }
  test('anonymous public activity media remains readable', async () => {
    expect((await proxy(req(), undefined, policy(true))).status).toBe(200)
  })
  test('forwards only the session access credential and range headers', async () => {
    let called = false
    const response = await proxy(req('GET', { Authorization: 'Bearer attacker', Cookie: 'other=secret', Range: 'bytes=1-3', 'If-Range': 'etag' }), 'fixture-admin', async (url, options) => {
      called = true
      expect(url).toBe(base + '/' + parts.join('/'))
      expect(options.headers.get('authorization')).toBe('Bearer fixture-admin')
      expect(options.headers.get('cookie')).toBeNull()
      expect(options.headers.get('range')).toBe('bytes=1-3')
      expect(options.headers.get('if-range')).toBe('etag')
      expect(options.headers.get('accept-encoding')).toBe('identity')
      expect(options.cache).toBe('no-store')
      expect(options.redirect).toBe('manual')
      return new Response('abc', { status: 206, headers: { 'content-type': 'image/jpeg', 'content-length': '3', 'content-range': 'bytes 1-3/9', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=9999', 'set-cookie': 'bad=secret', 'x-debug': 'secret' } })
    })
    expect(called).toBe(true)
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 1-3/9')
    expect(response.headers.get('content-length')).toBe('3')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('x-debug')).toBeNull()
    privateResponse(response)
    expect(await response.text()).toBe('abc')
  })
})

describe('streaming and response safety', () => {
  test('returns a stream without consuming the upstream body', async () => {
    let finish
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('first')); finish = () => controller.close() } })
    const response = await proxy(req(), 'fixture-admin', async () => new Response(stream, { headers: { 'content-type': 'video/mp4' } }))
    expect(response.body).toBe(stream)
    expect(response.bodyUsed).toBe(false)
    finish()
    expect(await response.text()).toBe('first')
  })
  test('HEAD forwards HEAD and returns file headers without a body', async () => {
    const response = await proxy(req('HEAD'), 'fixture-admin', async (_url, options) => {
      expect(options.method).toBe('HEAD')
      return new Response(null, { headers: { 'content-type': 'application/pdf', 'content-length': '100' } })
    })
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-length')).toBe('100')
  })
  for (const status of [401, 403, 404, 416, 500, 503]) {
    test(`preserves API ${status} without upstream error content`, async () => {
      const response = await proxy(req(), 'fixture-admin', async () => new Response('fixture-admin secret', { status, headers: { 'content-range': 'bytes */9', 'set-cookie': 'secret' } }))
      expect(response.status).toBe(status)
      expect(await response.text()).toBe('Media request failed')
      if (status === 416) expect(response.headers.get('content-range')).toBe('bytes */9')
      privateResponse(response)
    })
  }
  test('HEAD errors retain the API status without a body', async () => {
    const response = await proxy(req('HEAD'), undefined, async () => new Response('not found', { status: 404 }))
    expect(response.status).toBe(404)
    expect(response.body).toBeNull()
    privateResponse(response)
  })
  test('error-body cancellation cannot replace an API authentication denial', async () => {
    const stream = new ReadableStream({ cancel() { throw new Error('network disconnected') } })
    const response = await proxy(req(), undefined, async () => new Response(stream, { status: 401 }))
    expect(response.status).toBe(401)
  })
  test('transport failures expose no error details', async () => {
    const response = await proxy(req(), 'fixture-admin', async () => { throw new Error('fixture-admin secret') })
    expect(response.status).toBe(502)
    expect(await response.text()).toBe('Media request failed')
  })
  test('decoded content does not retain compressed length or encoding', async () => {
    const response = await proxy(req(), undefined, async () => new Response('decoded', { headers: { 'content-type': 'image/png', 'content-encoding': 'gzip', 'content-length': '99' } }))
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
  })
  test('rejects compressed partial content rather than forwarding invalid ranges', async () => {
    const response = await proxy(req(), undefined, async () => new Response('decoded', { status: 206, headers: { 'content-encoding': 'gzip', 'content-range': 'bytes 0-1/99' } }))
    expect(response.status).toBe(502)
  })
  test('request cancellation reaches the upstream fetch', async () => {
    const request = req()
    await proxy(request, undefined, async (_url, options) => {
      expect(options.signal).toBe(request.signal)
      return new Response(null)
    })
  })
  test('stored HTML cannot execute on the app origin', async () => {
    const response = await proxy(req(), 'fixture-admin', async () => new Response('<script/>', { headers: { 'content-type': 'text/html', 'content-disposition': 'inline' } }))
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe('attachment')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
  })
  test('storage redirects are never followed with the session credential', async () => {
    const response = await proxy(req(), 'fixture-admin', async (_url, options) => {
      expect(options.redirect).toBe('manual')
      return new Response(null, { status: 302, headers: { location: 'https://storage.example/video?X-Amz-Signature=fixture' } })
    })
    expect(response.status).toBe(302)
    expect(response.body).toBeNull()
    privateResponse(response)
  })
  for (const location of ['http://evil.example/a', 'javascript:alert(1)', '//evil.example', 'https://user:password@evil.example', 'https://evil.example/?secret=fixture-admin']) {
    test(`rejects unsafe redirect ${location}`, async () => {
      expect((await proxy(req(), 'fixture-admin', async () => new Response(null, { status: 302, headers: { location } }))).status).toBe(502)
    })
  }
})

describe('bounded paths and destinations', () => {
  const neverFetch = mock(async () => new Response('unexpected upstream request'))
  afterEach(() => expect(neverFetch).not.toHaveBeenCalled())
  for (const bad of ['..', '.', '%2e%2e', '%252e%252e', '..\\secret', 'a/b', 'https://evil.example', '//evil.example', 'x?url=evil', 'x#fragment', 'x\u0000', '']) {
    test(`rejects unsafe segment ${JSON.stringify(bad)}`, async () => {
      const path = [...parts.slice(0, -1), bad]
      expect(protectedMediaPath(path)).toBeNull()
      expect((await proxy(req(), 'fixture-admin', neverFetch, path)).status).toBe(400)
    })
  }
  for (const path of [['https:', 'evil.example'], ['api', 'v1', 'users', 'session'], ['content', 'users', org, 'avatars', 'x'], ['content', 'orgs', org, 'courses', course, 'thumbnails', 'x'], ['api', 'v1', 'stream', 'audio', org, course, activity, 'x']]) {
    test(`rejects unrelated path ${path.join('/')}`, () => expect(protectedMediaPath(path)).toBeNull())
  }
  test('rejects query-string destinations', async () => {
    expect((await proxy(req('GET', {}, '?url=https://evil.example'), 'fixture-admin', neverFetch)).status).toBe(400)
  })
  for (const backend of ['https://user:password@api.example', 'file:///etc/passwd', 'https://api.example/?url=evil', 'https://api.example/#evil', 'https://api.example/unexpected']) {
    test(`rejects malformed upstream ${backend}`, async () => {
      expect((await proxy(req(), 'fixture-admin', neverFetch, parts, backend)).status).toBe(502)
    })
  }
  test('rejects mutation methods', async () => expect((await proxy(req('POST'), 'fixture-admin', neverFetch)).status).toBe(405))
})

describe('media consumers', () => {
  const sameOrigin = url => {
    expect(url.startsWith('/api/protected-media/')).toBe(true)
    expect(protectedMediaPath(url.replace('/api/protected-media/', '').split('/'))).not.toBeNull()
  }
  for (const type of ['imageBlock', 'pdfBlock', 'audioBlock', 'videoBlock']) {
    test(`${type} uses the course content proxy`, () => sameOrigin(media.getActivityBlockMediaDirectory(org, course, activity, block, 'file.jpeg', type)))
  }
  test('activity video and PDF files use the proxy', () => {
    for (const type of ['video', 'documentpdf']) sameOrigin(media.getActivityMediaDirectory(org, course, activity, 'file', type))
  })
  test('stream, HLS, captions and relative playlist children stay same-origin', () => {
    for (const url of [
      media.getActivityVideoStreamUrl(org, course, activity, 'video.mp4'),
      media.getActivityHlsMasterUrl(org, course, activity),
      media.getActivityHlsThumbnailsUrl(org, course, activity, 'sprite.jpg'),
      media.getActivityCaptionUrl(org, course, activity, 'fr'),
      media.getVideoBlockStreamUrl(org, course, activity, block, 'video.mp4'),
      media.getVideoBlockHlsMasterUrl(org, course, activity, block),
      media.getVideoBlockHlsThumbnailsUrl(org, course, activity, block, 'sprite.jpg'),
      media.getAudioBlockStreamUrl(org, course, activity, block, 'audio.mp3'),
    ]) sameOrigin(url)
    const master = new URL(media.getActivityHlsMasterUrl(org, course, activity), 'http://app.lvh.me:13136')
    sameOrigin(new URL('v720p/index.m3u8', master).pathname)
  })
  test('assignment files use the proxy and retain API policy checks', () => {
    sameOrigin(media.getTaskRefFileDir(org, course, activity, 'assignment', 'task', 'file.pdf'))
    sameOrigin(media.getAssignmentSolutionFileDir(org, course, activity, 'assignment', 'file.pdf'))
    sameOrigin(media.getTaskFileSubmissionDir(org, course, activity, 'assignment', 'task', 'file.pdf'))
  })
  test('public branding, thumbnails and avatars retain existing delivery', () => {
    for (const url of [media.getCourseThumbnailMediaDirectory(org, course, 'file.jpg'), media.getOrgLogoMediaDirectory(org, 'file.jpg'), media.getUserAvatarMediaDirectory('user', 'file.jpg')]) {
      expect(url).not.toContain('/api/protected-media/')
      expect(url).toContain('/content/')
    }
  })
})
