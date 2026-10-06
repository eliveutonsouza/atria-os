import { useYui, type Device } from '../store/yui'
import { setOrbAppBottom } from '../yui/orbEngine'

// Classe de dispositivo + teclado virtual. Celular deitado continua "phone" (menor lado < 600 com toque);
// tablet = até 1180 de largura ou toque até 1366; o resto é desktop.

const mq = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false)

export function computeDevice(w: number, h: number): { device: Device; coarse: boolean } {
  const coarse = mq('(pointer: coarse)')
  const short = Math.min(w, h)
  let device: Device = 'desktop'
  if (w < 600 || (coarse && short < 600)) device = 'phone'
  else if (w < 1180 || (coarse && w <= 1366)) device = 'tablet'
  return { device, coarse }
}

export const isStandalone = () => mq('(display-mode: standalone)') || (navigator as Navigator & { standalone?: boolean }).standalone === true

function apply() {
  const w = window.innerWidth
  const h = window.innerHeight
  const { device, coarse } = computeDevice(w, h)
  const vv = window.visualViewport
  const vvh = vv ? vv.height : h
  // teclado = o quanto a viewport visual encolheu em relação à janela (iOS não muda innerHeight)
  const kb = vv ? Math.max(0, Math.round(h - vv.height - vv.offsetTop)) : 0
  const keyboardOpen = coarse && kb > 120
  const root = document.documentElement
  root.style.setProperty('--vvh', `${Math.round(vvh)}px`)
  root.style.setProperty('--kb', `${keyboardOpen ? kb : 0}px`)
  root.classList.toggle('is-phone', device === 'phone')
  root.classList.toggle('is-tablet', device === 'tablet')
  root.classList.toggle('is-desktop', device === 'desktop')
  root.classList.toggle('is-coarse', coarse)
  root.classList.toggle('is-standalone', isStandalone())
  root.classList.toggle('kb-open', keyboardOpen)
  // safe area de baixo em px (env() só existe no CSS: mede com um elemento de prova)
  let probe = document.getElementById('sab-probe')
  if (!probe) {
    probe = document.createElement('div')
    probe.id = 'sab-probe'
    probe.style.cssText = 'position:fixed;left:-99px;bottom:0;width:1px;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none'
    document.body.appendChild(probe)
  }
  const sab = probe.offsetHeight
  setOrbAppBottom(device !== 'phone' ? 0 : keyboardOpen ? kb : 58 + sab)
  const s = useYui.getState()
  const narrow = device === 'phone'
  const shortH = h < 760
  if (s.device !== device || s.coarse !== coarse || s.narrow !== narrow || s.short !== shortH || s.keyboardOpen !== keyboardOpen) {
    s.set({ device, coarse, narrow, short: shortH, keyboardOpen })
  }
}

/** Liga os ouvintes (resize, rotação, teclado). Devolve a função de desligar. */
export function trackDevice(): () => void {
  apply()
  const vv = window.visualViewport
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  vv?.addEventListener('resize', apply)
  vv?.addEventListener('scroll', apply)
  return () => {
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', apply)
    vv?.removeEventListener('resize', apply)
    vv?.removeEventListener('scroll', apply)
  }
}
