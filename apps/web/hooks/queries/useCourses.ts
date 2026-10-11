'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getOrgCourses, getCourseMetadata } from '@services/courses/courses'

export function useCourses(orgSlug: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.courses.list(orgSlug),
    queryFn: () => getOrgCourses(orgSlug, {}, accessToken),
    enabled: !!orgSlug,
    staleTime: 60_000,
  })
}

export function useCourseMeta(courseUuid: string, withUnpublishedActivities = false) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined
  const userScope = session?.data?.user?.user_uuid ?? 'anonymous'
  const cleanCourseUuid = courseUuid.replace('course_', '')

  return useQuery({
    queryKey: withUnpublishedActivities
      ? queryKeys.courses.metaWithUnpublished(cleanCourseUuid, userScope)
      : queryKeys.courses.meta(cleanCourseUuid),
    queryFn: () => getCourseMetadata(
      cleanCourseUuid,
      {},
      accessToken,
      withUnpublishedActivities
        ? { slim: true, withUnpublishedActivities: true }
        : { slim: true }
    ),
    enabled: !!courseUuid,
    staleTime: 60_000,
  })
}
