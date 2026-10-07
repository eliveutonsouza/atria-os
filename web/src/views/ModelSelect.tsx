import { useState } from 'react'
import type { ModelOption } from '@shared/protocol'
import { C } from '../lib/colors'
import { input, SmallBtn } from './kit'

// Select de modelo (Configurações › Modelos e detalhe do agente). O valor atual entra sempre na lista,
// mesmo fora do catálogo; "Outro…" abre um campo para digitar o nome exato (com Testar opcional).

const CUSTOM = '__custom__'

const selStyle = { ...input, height: 44, maxWidth: 440, borderRadius: 12, background: '#0e1126', padding: '0 12px' } as const

const short = (s: string, n = 42) => (s.length > n ? `${s.slice(0, n)}…` : s)

export function ModelSelect({ value, onChange, options, placeholderDefault, allowCustom = true, ariaLabel, onTest }: {
  value: string
  onChange: (v: string) => void
  options: ModelOption[]
  /** rótulo da opção vazia (ex.: "Padrão do Atria OS — Claude Opus 5.5"); sem ele não há opção vazia */
  placeholderDefault?: string
  allowCustom?: boolean
  ariaLabel: string
  /** testa o nome digitado em "Outro…"; devolve o texto a mostrar */
  onTest?: (model: string) => Promise<{ ok: boolean; text: string }>
}) {
  const known = (v: string) => options.some((o) => o.value === v)
  const [custom, setCustom] = useState(false)
  // resultado do Testar vale só para o nome testado (digitou outro, some)
  const [tested, setTested] = useState<{ model: string; ok: boolean; text: string } | null>(null)
  const test = tested?.model === value.trim() ? tested : null

  const list = !custom && value && !known(value) ? [{ value, label: value, hint: 'atual' }, ...options] : options
  const runTest = async () => {
    if (!onTest || !value.trim()) return
    const model = value.trim()
    setTested({ model, ok: true, text: 'Testando…' })
    const r = await onTest(model).catch(() => ({ ok: false, text: 'Não consegui testar agora.' }))
    setTested({ model, ...r })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <select
        aria-label={ariaLabel}
        value={custom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true)
            return
          }
          setCustom(false)
          onChange(e.target.value)
        }}
        style={selStyle}
      >
        {placeholderDefault !== undefined && <option value="">{placeholderDefault}</option>}
        {list.map((o) => (
          <option key={o.value} value={o.value}>
            {o.hint ? `${o.label} · ${short(o.hint)}` : o.label}
          </option>
        ))}
        {allowCustom && <option value={CUSTOM}>Outro…</option>}
      </select>
      {custom && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', maxWidth: 440 }}>
          <input
            className="mono"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="nome exato do modelo"
            aria-label={`${ariaLabel} — nome do modelo`}
            autoComplete="off"
            spellCheck={false}
            style={{ ...input, flex: '1 1 200px', height: 44, borderRadius: 12 }}
          />
          {onTest && <SmallBtn onClick={runTest} disabled={!value.trim()}>Testar</SmallBtn>}
        </div>
      )}
      {test && <span role="status" style={{ fontSize: 12, color: test.text === 'Testando…' ? C.t2 : test.ok ? C.ok : '#f39aa4' }}>{test.text}</span>}
    </div>
  )
}
