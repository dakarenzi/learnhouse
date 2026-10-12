import katex from 'katex'

// Bound CPU and markup work for user-imported TeX. The source stays intact in
// the document even when it exceeds this rendering limit.
export const MAX_INLINE_MATH_SOURCE_LENGTH = 4096

export function renderInlineMath(tex: string): string | null {
  if (tex.length > MAX_INLINE_MATH_SOURCE_LENGTH) return null

  try {
    const html = katex.renderToString(tex, {
      displayMode: false,
      output: 'htmlAndMathml',
      trust: false,
      maxExpand: 1000,
      maxSize: 50,
      throwOnError: true,
      strict: 'error',
    })
    // Unknown commands may be represented by KaTeX as red error text rather
    // than thrown. Detect that error rendering and use the escaped source.
    if (html.includes('<mstyle mathcolor="#cc0000"><mtext>')) return null
    return html
  } catch {
    // KaTeX errors may contain the untrusted source. The caller renders its
    // original source as a React text child instead of exposing error HTML.
    return null
  }
}
