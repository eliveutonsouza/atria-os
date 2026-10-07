import { useState } from 'react'
import { useYui } from '../store/yui'
import { ConfirmDeleteModal } from '../views/ui'
import { send } from './http'

// Exclusão de workflow pelo Atria OS (lista e editor): confirmação explícita antes do DELETE.

export function DeleteWorkflowModal({ slug, name, rows, onClose, onDeleted }: {
  slug: string
  name: string
  rows: { label: string; value: string }[]
  onClose: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    try {
      await send('DELETE', `/api/workflows/${encodeURIComponent(slug)}`)
      useYui.getState().say(`Workflow "${name}" excluído.`)
      onDeleted()
    } catch (e) {
      useYui.getState().say(`Não consegui excluir "${name}": ${(e as Error).message}.`)
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <ConfirmDeleteModal
      title={`Excluir o workflow "${name}"?`}
      text="Some o arquivo do workflow, as rotinas agendadas dele e o histórico de execuções. Se estiver rodando, a execução é interrompida."
      rows={rows}
      busy={busy}
      onCancel={onClose}
      onConfirm={() => void confirm()}
    />
  )
}
