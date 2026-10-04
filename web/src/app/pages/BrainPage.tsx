import { useYui } from '../../store/yui'
import { Constellation } from '../../brain/Constellation'
import { useVaultGraph } from '../../brain/data'
import { SPACE_BG } from '../../brain/styles'
import { Universe } from '../../brain/Universe'

// Cérebro: universo de conexões do vault. /app/brain = universo; /app/brain/<nota> = constelação da nota.
export function BrainPage() {
  const note = useYui((s) => s.appParams.id ?? null)
  const { graph, error } = useVaultGraph()
  if (!graph) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: SPACE_BG, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: error ? '#f39aa4' : '#9aa0bb', fontSize: 14 }}>
        {error ? `Não consegui ler o vault: ${error}` : 'Acendendo as estrelas…'}
      </div>
    )
  }
  return note ? <Constellation key={note} path={note} graph={graph} /> : <Universe graph={graph} />
}
