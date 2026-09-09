import { useEffect, useRef, useState } from "react"

type SpringOptions = {
  visualDuration?: number
  bounce?: number
  stiffness?: number
  damping?: number
  mass?: number
  velocity?: number
}

type Opt = Partial<SpringOptions>

type SpringHandle = {
  set: (v: number) => void
  get: () => number
  on: (event: "change", cb: (v: number) => void) => () => void
  destroy: () => void
}

function createMotionValue(initial: number): SpringHandle {
  let value = initial
  const listeners = new Set<(v: number) => void>()
  return {
    set: (v: number) => {
      if (v === value) return
      value = v
      listeners.forEach((l) => l(v))
    },
    get: () => value,
    on: (_event, cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    destroy: () => {
      listeners.clear()
    },
  }
}

type AttachArgs = {
  stiffness?: number
  damping?: number
  mass?: number
  velocity?: number
  visualDuration?: number
  bounce?: number
}

function attachSpring(
  spring: SpringHandle,
  source: SpringHandle,
  options?: AttachArgs,
): () => void {
  let cancelled = false
  let raf = 0

  const cleanup = () => {
    cancelled = true
    if (raf) cancelAnimationFrame(raf)
  }

  const tick = () => {
    if (cancelled) return
    const target = source.get()
    const current = spring.get()
    const stiffness = options?.stiffness ?? 170
    const damping = options?.damping ?? 26
    const mass = options?.mass ?? 1
    const dt = 1 / 60

    const delta = current - target
    const acceleration = -(stiffness * delta) / mass - (damping * (options?.velocity ?? 0)) / mass
    const next = current + (options?.velocity ?? 0) * dt + 0.5 * acceleration * dt * dt
    const nextVelocity = (next - current) / dt

    spring.set(next)

    if (Math.abs(delta) < 0.001) {
      spring.set(target)
      return
    }
    raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)
  return cleanup
}

function eqOptions(a: Opt | undefined, b: Opt | undefined) {
  return (
    a?.visualDuration === b?.visualDuration &&
    a?.bounce === b?.bounce &&
    a?.stiffness === b?.stiffness &&
    a?.damping === b?.damping &&
    a?.mass === b?.mass &&
    a?.velocity === b?.velocity
  )
}

export function useSpring(target: number, options?: Opt | (() => Opt)): number {
  const [value, setValue] = useState(target)
  const sourceRef = useRef<SpringHandle>(createMotionValue(target))
  const springRef = useRef<SpringHandle>(createMotionValue(target))
  const configRef = useRef<Opt | undefined>(
    typeof options === "function" ? options() : options,
  )
  const stopRef = useRef<(() => void) | null>(null)
  const offRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    offRef.current = springRef.current.on("change", (next) => setValue(next))
    stopRef.current = attachSpring(springRef.current, sourceRef.current, configRef.current)
    return () => {
      offRef.current?.()
      stopRef.current?.()
      springRef.current.destroy()
      sourceRef.current.destroy()
    }
  }, [])

  useEffect(() => {
    sourceRef.current.set(target)
  }, [target])

  useEffect(() => {
    if (!options) return
    const next = typeof options === "function" ? options() : options
    if (eqOptions(configRef.current, next)) return
    configRef.current = next
    stopRef.current?.()
    stopRef.current = attachSpring(springRef.current, sourceRef.current, next)
    setValue(springRef.current.get())
  }, [options])

  return value
}