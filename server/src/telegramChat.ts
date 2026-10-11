import type { ApprovalInfo } from '../../shared/protocol.ts';
import { kvGet, kvSet } from './db.ts';
import { saveMessage, think } from './brain.ts';
import { transcribe } from './transcribe.ts';
import { findProject, listProjectConfigs } from './projects.ts';
import { pendingApprovals, resolveApproval, runBus } from './runs.ts';
import { getSetting } from './settings.ts';
import { approvalButtons, registerChatBridge, telegramReady } from './notify.ts';

// Conversar com a Yui pelo Telegram (ideia do gateway do Hermes). Texto ou áudio do chat vinculado vira pedido
// para o cérebro, na conversa de um projeto próprio do Telegram (kv notify.tg.project, "" = Geral), trocado
// por /projeto. Nada disso mexe no painel: o projeto ativo e as telas continuam onde estão.

const tgProject = (): string | null => kvGet('notify.tg.project') || null;
const nameOf = (slug: string | null) => (slug ? findProject(slug)?.name ?? slug : 'Geral');

registerChatBridge({
  async ask(text, source) {
    const project = tgProject();
    saveMessage('user', text, 'telegram', project);
    const input = { request: text, source: source === 'voice' ? ('voice' as const) : ('text' as const), project, channel: 'telegram' as const };
    const answer = await think(input);
    // o pedido pode ter trocado o projeto da conversa do Telegram (switch_project)
    if ((input.project ?? null) !== project) kvSet('notify.tg.project', input.project ?? '');
    saveMessage('yui', answer, 'telegram', input.project ?? null);
    return answer;
  },
  async transcribe(path) {
    return (await transcribe(path)).text;
  },
  project() {
    const slug = tgProject();
    return { slug, name: nameOf(slug) };
  },
  setProject(q) {
    if (/^(geral|nenhum|sem projeto)$/i.test(q.trim())) {
      kvSet('notify.tg.project', '');
      return { ok: true, name: 'Geral' };
    }
    const p = findProject(q);
    if (!p) return { ok: false, error: `Não achei o projeto "${q}".`, options: listProjectConfigs().filter((x) => x.cloned).map((x) => x.name) };
    kvSet('notify.tg.project', p.slug);
    return { ok: true, name: p.name };
  },
  resolveApproval(id, approve) {
    const a = pendingApprovals().find((x) => x.id === id);
    if (!a || a.kind === 'destructive') return { ok: false };
    return { ok: resolveApproval(id, approve), title: a.title };
  },
});

// Aprovação nova (comum) chega no Telegram com botões, se o tipo "approval" estiver ligado nos avisos.
const wants = () => String(getSetting('notify.types') ?? 'approval,failed,done').split(',').map((s) => s.trim()).includes('approval');
runBus.on('approval', (a: ApprovalInfo) => {
  if (a.kind === 'destructive' || !telegramReady() || !wants()) return;
  void approvalButtons(a);
});
