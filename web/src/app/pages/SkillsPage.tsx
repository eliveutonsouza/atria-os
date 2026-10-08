import { useYui } from '../../store/yui'
import { SkillsView } from '../../views/SkillsView'

// Loja de skills (skills.sh) — aba vem de /app/skills/<aba>.
export function SkillsPage() {
  const tab = useYui((s) => s.appParams.id)
  return <SkillsView tab={tab} />
}
