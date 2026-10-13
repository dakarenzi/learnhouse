import { cookies } from 'next/headers'
import { ACCESS_TOKEN_COOKIE } from '@services/auth/cookies'
import { getBackendUrl } from '@services/config/config'
import { proxyProtectedMedia } from '@services/media/protectedMediaProxy'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

async function serve(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const cookieStore = await cookies()
  // Use the same HTTP-only access cookie as getServerAccessToken. Never rotate
  // the refresh token here: concurrent media loads must not consume it.
  return proxyProtectedMedia(request, path, cookieStore.get(ACCESS_TOKEN_COOKIE)?.value, getBackendUrl())
}

export const GET = serve
export const HEAD = serve
