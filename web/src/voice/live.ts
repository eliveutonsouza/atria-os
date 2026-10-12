// Sessão de voz GPT-Live via WebRTC. O servidor cria a sessão (client.live.create) e cuida
// de transcrições/delegação pelo sideband; o browser só carrega áudio e lê o canal de eventos.
import { api, MOCK } from '../api/client'
import { useYui } from '../store/yui'
import { attachStream, detachStream, getVoiceLevel } from './audioLevel'

let pc: RTCPeerConnection | null = null
let dc: RTCDataChannel | null = null
// microfone desejado ao conectar (push-to-talk pode já ter soltado a tecla)
let micWanted = true
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
  dc = null
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
    dc = pc.createDataChannel('oai-events')
    dc.onmessage = (m) => onChannelEvent(m.data)
    dc.onopen = () => applyMic()
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
    applyMic()
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
  micWanted = true
  setSt({ listening: false, liveConnecting: false, liveTranscript: '', voiceMode: 'off', liveMuted: false })
  setSt({ yst: useYui.getState().baseState() })
  if (notifyServer && (had || MOCK)) api.post('/api/live/end').catch(() => {})
}

// Botão do microfone: conversa contínua liga/desliga.
export function toggleLive() {
  const s = useYui.getState()
  if (s.listening || pc) void stopLive()
  else {
    micWanted = true
    setSt({ voiceMode: 'continuous' })
    void startLive()
  }
}

// Abre/fecha o microfone sem derrubar a sessão: track local desligada + mute no GPT-Live.
function applyMic() {
  const open = micWanted
  mic?.getAudioTracks().forEach((t) => (t.enabled = open))
  if (dc?.readyState === 'open') dc.send(JSON.stringify({ type: open ? 'session.input_audio.unmute' : 'session.input_audio.mute' }))
  const s = useYui.getState()
  s.set({ liveMuted: !open })
  if (!open && s.yst === 'listening') s.set({ yst: s.baseState() })
  if (open && (s.yst === 'idle' || s.yst === 'working')) s.set({ yst: 'listening' })
}

function setMic(open: boolean) {
  micWanted = open
  if (pc) applyMic()
}

// ---------- push-to-talk: segurar = falar; 3 toques rápidos = conversa contínua ----------
const TAP_MS = 250 // toque = soltou em menos que isso
const TAP_GAP_MS = 450 // intervalo máximo entre toques
let pressedAt = 0
let taps: number[] = []
let releaseTimer: ReturnType<typeof setTimeout> | undefined

export function pttDown() {
  const now = performance.now()
  pressedAt = now
  clearTimeout(releaseTimer)
  const s = useYui.getState()
  if (s.voiceMode === 'continuous') return // decide no keyup (toque simples encerra o contínuo)
  if (s.voiceMode === 'off') setSt({ voiceMode: 'ptt' })
  setMic(true)
  if (!pc) void startLive()
}

export function pttUp() {
  const now = performance.now()
  const isTap = now - pressedAt < TAP_MS
  const s = useYui.getState()
  if (isTap) {
    taps = [...taps.filter((t) => now - t < TAP_GAP_MS * 3), now]
    const third = taps.length >= 3 && taps.slice(-3).every((t, i, a) => i === 0 || t - a[i - 1] < TAP_GAP_MS)
    if (third && s.voiceMode !== 'continuous') {
      taps = []
      setSt({ voiceMode: 'continuous' })
      setMic(true)
      s.say('Conversa contínua ligada. Aperte espaço de novo para voltar ao modo segurar-para-falar.', { state: 'listening' })
      return
    }
    if (s.voiceMode === 'continuous') {
      // toque simples sai do contínuo (ignora os toques que compõem um triplo seguinte)
      if (taps.length === 1) {
        setSt({ voiceMode: 'ptt' })
        setMic(false)
      }
      return
    }
  } else taps = []
  if (s.voiceMode === 'ptt') {
    // pequena folga para não cortar o fim da frase; toques rápidos mantêm o mic aberto até decidir se é triplo
    releaseTimer = setTimeout(() => {
      if (useYui.getState().voiceMode === 'ptt') setMic(false)
    }, isTap ? TAP_GAP_MS : 300)
  }
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
