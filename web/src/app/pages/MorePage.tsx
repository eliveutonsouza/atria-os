import { C } from '../../lib/colors'
import { exitApp } from '../nav'
import { NavIcon, useNavGroups } from '../navItems'
import { openPage } from '../Sidebar'
import { useHeader } from '../../views/ui'

// Aba "Mais" do celular (prancha Phone-Mais): o menu completo em grade, por grupo, com contadores.

export function MorePage() {
  const groups = useNavGroups()
  useHeader('Menu', 'Mais', [{ label: 'Falar com a Yui', fn: () => exitApp(), primary: true }])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {groups.map((g) => (
        <section key={g.name} aria-label={g.name} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="eyebrow">{g.name}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 8 }}>
            {g.items.map((it) => (
              <button
                key={it.id}
                onClick={() => openPage(it.id)}
                style={{
                  position: 'relative', minHeight: 68, padding: '10px 12px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
                  border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.035)', color: C.text, fontSize: 13, fontWeight: 600,
                }}
              >
                <span style={{ color: C.cyan, display: 'flex' }}>
                  <NavIcon id={it.id} size={20} stroke={1.8} />
                </span>
                {it.label}
                {it.count !== undefined && <span style={{ position: 'absolute', top: 8, right: 10, fontSize: 11, fontWeight: 700, color: it.warn ? C.warn : C.cyan }}>{it.count}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
