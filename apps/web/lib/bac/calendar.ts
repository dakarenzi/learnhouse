/**
 * Key dates of the French baccalauréat, shown on the student home.
 *
 * Dates are deliberately coarse (month-level): the official calendar is
 * published each year by the Ministère de l'Éducation nationale, so keep this
 * file in sync with the current session instead of hard-coding exact days.
 * Labels are i18n keys under `bac.deadlines.*`.
 */
export interface BacDeadline {
  key: 'specialty_tests' | 'mock_exam' | 'parcoursup_wishes' | 'philosophy' | 'grand_oral'
  /** i18n key for the human-readable period, e.g. "March 2027". */
  periodKey: string
}

export const BAC_SESSION_LABEL = '2027'

export const BAC_DEADLINES: BacDeadline[] = [
  { key: 'mock_exam', periodKey: 'bac.periods.december' },
  { key: 'parcoursup_wishes', periodKey: 'bac.periods.jan_mar' },
  { key: 'specialty_tests', periodKey: 'bac.periods.march' },
  { key: 'philosophy', periodKey: 'bac.periods.june' },
  { key: 'grand_oral', periodKey: 'bac.periods.june' },
]
