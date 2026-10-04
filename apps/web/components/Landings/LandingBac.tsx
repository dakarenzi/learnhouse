'use client'

import React, { useMemo } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTrail } from '@/hooks/queries/useTrail'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import NewCourseButton from '@components/Objects/StyledElements/Buttons/NewCourseButton'
import { BAC_DEADLINES, BAC_SESSION_LABEL } from '@/lib/bac/calendar'

interface LandingBacProps {
  courses: any[]
  orgslug: string
  org_id: number
}

type CourseProgress = {
  done: number
  total: number | null
  pct: number | null
}

/** Progress of one trail run: completed steps, and a percentage when the
 *  course payload carries its chapters (otherwise we only know the count). */
function runProgress(run: any): CourseProgress {
  const done = run?.steps?.length ?? 0
  const chapters = run?.course?.chapters
  if (!Array.isArray(chapters)) return { done, total: null, pct: null }
  const total = chapters.reduce(
    (n: number, c: any) => n + (c?.activities?.length ?? 0),
    0,
  )
  return { done, total, pct: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null }
}

function ProgressBar({ pct, tone = 'light' }: { pct: number; tone?: 'light' | 'dark' }) {
  const track = tone === 'light' ? 'bg-white/30' : 'bg-black/10'
  const fill = tone === 'light' ? 'bg-white' : 'bg-bac'
  return (
    <div
      className={`h-1.5 w-full rounded-full ${track}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-1.5 rounded-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function LandingBac({ courses, orgslug, org_id }: LandingBacProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const isAuthenticated = session?.status === 'authenticated'
  const user = session?.data?.user
  const firstName: string = user?.first_name || user?.username || ''

  const { data: trail } = useTrail(isAuthenticated ? org_id : undefined)

  const progressByCourse = useMemo(() => {
    const map = new Map<string, CourseProgress>()
    ;(trail?.runs ?? []).forEach((run: any) => {
      const uuid = run?.course?.course_uuid
      if (uuid) map.set(removeCoursePrefix(uuid), runProgress(run))
    })
    return map
  }, [trail])

  // "Reprendre": the first started course that is not finished, else any started course.
  const resume = useMemo(() => {
    const runs: any[] = trail?.runs ?? []
    const unfinished = runs.find((r) => {
      const p = runProgress(r)
      return p.pct === null || p.pct < 100
    })
    return unfinished ?? runs[0] ?? null
  }, [trail])

  const courseHref = (uuid: string) =>
    getUriWithOrg(orgslug, `/course/${removeCoursePrefix(uuid)}`)

  const resumeProgress = resume ? runProgress(resume) : null

  return (
    <div className="w-full">
      <div className="mx-auto flex max-w-(--breakpoint-2xl) flex-col gap-10 px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {t('bac.eyebrow', { session: BAC_SESSION_LABEL })}
            </span>
            <h1 className="font-display text-5xl leading-none tracking-tight sm:text-6xl">
              {isAuthenticated && firstName
                ? t('bac.greeting', { name: firstName })
                : t('bac.greeting_anon')}
            </h1>
          </div>
          <AuthenticatedClientElement
            ressourceType="courses"
            action="create"
            checkMethod="roles"
            orgId={org_id}
          >
            <Link href={getUriWithOrg(orgslug, '/courses?new=true')}>
              <NewCourseButton />
            </Link>
          </AuthenticatedClientElement>
        </header>

        {/* Hero row */}
        <section className="flex flex-wrap gap-5">
          <div className="flex min-h-[260px] min-w-0 flex-[2_1_440px] flex-col justify-between gap-10 rounded-[28px] bg-bac p-8 text-white sm:p-9">
            {resume ? (
              <>
                <div className="flex flex-col gap-3">
                  <span className="text-xs font-medium uppercase tracking-[0.08em] opacity-85">
                    {t('bac.resume')}
                  </span>
                  <h2 className="font-display text-4xl leading-[1.05] sm:text-5xl">
                    {resume.course?.name}
                  </h2>
                  {resumeProgress && (
                    <span className="text-sm opacity-90">
                      {t('bac.lessons_done', { count: resumeProgress.done })}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-5">
                  <div className="flex min-w-[200px] flex-1 flex-col gap-2">
                    {resumeProgress?.pct != null && (
                      <>
                        <ProgressBar pct={resumeProgress.pct} />
                        <span className="text-xs opacity-90">
                          {t('bac.percent_of_course', { pct: resumeProgress.pct })}
                        </span>
                      </>
                    )}
                  </div>
                  <Link
                    href={courseHref(resume.course.course_uuid)}
                    className="inline-flex min-h-12 items-center gap-2.5 rounded-full bg-white px-6 text-sm font-semibold text-bac-ink transition-opacity hover:opacity-90"
                  >
                    {t('bac.continue')}
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <span className="text-xs font-medium uppercase tracking-[0.08em] opacity-85">
                  {t('bac.resume')}
                </span>
                <h2 className="font-display text-4xl leading-[1.05] sm:text-5xl">
                  {t('bac.empty_hero_title')}
                </h2>
                <span className="max-w-md text-sm opacity-90">
                  {t('bac.empty_hero_text')}
                </span>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-[1_1_280px] flex-col justify-between gap-6 rounded-[28px] border border-bac-line bg-white p-7 sm:p-8">
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {t('bac.calendar_title')}
              </span>
              <span className="font-display text-3xl leading-tight sm:text-4xl">
                {t('bac.deadlines.specialty_tests')}
              </span>
              <span className="text-sm text-muted-foreground">
                {t('bac.calendar_text')}
              </span>
            </div>
            <ul className="flex flex-col">
              {BAC_DEADLINES.map((d) => (
                <li
                  key={d.key}
                  className="flex items-center justify-between gap-3 border-t border-bac-line py-2.5 text-sm"
                >
                  <span>{t(`bac.deadlines.${d.key}`)}</span>
                  <span className="text-muted-foreground">{t(d.periodKey)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Subjects = the org's courses */}
        <section className="flex flex-col gap-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-3xl tracking-tight">{t('bac.subjects')}</h2>
            {courses.length > 0 && (
              <Link
                href={getUriWithOrg(orgslug, '/courses')}
                className="text-sm font-medium text-bac hover:underline"
              >
                {t('bac.see_all')}
              </Link>
            )}
          </div>

          {courses.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-bac-line bg-white/60 px-6 py-12 text-center">
              <p className="font-display text-2xl">
                {isAuthenticated ? t('courses.no_courses') : t('bac.sign_in_title')}
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                {isAuthenticated ? t('courses.create_courses_placeholder') : t('bac.sign_in_text')}
              </p>
              {!isAuthenticated && (
                <Link
                  href={getUriWithOrg(orgslug, '/login')}
                  className="mt-5 inline-flex min-h-11 items-center rounded-full bg-bac-ink px-6 text-sm font-semibold text-white hover:opacity-90"
                >
                  {t('auth.sign_in', 'Se connecter')}
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {courses.slice(0, 12).map((course: any) => {
                const p = progressByCourse.get(removeCoursePrefix(course.course_uuid))
                return (
                  <Link
                    key={course.course_uuid}
                    href={courseHref(course.course_uuid)}
                    className="group flex min-w-0 flex-col justify-between gap-6 rounded-[22px] border border-bac-line bg-white p-6 transition-shadow hover:shadow-md"
                  >
                    <div className="flex flex-col gap-1.5">
                      <span className="text-lg font-semibold tracking-tight">
                        {course.name}
                      </span>
                      {course.description && (
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {course.description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3.5">
                      {p?.pct != null ? (
                        <>
                          <div className="flex-1">
                            <ProgressBar pct={p.pct} tone="dark" />
                          </div>
                          <span className="text-xs font-medium tabular-nums">{p.pct} %</span>
                        </>
                      ) : p ? (
                        <span className="text-xs font-medium text-muted-foreground">
                          {t('bac.lessons_done', { count: p.done })}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-bac">
                          {t('bac.start')}
                          <ArrowRight
                            size={14}
                            aria-hidden="true"
                            className="transition-transform group-hover:translate-x-0.5"
                          />
                        </span>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
