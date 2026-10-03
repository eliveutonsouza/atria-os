import { useEffect, useRef, useState } from 'react'
import type { ArtifactInfo, ProjectDetail } from '@shared/protocol'
import { api } from '../api/client'
import { submitText } from '../lib/actions'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { Empty, Skeleton, useHeader } from './ui'

interface Target { url: string; title: string; project: string | null }

async function resolveTarget(artifactId?: string, project?: string | null): Promise<Target | null> {
  if (artifactId || !project) {
    const list = await api.get<ArtifactInfo[]>('/api/artifacts')
    const a = artifactId ? list.find((x) => x.id === artifactId) : list.find((x) => (x.kind === 'website' || x.kind === 'html') && x.url)
    if (a?.url) return { url: a.url, title: a.title, project: a.project }
  }
  if (project) {
    const p = await api.get<ProjectDetail>(`/api/projects/${encodeURIComponent(project)}`)
    if (p.previewUrl) return { url: p.previewUrl, title: p.name, project: p.slug }
    const list = await api.get<ArtifactInfo[]>('/api/artifacts')
    const a = list.find((x) => x.project === project && (x.kind === 'website' || x.kind === 'html') && x.url)
    if (a?.url) return { url: a.url, title: a.title, project }
  }
  return null
}

export function WebsiteView() {
  const params = useYui((s) => s.viewParams)
  const activeProject = useYui((s) => s.activeProject)
  const selEl = useYui((s) => s.selEl)
  const [target, setTarget] = useState<Target | null | undefined>(undefined)
  const [reload, setReload] = useState(0)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const project = params.project ?? (params.artifactId ? null : activeProject)

  useEffect(() => {
    let alive = true
    resolveTarget(params.artifactId, project).then((t) => alive && setTarget(t)).catch(() => alive && setTarget(null))
    return () => { alive = false }
  }, [params.artifactId, project])

  // recarrega quando um agente termina algo neste projeto
  const runsDone = useYui((s) => Object.values(s.runs).filter((r) => r.state === 'done' && (!project || r.project === project)).length)
  useEffect(() => {
    if (runsDone) setReload((n) => n + 1)
  }, [runsDone])

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; selector?: string; text?: string }
      // só aceita mensagens do iframe do preview
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return
      if (d?.type !== 'yui.select' || typeof d.selector !== 'string') return
      const s = useYui.getState()
      s.set({ selEl: d.selector })
      const what = d.text ? `“${d.text.slice(0, 60)}”` : d.selector
      s.say(`Seção ${what} selecionada. O que quer mudar nela?`, { state: s.baseState() })
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  useHeader('Live preview', target?.title ?? 'Preview', target
    ? [
        { label: 'Recarregar', fn: () => setReload((n) => n + 1) },
        { label: 'Deploy', fn: () => submitText('Faça o deploy deste site.') },
      ]
    : [], [target])

  if (target === undefined) return <Skeleton kpis={0} rows={6} />
  if (!target) return <Empty text="Ainda não há preview para mostrar." hint="Diga: “Crie um site para uma clínica odontológica.”" />
  const mock = target.url.startsWith('mock:')
  const host = mock ? 'clinica-sorriso.preview.yui' : target.url.replace(/^https?:\/\//, '').replace(/^\//, location.host + '/')
  return (
    <div style={{ height: '100%', minHeight: 460, display: 'flex', flexDirection: 'column', borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,.1)', background: '#f6f4ef' }}>
      <div style={{ height: 38, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', background: '#14172c', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map((i) => <span key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: '#3a3f5c' }} />)}
        </div>
        <div className="mono" style={{ flex: 1, maxWidth: 420, height: 24, borderRadius: 7, background: 'rgba(255,255,255,.05)', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 11, color: C.t2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{host}</div>
        <div style={{ fontSize: 11, color: C.cyan, whiteSpace: 'nowrap' }}>{selEl ? `${selEl} selecionado` : 'clique para selecionar'}</div>
      </div>
      <iframe
        key={reload}
        ref={frameRef}
        title={`Preview ${target.title}`}
        sandbox="allow-scripts allow-forms"
        src={mock ? undefined : target.url}
        srcDoc={mock ? MOCK_SITE : undefined}
        style={{ flex: 1, width: '100%', border: 'none', background: '#f6f4ef' }}
      />
    </div>
  )
}

// Página de demonstração do design (Clínica Sorriso) usada só no modo mock.
const MOCK_SITE = `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap" rel="stylesheet"><style>
body{margin:0;font-family:Manrope,sans-serif;color:#1d2422;background:#f6f4ef}nav{display:flex;justify-content:space-between;padding:18px 40px;font-size:13px}nav b{letter-spacing:.02em}nav span{display:flex;gap:22px;color:#55605c}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:32px;align-items:center;padding:28px 40px 40px;cursor:pointer;outline:2px solid transparent;outline-offset:-6px}
.hero.sel{outline-color:#67d8f2}.k{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#2f7a6b;font-weight:600}h1{font-size:40px;line-height:1.08;font-weight:700;letter-spacing:-.02em;margin:16px 0}
p{font-size:15px;color:#55605c;line-height:1.6;max-width:420px}.b{display:flex;gap:10px}.b span{padding:12px 20px;border-radius:999px;font-size:14px}.b span:first-child{background:#1d2422;color:#f6f4ef;font-weight:600}.b span:last-child{border:1px solid #c9c5ba}
.ph{height:260px;border-radius:18px;background:repeating-linear-gradient(135deg,#e7e3d9 0 10px,#efebe2 10px 20px);display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:12px;color:#8a8577}
.sv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;padding:8px 40px 40px}.sv div{padding:20px;border-radius:14px;background:#fff;border:1px solid #e7e3d9;font-size:13px;color:#55605c;line-height:1.5}.sv b{display:block;color:#1d2422;margin-bottom:6px;font-size:15px}
</style></head><body><nav><b>Clínica Sorriso</b><span><span>Tratamentos</span><span>Equipe</span><span>Contato</span></span></nav>
<section class="hero" id="hero-section"><div><div class="k">Odontologia em São Paulo</div><h1>Seu sorriso em boas mãos!</h1><p>Tratamentos modernos para toda a família, com conforto e tecnologia.</p><div class="b"><span>Agendar avaliação</span><span>Ver tratamentos</span></div></div><div class="ph">foto da clínica</div></section>
<div class="sv"><div><b>Implantes</b>Planejamento digital e cirurgia guiada.</div><div><b>Ortodontia</b>Alinhadores e aparelhos para todas as idades.</div><div><b>Clareamento</b>Resultados naturais em poucas sessões.</div></div>
<script>document.getElementById('hero-section').onclick=function(){this.classList.add('sel');parent.postMessage({type:'yui.select',selector:'hero-section',text:'Seu sorriso em boas mãos!'},'*')}</script></body></html>`
