import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

// Markdown do vault no modo Leitura: [[wikilinks]] (alias e #seção), ![[embeds]] viram link,
// #tags viram chips, frontmatter sai do corpo (mostrado como propriedades). HTML sanitizado.

export function splitFrontmatter(text: string): { props: [string, string][]; body: string } {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return { props: [], body: text }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { props: [], body: text }
  const raw = text.slice(text.indexOf('\n') + 1, end)
  const props: [string, string][] = []
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([\wÀ-ú-]+):\s*(.*)$/)
    if (m) props.push([m[1], m[2].replace(/^\[|\]$/g, '').trim()])
    else if (props.length && /^\s*-\s+/.test(line)) props[props.length - 1][1] += `${props[props.length - 1][1] ? ', ' : ''}${line.replace(/^\s*-\s+/, '').trim()}`
  }
  const after = text.indexOf('\n', end + 1)
  return { props, body: after < 0 ? '' : text.slice(after + 1) }
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })

md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const src = state.src
  let pos = state.pos
  const embed = src.charCodeAt(pos) === 0x21 /* ! */
  if (embed) pos++
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false
  const close = src.indexOf(']]', pos + 2)
  if (close < 0) return false
  const inner = src.slice(pos + 2, close)
  if (!inner || inner.includes('\n')) return false
  if (!silent) {
    const [target, alias] = inner.split('|')
    const t = state.push('wikilink', '', 0)
    t.meta = { target: target.trim(), label: (alias ?? target.split('#')[0]).trim() || target.trim(), embed }
  }
  state.pos = close + 2
  return true
})
md.renderer.rules.wikilink = (tokens, idx) => {
  const { target, label, embed } = tokens[idx].meta as { target: string; label: string; embed: boolean }
  const esc = md.utils.escapeHtml
  return `<a class="vlink${embed ? ' vembed' : ''}" data-note="${esc(target)}" href="#">${esc(label)}</a>`
}

md.inline.ruler.after('wikilink', 'vtag', (state, silent) => {
  const src = state.src
  const pos = state.pos
  if (src.charCodeAt(pos) !== 0x23 /* # */) return false
  const prev = pos === 0 ? ' ' : src[pos - 1]
  if (!/\s|\(/.test(prev)) return false
  const m = src.slice(pos + 1).match(/^[A-Za-zÀ-ú][\wÀ-ú/-]*/)
  if (!m) return false
  if (!silent) {
    const t = state.push('vtag', '', 0)
    t.content = m[0]
  }
  state.pos = pos + 1 + m[0].length
  return true
})
md.renderer.rules.vtag = (tokens, idx) => `<span class="vtag">#${md.utils.escapeHtml(tokens[idx].content)}</span>`

// tarefas "- [ ]" / "- [x]"
md.core.ruler.after('inline', 'vtasks', (state) => {
  for (const tok of state.tokens) {
    if (tok.type !== 'inline' || !tok.children?.length) continue
    const first = tok.children[0]
    if (first.type !== 'text') continue
    const m = first.content.match(/^\[([ xX])\]\s+/)
    if (!m) continue
    first.content = first.content.slice(m[0].length)
    const box = new state.Token('html_inline', '', 0)
    box.content = `<span class="vtask ${m[1] === ' ' ? 'open' : 'done'}">${m[1] === ' ' ? '○' : '✓'}</span>`
    tok.children.unshift(box)
  }
})

export function renderNote(body: string): string {
  const html = md.render(body)
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-note', 'target'] })
}

// Links de saída da nota (para o painel de conexões).
export function outgoing(text: string): string[] {
  const out = new Set<string>()
  const clean = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  for (const m of clean.matchAll(/!?\[\[([^\]\n]+?)\]\]/g)) out.add(m[1].split('|')[0].split('#')[0].trim())
  return [...out].filter(Boolean)
}
