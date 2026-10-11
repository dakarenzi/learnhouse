'use client'

import React, { useEffect, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { renderInlineMath } from './renderInlineMath'

function InlineMathComponent(props: any) {
  const math = String(props.node.attrs.math_equation ?? '')
  const sourceOpen = String(props.node.attrs.source_open ?? '\\(')
  const sourceClose = String(props.node.attrs.source_close ?? '\\)')
  const editorOptions = useEditorProvider() as any
  const isEditable = editorOptions?.isEditable === true
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(math)

  useEffect(() => {
    void import('katex/dist/katex.min.css')
  }, [])

  useEffect(() => {
    setDraft(math)
  }, [math])

  const renderedMath = renderInlineMath(math)
  const commit = () => {
    props.updateAttributes({ math_equation: draft })
    setIsEditing(false)
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
          maxLength={4096}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(math)
              setIsEditing(false)
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
        if (isEditable) setIsEditing(true)
      }}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (isEditable && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          setIsEditing(true)
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
        <code className="inline-math__fallback">
          {sourceOpen}
          {math}
          {sourceClose}
        </code>
      )}
    </NodeViewWrapper>
  )
}

export default InlineMathComponent
