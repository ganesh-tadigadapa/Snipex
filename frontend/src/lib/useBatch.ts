import { useEffect, useRef, useState } from 'react'
import { getBatch, type Batch } from './api'

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

export const isTerminal = (b: Batch | null) => !!b && TERMINAL.has(b.status)

/** Polls a batch until it reaches a terminal status. Returns the latest snapshot. */
export function useBatchPolling(initial: Batch | null, token: string | null, onError?: (e: Error) => void) {
  const [batch, setBatch] = useState<Batch | null>(initial)
  const errRef = useRef(onError)
  errRef.current = onError

  useEffect(() => {
    setBatch(initial)
  }, [initial])

  useEffect(() => {
    if (!initial || !token || isTerminal(initial)) return
    let stopped = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const b = await getBatch(initial.id, token)
        if (stopped) return
        failures = 0
        setBatch(b)
        if (TERMINAL.has(b.status)) return
      } catch (e) {
        failures += 1
        if (failures >= 5) {
          errRef.current?.(e as Error)
          return
        }
      }
      timer = setTimeout(tick, 700)
    }
    timer = setTimeout(tick, 350)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [initial, token])

  return batch
}
