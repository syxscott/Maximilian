import { useState, useEffect } from "react"

/**
 * 返回一个延迟更新的值，在指定时间内无新变化后才更新。
 * 用于搜索输入等场景，避免每次按键都触发请求。
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => {
      // Cancel the pending update so unmount doesn't trigger
      // "setState on unmounted component" warnings. The next mount of the
      // hook will start from `value` directly via `useState(value)`'s
      // initializer, so a brief unmount during a fast prop swap doesn't
      // lose the latest value.
      clearTimeout(timer)
    }
  }, [value, delay])

  return debouncedValue
}
