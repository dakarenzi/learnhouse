import { describe, expect, test } from 'bun:test'
import { Editor, generateText } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Window } from 'happy-dom'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'

import InlineMath from '../components/Objects/Editor/Extensions/InlineMath/InlineMath.ts'
import { EscapedInlineMathFallback } from '../components/Objects/Editor/Extensions/InlineMath/InlineMathComponent.tsx'
import { renderInlineMath, MAX_INLINE_MATH_SOURCE_LENGTH } from '../components/Objects/Editor/Extensions/InlineMath/renderInlineMath.ts'

const testWindow = new Window()
globalThis.window = testWindow
globalThis.document = testWindow.document
globalThis.Node = testWindow.Node
globalThis.HTMLElement = testWindow.HTMLElement
globalThis.Element = testWindow.Element

const extensions = [
  StarterKit,
  InlineMath,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
]

const fixture = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [
        { type: 'text', text: 'Force ' },
        {
          type: 'inlineMath',
          attrs: { math_equation: 'F=ma', source_open: '\\(', source_close: '\\)' },
          marks: [{ type: 'bold' }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Définition ' },
        {
          type: 'inlineMath',
          attrs: { math_equation: ' E = mc^2 ', source_open: '$', source_close: '$' },
          marks: [{ type: 'italic' }],
        },
        { type: 'text', text: ' exacte.' },
      ],
    },
    {
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'inlineMath',
            attrs: { math_equation: '\\vec{v}=\\frac{d\\vec{r}}{dt}', source_open: '\\(', source_close: '\\)' },
          }],
        }],
      }],
    },
    {
      type: 'table',
      content: [{
        type: 'tableRow',
        content: [{
          type: 'tableCell',
          attrs: { colspan: 1, rowspan: 1, colwidth: null },
          content: [{
            type: 'paragraph',
            content: [{
              type: 'inlineMath',
              attrs: { math_equation: '\\alpha+\\beta', source_open: '$', source_close: '$' },
            }],
          }],
        }],
      }],
    },
  ],
}

function createEditor(content) {
  return new Editor({ element: null, extensions, content })
}

describe('native inlineMath schema', () => {
  test('round-trips exact attributes, surrounding text, order, and marks', () => {
    const editor = createEditor(fixture)
    const saved = JSON.parse(JSON.stringify(editor.getJSON()))
    editor.destroy()

    const reopened = createEditor(saved)
    expect(reopened.getJSON()).toEqual(saved)
    expect(reopened.getJSON().content[0].content[1].marks).toEqual([{ type: 'bold' }])
    expect(reopened.getJSON().content[1].content[1].attrs.math_equation).toBe(' E = mc^2 ')
    expect(reopened.getJSON().content[2].content[0].content[0].content[0].type).toBe('inlineMath')
    expect(reopened.getJSON().content[3].content[0].content[0].content[0].content[0].type).toBe('inlineMath')
    reopened.destroy()
  })

  test('preserves source longer than the rendering limit without rewriting it', () => {
    const source = 'x'.repeat(MAX_INLINE_MATH_SOURCE_LENGTH + 1)
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'inlineMath', attrs: { math_equation: source, source_open: '\\(', source_close: '\\)' } },
      ] }],
    }
    const editor = createEditor(content)
    const saved = editor.getJSON()
    editor.destroy()

    expect(saved.content[0].content[0].attrs.math_equation).toBe(source)
    expect(renderInlineMath(saved.content[0].content[0].attrs.math_equation)).toBeNull()
  })

  test('keeps formulas inline in headings, paragraphs, lists, and table cells', () => {
    const editor = createEditor(fixture)
    const doc = editor.state.doc
    const placements = []
    doc.descendants((node, position, parent) => {
      if (node.type.name === 'inlineMath') placements.push(parent.type.name)
    })

    expect(placements).toEqual(['heading', 'paragraph', 'paragraph', 'paragraph'])
    const text = generateText(fixture, extensions, { blockSeparator: ' ' })
    expect(text).toContain('Force \\(F=ma\\)')
    expect(text).toContain('$ E = mc^2 $')
    editor.destroy()
  })

  test('serializes delimiter-wrapped text and escaped HTML attributes that parse back exactly', () => {
    const source = 'x" onmouseover="alert(1) & keep spaces '
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'before ' },
        { type: 'inlineMath', attrs: { math_equation: source, source_open: '$', source_close: '$' } },
        { type: 'text', text: ' after' },
      ] }],
    }
    const editor = createEditor(content)
    const html = editor.getHTML()
    expect(generateText(content, extensions, { blockSeparator: '' })).toContain(`before $${source}$ after`)
    expect(html).toContain('data-type="inlineMath"')
    expect(html).toContain('onmouseover=&quot;alert(1)')
    expect(html).not.toContain('onmouseover="alert(1)')

    const reopened = createEditor({ type: 'doc', content: [{ type: 'paragraph' }] })
    reopened.commands.setContent(html)
    expect(reopened.getJSON().content[0].content[1].attrs).toEqual({
      math_equation: source,
      source_open: '$',
      source_close: '$',
    })
    editor.destroy()
    reopened.destroy()
  })

  test('rejects non-contract delimiter pairs on HTML import', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'left ' },
        { type: 'inlineMath', attrs: { math_equation: 'x', source_open: '\\(', source_close: '$' } },
        { type: 'text', text: ' right' },
      ] }],
    })
    const html = editor.getHTML().replace('data-source-close="$"', 'data-source-close="bad"')
    const reopened = createEditor({ type: 'doc', content: [{ type: 'paragraph' }] })
    reopened.commands.setContent(html)
    expect(reopened.getJSON().content[0].content.map((node) => node.type)).toEqual(['text'])
    expect(reopened.getText()).toContain('left')
    expect(reopened.getText()).toContain('right')
    editor.destroy()
    reopened.destroy()
  })
})

describe('safe inline KaTeX rendering', () => {
  test('renders valid inline math with HTML and MathML', () => {
    const html = renderInlineMath('\\frac{a}{b}')
    expect(html).toContain('class="katex"')
    expect(html).toContain('<math')
    expect(html).toContain('<semantics>')
  })

  test('returns an escaped-text fallback signal for invalid, unsupported, resource, and oversized input', () => {
    expect(renderInlineMath('\\notARealCommand{x}')).toBeNull()
    expect(renderInlineMath('\\includegraphics{https://example.invalid/pixel.png}')).toBeNull()
    expect(renderInlineMath('\\href{https://example.invalid}{resource}')).toBeNull()
    expect(renderInlineMath('\\htmlData{class=unsafe}{x}')).toBeNull()
    const oversized = 'x'.repeat(MAX_INLINE_MATH_SOURCE_LENGTH + 1)
    expect(renderInlineMath(oversized)).toBeNull()
    expect(oversized).toHaveLength(MAX_INLINE_MATH_SOURCE_LENGTH + 1)
  })

  test('renders invalid source as escaped React text, not executable HTML', () => {
    const source = '<img src=x onerror=alert(1)>'
    const html = renderToStaticMarkup(React.createElement(EscapedInlineMathFallback, {
      math: source,
      sourceOpen: '\\(',
      sourceClose: '\\)',
    }))

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
  })
})
