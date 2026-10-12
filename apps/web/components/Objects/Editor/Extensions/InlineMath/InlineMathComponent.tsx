'use client'

import React, { useEffect, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { renderInlineMath } from './renderInlineMath'

export function EscapedInlineMathFallback({
  math,
  sourceOpen,
  sourceClose,
}: {
  math: string
  sourceOpen: string
  sourceClose: string
}) {
  return (
    <code className="inline-math__fallback">
      {sourceOpen}
      {math}
      {sourceClose}
    </code>
  )
}

function InlineMathComponent(props: any) {
  const math = String(props.node.attrs.math_equation ?? '')
  const sourceOpen = String(props.node.attrs.source_open ?? '\\(')
  const sourceClose = String(props.node.attrs.source_close ?? '\\)')
  const editorOptions = useEditorProvider() as any
  const isEditable = editorOptions?.isEditable === true
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(math)
  const editSessionActive = React.useRef(false)

  useEffect(() => {
    void import('katex/dist/katex.min.css')
  }, [])

  useEffect(() => {
    setDraft(math)
  }, [math])

  const renderedMath = renderInlineMath(math)
  const finishEdit = (save: boolean) => {
    // Enter commits and unmounts the input, which also fires blur. Track the
    // edit session so that blur cannot commit twice or undo an Escape cancel.
    if (!editSessionActive.current) return
    editSessionActive.current = false
    if (save) {
      props.updateAttributes({ math_equation: draft })
    } else {
      setDraft(math)
    }
    setIsEditing(false)
  }

  const beginEdit = () => {
    editSessionActive.current = true
    setDraft(math)
    setIsEditing(true)
  }

  if (isEditable && isEditing) {
    return (
      <NodeViewWrapper
        as="span"
        className="inline-math inline-math--editing"
        contentEditable={false}
        dir="ltr"
      >
        <input
          autoFocus
          aria-label="Inline formula TeX source"
          className="inline-math__input"
          dir="ltr"
          onBlur={() => finishEdit(true)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              finishEdit(true)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              finishEdit(false)
            }
          }}
          size={Math.max(8, Math.min(48, draft.length || 8))}
          value={draft}
        />
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      as="span"
      className="inline-math"
      contentEditable={false}
      dir="ltr"
      onClick={() => {
        if (isEditable) beginEdit()
      }}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (isEditable && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          beginEdit()
        }
      }}
      role={isEditable ? 'button' : undefined}
      tabIndex={isEditable ? 0 : undefined}
      title={isEditable ? 'Select to edit this formula' : undefined}
    >
      {renderedMath ? (
        <span
          className="inline-math__rendered"
          dangerouslySetInnerHTML={{ __html: renderedMath }}
        />
      ) : (
        <EscapedInlineMathFallback
          math={math}
          sourceOpen={sourceOpen}
          sourceClose={sourceClose}
        />
      )}
    </NodeViewWrapper>
  )
}

export default InlineMathComponent
