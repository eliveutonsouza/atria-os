// Ponte de arquivos entre o Yui Console e o VS Code (mesmo volume /workspace):
// - o console grava /workspace/.yui/.editor-open.json {path, line, at} → abrimos o arquivo;
// - gravamos /workspace/.yui/.editor-state.json {path, at} quando o editor ativo muda.
const vscode = require('vscode')
const fs = require('fs')

const REQ = '/workspace/.yui/.editor-open.json'
const STATE = '/workspace/.yui/.editor-state.json'

function activate(ctx) {
  // painel de chat de IA (barra lateral secundária) não faz parte do editor do vault
  vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar').then(undefined, () => {})
  let last = 0
  const open = async (r) => {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(r.path))
      const ed = await vscode.window.showTextDocument(doc, { preview: false })
      if (r.line && r.line > 0) {
        const pos = new vscode.Position(Math.min(r.line - 1, doc.lineCount - 1), 0)
        ed.selection = new vscode.Selection(pos, pos)
        ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
      }
    } catch (e) {
      console.error('yui-bridge: não abriu', r.path, e && e.message)
    }
  }
  const handle = () => {
    let r
    try {
      r = JSON.parse(fs.readFileSync(REQ, 'utf8'))
    } catch {
      return
    }
    if (!r || typeof r.path !== 'string' || !r.at || r.at <= last) return
    last = r.at
    open(r)
  }
  fs.watchFile(REQ, { interval: 400 }, handle)
  ctx.subscriptions.push({ dispose: () => fs.unwatchFile(REQ, handle) })
  handle()

  const write = (ed) => {
    if (!ed || ed.document.uri.scheme !== 'file') return
    fs.writeFile(STATE, JSON.stringify({ path: ed.document.uri.fsPath, at: Date.now() }), () => {})
  }
  ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(write))
  write(vscode.window.activeTextEditor)
}

function deactivate() {}

module.exports = { activate, deactivate }
