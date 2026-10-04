import { useYui } from '../../store/yui'
import { useHeader } from '../../views/ui'
import type { HelpTab } from '../../help/api'
import { FaqTab } from '../../help/FaqTab'
import { GuideTab } from '../../help/GuideTab'
import { HomeTab } from '../../help/HomeTab'
import { RecipesTab } from '../../help/RecipesTab'
import { ResultsTab } from '../../help/ResultsTab'
import { Tabs } from '../../help/ui'
import '../../help/help.css'

// Ajuda: guias operacionais por ferramenta, receitas, perguntas frequentes, Pergunte e Resultados.
// appParams.id: inicio | guias | guia:<id> | receitas | receita:<id> | resultados | faq

export function HelpPage() {
  const id = useYui((s) => s.appParams.id) ?? 'inicio'
  const guide = id.startsWith('guia:') ? id.slice(5) : null
  const recipe = id.startsWith('receita:') ? id.slice(8) : null
  const tab: HelpTab = guide || id === 'guias' ? 'guias' : recipe || id === 'receitas' ? 'receitas' : id === 'resultados' || id === 'faq' ? id : 'inicio'

  useHeader('Sistema · ajuda', 'Ajuda', [], [])

  return (
    <div className="hp-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <Tabs active={tab} />
      {tab === 'guias' ? <GuideTab id={guide} /> : tab === 'receitas' ? <RecipesTab id={recipe} /> : tab === 'resultados' ? <ResultsTab /> : tab === 'faq' ? <FaqTab /> : <HomeTab />}
    </div>
  )
}
