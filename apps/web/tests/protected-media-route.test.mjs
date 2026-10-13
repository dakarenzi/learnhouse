import { afterEach, describe, expect, mock, test } from 'bun:test'

let accessCookie
mock.module('next/headers', () => ({
  cookies: async () => ({ get: name => name === 'LH_access' && accessCookie ? { value: accessCookie } : undefined }),
}))
const { GET, HEAD } = await import('../app/api/protected-media/[...path]/route.ts')
const originalFetch = globalThis.fetch
const originalBackend = process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL
afterEach(() => {
  accessCookie = undefined
  globalThis.fetch = originalFetch
  if (originalBackend === undefined) delete process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL
  else process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL = originalBackend
})

const id = '12345678-1234-1234-1234-123456789abc'
const path = ['content', 'orgs', `org_${id}`, 'courses', `course_${id}`, 'activities', `activity_${id}`, 'video', 'file.mp4']
const context = () => ({ params: Promise.resolve({ path }) })
const request = method => new Request('http://app.lvh.me:13136/api/protected-media/' + path.join('/'), { method, headers: { Authorization: 'Bearer untrusted-client' } })

describe('Next route HTTP-only cookie integration', () => {
  for (const [cookie, status] of [[undefined, 401], ['fixture-author', 200], ['fixture-revoked', 401]]) {
    test(`GET delegates ${cookie || 'anonymous'} identity to configured API`, async () => {
      accessCookie = cookie
      process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL = 'http://api.lvh.me:18136'
      globalThis.fetch = async (url, options) => {
        expect(url).toBe('http://api.lvh.me:18136/' + path.join('/'))
        expect(options.headers.get('authorization')).toBe(cookie ? `Bearer ${cookie}` : null)
        expect(options.headers.get('cookie')).toBeNull()
        return new Response('bytes', { status, headers: { 'content-type': 'video/mp4' } })
      }
      expect((await GET(request('GET'), context())).status).toBe(status)
    })
  }
  test('HEAD is exported and forwards the same session without a response body', async () => {
    accessCookie = 'fixture-author'
    globalThis.fetch = async (_url, options) => {
      expect(options.method).toBe('HEAD')
      expect(options.headers.get('authorization')).toBe('Bearer fixture-author')
      return new Response(null, { headers: { 'content-type': 'video/mp4', 'content-length': '123' } })
    }
    const response = await HEAD(request('HEAD'), context())
    expect(response.body).toBeNull()
    expect(response.headers.get('content-length')).toBe('123')
  })
})
