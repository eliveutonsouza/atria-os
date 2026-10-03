// Amplitude RMS (0..1) de streams de áudio via Web Audio AnalyserNode.
type Src = 'local' | 'remote'

let ctx: AudioContext | null = null
const analysers: Partial<Record<Src, { node: AnalyserNode; source: MediaStreamAudioSourceNode; buf: Float32Array<ArrayBuffer> }>> = {}

function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function attachStream(src: Src, stream: MediaStream) {
  detachStream(src)
  const ac = audioCtx()
  const source = ac.createMediaStreamSource(stream)
  const node = ac.createAnalyser()
  node.fftSize = 512
  node.smoothingTimeConstant = 0.6
  source.connect(node)
  analysers[src] = { node, source, buf: new Float32Array(new ArrayBuffer(node.fftSize * 4)) }
}

export function detachStream(src: Src) {
  const a = analysers[src]
  if (!a) return
  try {
    a.source.disconnect()
  } catch {
    /* já desconectado */
  }
  delete analysers[src]
}

/** null = sem stream real para esse lado (engine usa o seno do design). */
export function getVoiceLevel(src: Src | null): number | null {
  if (!src) return null
  const a = analysers[src]
  if (!a) return null
  a.node.getFloatTimeDomainData(a.buf)
  let sum = 0
  for (let i = 0; i < a.buf.length; i++) sum += a.buf[i] * a.buf[i]
  return Math.sqrt(sum / a.buf.length)
}
