// Mermaid sob demanda (a lib é grande): só carrega quando alguma tela desenha um diagrama.
type Mermaid = typeof import('mermaid').default

let loading: Promise<Mermaid> | null = null

export function loadMermaid(): Promise<Mermaid> {
  loading ??= import('mermaid').then((m) => {
    const mm = m.default
    mm.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        darkMode: true,
        background: '#0a0c1d',
        primaryColor: '#0f1f33',
        primaryTextColor: '#e8eaf4',
        primaryBorderColor: '#67d8f2',
        secondaryColor: '#221a3d',
        tertiaryColor: '#11131f',
        lineColor: '#8c92ad',
        textColor: '#c9cde0',
        edgeLabelBackground: '#10132a',
        fontFamily: 'Manrope, system-ui, sans-serif',
        fontSize: '13px',
      },
      flowchart: { htmlLabels: true, curve: 'basis', padding: 12 },
    })
    return mm
  })
  return loading
}

let seq = 0

export async function renderMermaid(code: string): Promise<string> {
  const m = await loadMermaid()
  const id = `yui-mmd-${++seq}`
  try {
    const { svg } = await m.render(id, code)
    return svg
  } finally {
    // a lib deixa um nó temporário no body quando falha
    document.getElementById(`d${id}`)?.remove()
  }
}
