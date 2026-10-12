import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'

const InlineMathComponent = dynamic(() => import('./InlineMathComponent'), {
  ssr: false,
})

function hasValidDelimiters(sourceOpen: unknown, sourceClose: unknown): boolean {
  return (
    (sourceOpen === '\\(' && sourceClose === '\\)') ||
    (sourceOpen === '$' && sourceClose === '$')
  )
}

export default Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  marks: '_',

  addAttributes() {
    return {
      math_equation: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-math-equation') ?? '',
        renderHTML: (attributes) => ({
          'data-math-equation': attributes.math_equation,
        }),
      },
      source_open: {
        default: '\\(',
        parseHTML: (element) => element.getAttribute('data-source-open') ?? '\\(',
        renderHTML: (attributes) => ({ 'data-source-open': attributes.source_open }),
      },
      source_close: {
        default: '\\)',
        parseHTML: (element) => element.getAttribute('data-source-close') ?? '\\)',
        renderHTML: (attributes) => ({ 'data-source-close': attributes.source_close }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="inlineMath"]',
        getAttrs: (element) => {
          const htmlElement = element as HTMLElement
          return hasValidDelimiters(
            htmlElement.getAttribute('data-source-open') ?? '\\(',
            htmlElement.getAttribute('data-source-close') ?? '\\)'
          ) ? null : false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'inlineMath',
        class: 'inline-math',
      }),
    ]
  },

  renderText({ node }) {
    return `${node.attrs.source_open}${node.attrs.math_equation}${node.attrs.source_close}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathComponent as any)
  },
})
