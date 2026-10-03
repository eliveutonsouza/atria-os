// Sessão de voz GPT-Live via WebRTC. O servidor cria a sessão (client.live.create) e cuida
// de transcrições/delegação pelo sideband; o browser só carrega áudio e lê o canal de eventos.
import { api, MOCK } from '../api/client'
import { useYui } from '../store/yui'
import { attachStream, detachStream, getVoiceLevel } from './audioLevel'

let pc: RTCPeerConnection | null = null
let mic: MediaStream | null = null
let audioEl: HTMLAudioElement | null = null
let levelTimer: ReturnType<typeof setInterval> | undefined
let lastVoice = 0

function setSt(p: Parameters<ReturnType<typeof useYui.getState>['set']>[0]) {
  useYui.getState().set(p)
}

function teardown() {
  clearInterval(levelTimer)
  pc?.getSenders().forEach((s) => s.track?.stop())
  pc?.close()
  pc = null
  mic?.getTracks().forEach((t) => t.stop())
  mic = null
  if (audioEl) {
    audioEl.srcObject = null
    audioEl.remove()
    audioEl = null
  }
  detachStream('local')
  detachStream('remote')
}

export function liveActive() {
  return !!pc
}

export async function startLive() {
  const s = useYui.getState()
  if (pc || s.liveConnecting) return
  if (MOCK) {
    setSt({ listening: true, yst: 'listening' })
    return
  }
  setSt({ liveConnecting: true, yst: 'listening', showLines: false })
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    attachStream('local', mic)
    pc = new RTCPeerConnection()
    mic.getAudioTracks().forEach((t) => pc!.addTrack(t, mic!))
    audioEl = document.createElement('audio')
    audioEl.autoplay = true
    audioEl.style.display = 'none'
    document.body.appendChild(audioEl)
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track])
      audioEl!.srcObject = stream
      attachStream('remote', stream)
    }
    const dc = pc.createDataChannel('oai-events')
    dc.onmessage = (m) => onChannelEvent(m.data)
    pc.onconnectionstatechange = () => {
      if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) {
        teardown()
        setSt({ listening: false, yst: useYui.getState().baseState() })
      }
    }
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const ans = await api.post<{ sdp: string; sessionId: string }>('/api/live/session', { sdp: offer.sdp })
    await pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp })
    setSt({ listening: true, liveConnecting: false })
    levelTimer = setInterval(trackSpeaking, 100)
  } catch (e) {
    teardown()
    const name = (e as DOMException)?.name
    const msg =
      name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Preciso de permissão do microfone para te ouvir. Você pode continuar digitando.'
        : name === 'NotFoundError'
          ? 'Não encontrei um microfone. Pode digitar que eu sigo daqui.'
          : 'Não consegui abrir a conversa por voz agora. Pode digitar que eu sigo daqui.'
    setSt({ liveConnecting: false, listening: false })
    useYui.getState().say(msg, { state: 'warning' })
    setTimeout(() => setSt({ yst: useYui.getState().baseState() }), 1600)
  }
}

export async function stopLive(notifyServer = true) {
  const had = !!pc
  teardown()
  setSt({ listening: false, liveConnecting: false, liveTranscript: '' })
  setSt({ yst: useYui.getState().baseState() })
  if (notifyServer && (had || MOCK)) api.post('/api/live/end').catch(() => {})
}

export function toggleLive() {
  const s = useYui.getState()
  if (s.listening || pc) void stopLive()
  else void startLive()
}

// speaking <-> listening pela amplitude do áudio remoto, sem pisar em thinking/showing/etc.
function trackSpeaking() {
  const s = useYui.getState()
  if (!s.listening) return
  const lvl = getVoiceLevel('remote') ?? 0
  const now = performance.now()
  if (lvl > 0.035) {
    lastVoice = now
    if (s.yst === 'idle' || s.yst === 'listening') s.set({ yst: 'speaking' })
  } else if (s.yst === 'speaking' && now - lastVoice > 700) {
    s.set({ yst: 'listening' })
  }
}

function onChannelEvent(raw: string) {
  let ev: { type?: string }
  try {
    ev = JSON.parse(raw)
  } catch {
    return
  }
  const s = useYui.getState()
  if (ev.type === 'session.input_transcript.delta' && s.yst !== 'speaking') {
    if (s.yst === 'idle') s.set({ yst: 'listening' })
  } else if (ev.type === 'session.closed') {
    void stopLive(false)
  }
}

// servidor encerrou a sessão (ociosidade) -> derruba o WebRTC local
useYui.subscribe((st, prev) => {
  if (prev.listening && !st.listening && pc) teardown()
})

// aba fechada/recarregada com voz ligada: avisa o servidor para não deixar a sessão (cobrada por segundo) aberta
window.addEventListener('pagehide', () => {
  if (pc) navigator.sendBeacon('/api/live/end')
})
