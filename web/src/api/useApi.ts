import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './client'

export interface ApiState<T> {
  data: T | null
  error: ApiError | Error | null
  loading: boolean
  reload: () => void
}

/** Busca `path` ao montar e quando `deps` mudam. `path` null = não buscar. */
export function useApi<T>(path: string | null, deps: unknown[] = [], pollMs = 0): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const [loading, setLoading] = useState<boolean>(!!path)
  const seq = useRef(0)

  const load = useCallback(
    (silent = false) => {
      if (!path) {
        setLoading(false)
        return
      }
      const my = ++seq.current
      if (!silent) setLoading(true)
      api
        .get<T>(path)
        .then((d) => {
          if (my !== seq.current) return
          setData(d)
          setError(null)
        })
        .catch((e) => {
          if (my !== seq.current) return
          setError(e)
        })
        .finally(() => {
          if (my === seq.current) setLoading(false)
        })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, ...deps],
  )

  useEffect(() => {
    setData(null)
    load()
  }, [load])

  useEffect(() => {
    if (!pollMs || !path) return
    const id = setInterval(() => load(true), pollMs)
    return () => clearInterval(id)
  }, [load, pollMs, path])

  return { data, error, loading, reload: () => load(true) }
}
