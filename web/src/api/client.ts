import { useYui } from '../store/yui'

export const MOCK = import.meta.env.VITE_MOCK === '1'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (MOCK) {
    const { mockRequest } = await import('../mock/mockApi')
    return mockRequest<T>(method, path, body)
  }
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    useYui.getState().set({ authed: false })
    throw new ApiError(401, 'unauthorized')
  }
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = await res.json()
      msg = j.error || j.message || msg
    } catch {
      /* corpo vazio */
    }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204 || res.status === 202) {
    const txt = await res.text()
    return (txt ? JSON.parse(txt) : undefined) as T
  }
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = void>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T = void>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T = void>(path: string) => request<T>('DELETE', path),
}
