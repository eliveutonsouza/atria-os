import { useEffect, useState } from 'react'
import type { CompanyStats } from '@shared/protocol'
import { api } from '../../api/client'
import { onCompanyEvent } from '../../api/events'
import { useYui } from '../../store/yui'
import { useHeader } from '../../views/ui'
import { goTab, type CompanyTab } from '../../company/api'
import { DocDetail } from '../../company/DocDetail'
import { DocsTab } from '../../company/DocsTab'
import { ProfileTab } from '../../company/ProfileTab'
import { SearchTab } from '../../company/SearchTab'
import { Tabs } from '../../company/ui'
import '../../company/company.css'

// Empresa: perfil (contexto fixo da Yui e dos agentes) + base de documentos com OCR e RAG.
// appParams.id: perfil | documentos | busca | doc:<id>

export function CompanyPage() {
  const id = useYui((s) => s.appParams.id) ?? 'perfil'
  const docId = id.startsWith('doc:') ? id.slice(4) : null
  const tab: CompanyTab = docId ? 'documentos' : id === 'documentos' || id === 'busca' ? id : 'perfil'
  const [docs, setDocs] = useState<number | null>(null)
  const narrow = useYui((s) => s.narrow)

  useHeader('Conhecimento · empresa', 'Empresa', tab === 'documentos' && !docId ? [] : [{ label: '+ Enviar documentos', primary: true, fn: () => goTab('documentos') }], [tab, docId])

  useEffect(() => {
    const load = () => api.get<CompanyStats>('/api/company/stats').then((s) => setDocs(s.docs)).catch(() => {})
    load()
    let t: ReturnType<typeof setTimeout> | undefined
    const off = onCompanyEvent((ev) => {
      if (ev.type === 'company.profile.updated') return
      clearTimeout(t)
      t = setTimeout(load, 600)
    })
    return () => {
      off()
      clearTimeout(t)
    }
  }, [])

  return (
    <div className="co-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {/* celular: detalhe do documento em tela cheia, sem as abas */}
      {!(narrow && docId) && <Tabs active={tab} docs={docs} />}
      {docId ? <DocDetail key={docId} id={docId} /> : tab === 'documentos' ? <DocsTab /> : tab === 'busca' ? <SearchTab /> : <ProfileTab />}
    </div>
  )
}
