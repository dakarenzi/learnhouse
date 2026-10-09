import { useEffect, useState } from 'react'
import { Editor } from '@tiptap/react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface TableOfContentsProps {
  editor: Editor | null
}

interface HeadingItem {
  level: number
  text: string
  id: string
}


const TableOfContents = ({ editor }: TableOfContentsProps) => {
  const { t } = useTranslation()
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [activeHeadingId, setActiveHeadingId] = useState('')

  useEffect(() => {
    if (!editor) return

    const updateHeadings = () => {
      const items: HeadingItem[] = []
      const headingElements = Array.from(
        editor.view.dom.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')
      )
      const usedIds = new Map<string, number>()
      let headingIndex = 0

      editor.state.doc.descendants((node) => {
        if (node.type.name === 'heading') {
          const level = node.attrs.level || 1
          const headingText = node.textContent || ''

          const slug = headingText
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '') // Remove special characters
            .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
            .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens

          const baseId = `heading-${slug || `section-${headingIndex + 1}`}`
          const occurrence = (usedIds.get(baseId) || 0) + 1
          usedIds.set(baseId, occurrence)
          const id = occurrence === 1 ? baseId : `${baseId}-${occurrence}`
          const headingElement = headingElements[headingIndex]

          if (headingElement) headingElement.id = id

          items.push({
            level,
            text: headingText,
            id,
          })
          headingIndex += 1
        }
      })
      setHeadings(items)
    }

    editor.on('update', updateHeadings)
    updateHeadings()

    return () => {
      editor.off('update', updateHeadings)
    }
  }, [editor])

  useEffect(() => {
    if (!editor || headings.length === 0) return

    let frameId = 0

    const updateActiveHeading = () => {
      frameId = 0
      const visibleHeadings = headings
        .map(({ id }) => ({ id, element: document.getElementById(id) }))
        .filter(({ element }) => element && editor.view.dom.contains(element) && element.getClientRects().length > 0)

      if (visibleHeadings.length === 0) return

      const activationLine = Math.min(240, Math.max(140, window.innerHeight * 0.35))
      let activeId = visibleHeadings[0].id
      for (const heading of visibleHeadings) {
        if (heading.element!.getBoundingClientRect().top > activationLine) break
        activeId = heading.id
      }

      setActiveHeadingId((currentId) => currentId === activeId ? currentId : activeId)
    }

    const scheduleActiveHeadingUpdate = () => {
      if (frameId) return
      frameId = window.requestAnimationFrame(updateActiveHeading)
    }

    window.addEventListener('scroll', scheduleActiveHeadingUpdate, { passive: true })
    window.addEventListener('resize', scheduleActiveHeadingUpdate)
    // The reader can reveal a Details ancestor on a TOC click. Recompute after
    // the click's synchronous toggle and native anchor navigation have settled.
    document.addEventListener('click', scheduleActiveHeadingUpdate, true)
    scheduleActiveHeadingUpdate()

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      window.removeEventListener('scroll', scheduleActiveHeadingUpdate)
      window.removeEventListener('resize', scheduleActiveHeadingUpdate)
      document.removeEventListener('click', scheduleActiveHeadingUpdate, true)
    }
  }, [editor, headings])

  if (headings.length === 0) return null

  return (
    <div className="lesson-toc w-full bg-none border-none shadow-none p-0 m-0 font-[inherit] flex flex-col items-stretch h-fit">
      <nav aria-label={t('courses.table_of_contents', 'Table of contents')}>
        <p className="lesson-toc__title">{t('courses.table_of_contents', 'Table of contents')}</p>
        <ul className="!list-none !p-0 m-0">
          {headings.map((heading, index) => (
            <li
              key={`${heading.id}-${index}`}
              className="toc-item my-2 !list-none flex items-start gap-2"
              style={{ paddingInlineStart: `${(heading.level - 1) * 1.2}rem` }}
            >
              <span className="toc-check" aria-hidden="true"><Check size={15} strokeWidth={1.7} /></span>
              <a
                className={`toc-link toc-link-h${heading.level}`}
                data-testid="lesson-toc-link"
                aria-current={activeHeadingId === heading.id ? 'location' : undefined}
                href={`#${heading.id}`}
                onClick={() => revealCollapsedAncestors(editor, heading.id)}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

function revealCollapsedAncestors(editor: Editor | null, headingId: string) {
  if (!editor) return

  const headings = editor.view.dom.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')
  const heading = Array.from(headings).find((element) => element.id === headingId)
  if (!heading) return

  const detailsAncestors: HTMLElement[] = []
  let ancestor = heading.parentElement

  while (ancestor && editor.view.dom.contains(ancestor)) {
    if (ancestor.dataset.type === 'details') detailsAncestors.push(ancestor)
    ancestor = ancestor.parentElement
  }

  // Open outer disclosures first so nested disclosure controls become visible
  // before they are activated.
  for (const details of detailsAncestors.reverse()) {
    if (details.classList.contains('is-open')) continue
    details.querySelector<HTMLButtonElement>(':scope > button[data-details-toggle]')?.click()
  }
}

export default TableOfContents
