// PWA: registro do service worker, atualização, instalação e notificações push.
import { api } from '../api/client'
import { useYui } from '../store/yui'

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let installEvent: BIPEvent | null = null
let waiting: ServiceWorker | null = null

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installEvent = e as BIPEvent
    useYui.getState().set({ canInstall: true })
  })
  window.addEventListener('appinstalled', () => {
    installEvent = null
    useYui.getState().set({ canInstall: false })
  })
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      const watch = (w: ServiceWorker | null) => {
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = w
            useYui.getState().set({ updateReady: true })
          }
        })
      }
      if (reg.waiting && navigator.serviceWorker.controller) {
        waiting = reg.waiting
        useYui.getState().set({ updateReady: true })
      }
      reg.addEventListener('updatefound', () => watch(reg.installing))
      setInterval(() => reg.update().catch(() => {}), 30 * 60_000)
      refreshPushState(reg)
    })
    .catch(() => {})
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloaded && useYui.getState().updateReady) {
      reloaded = true
      location.reload()
    }
  })
  // clique numa notificação com o app aberto → navega sem recarregar
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'yui.navigate') {
      const u = new URL(e.data.url)
      history.pushState({}, '', u.pathname + u.search)
      dispatchEvent(new PopStateEvent('popstate'))
    }
  })
  // presença: servidor só manda push quando nenhuma tela do console está visível
  const presence = () => {
    if (document.visibilityState === 'visible') api.post('/api/push/presence').catch(() => {})
  }
  document.addEventListener('visibilitychange', presence)
  setInterval(presence, 30_000)
  presence()
}

export function applyUpdate() {
  waiting?.postMessage('skipWaiting')
}

export async function promptInstall(): Promise<'ios' | 'accepted' | 'dismissed' | 'unavailable'> {
  if (isStandalone()) return 'unavailable'
  if (installEvent) {
    await installEvent.prompt()
    const { outcome } = await installEvent.userChoice
    installEvent = null
    useYui.getState().set({ canInstall: false })
    return outcome === 'accepted' ? 'accepted' : 'dismissed'
  }
  return isIOS() ? 'ios' : 'unavailable'
}

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function refreshPushState(reg?: ServiceWorkerRegistration) {
  if (!pushSupported()) return
  const r = reg ?? (await navigator.serviceWorker.ready)
  const sub = await r.pushManager.getSubscription()
  useYui.getState().set({ pushEnabled: !!sub && Notification.permission === 'granted' })
}

export async function enablePush(): Promise<string> {
  if (!pushSupported()) return isIOS() && !isStandalone() ? 'No iPhone, instale o app na tela inicial primeiro (Compartilhar → Adicionar à Tela de Início).' : 'Este navegador não suporta notificações push.'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'Notificações bloqueadas — libere nas configurações do navegador.'
  const reg = await navigator.serviceWorker.ready
  const { key } = await api.get<{ key: string }>('/api/push/key')
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }))
  await api.post('/api/push/subscribe', { subscription: sub.toJSON(), device: deviceLabel() })
  useYui.getState().set({ pushEnabled: true })
  return 'Notificações ativadas neste dispositivo.'
}

export async function disablePush(): Promise<string> {
  if (!pushSupported()) return 'Sem suporte a push aqui.'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
    await sub.unsubscribe()
  }
  useYui.getState().set({ pushEnabled: false })
  return 'Notificações desativadas neste dispositivo.'
}

export async function testPush(): Promise<string> {
  await api.post('/api/push/test')
  return 'Enviei uma notificação de teste.'
}

function deviceLabel() {
  const ua = navigator.userAgent
  const os = /android/i.test(ua) ? 'Android' : isIOS() ? 'iOS' : /mac/i.test(ua) ? 'macOS' : /win/i.test(ua) ? 'Windows' : /linux/i.test(ua) ? 'Linux' : 'Dispositivo'
  const br = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Navegador'
  return `${os} · ${br}${isStandalone() ? ' (app)' : ''}`
}
