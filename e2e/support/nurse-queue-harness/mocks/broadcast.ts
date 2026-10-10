import { useEffect, useRef, useState } from 'react'

/**
 * Stand-in for lib/hooks/useQueueBroadcast.ts: the test fires pings with window.__harness.fireQueueChange()
 * and drops/restores the connection with setOnline(). Like the real hook, it calls onChange once when it
 * (re)subscribes and reads onChange through a ref.
 */
export function useQueueBroadcast(serviceId: string, onChange: () => void | Promise<void>) {
  const h = window.__harness
  const [online, setOnline] = useState(h.online)
  const ref = useRef(onChange)
  useEffect(() => {
    ref.current = onChange
  })

  useEffect(() => {
    const listener = () => void ref.current()
    h.queueListeners.push(listener)
    h.onlineListeners.push(setOnline)
    const initial = setTimeout(listener, 0)
    return () => {
      clearTimeout(initial)
      h.queueListeners.splice(h.queueListeners.indexOf(listener), 1)
      h.onlineListeners.splice(h.onlineListeners.indexOf(setOnline), 1)
    }
  }, [serviceId, h])

  return { online }
}
