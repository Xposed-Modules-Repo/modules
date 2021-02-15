import { useState, useEffect } from 'react'

export function debounce<T extends []> (fn: (...args: T) => void, delay: number): (...args: T) => void {
  const callback = fn
  let timerId = 0

  function debounced (...args: T): void {
    clearTimeout(timerId)
    timerId = setTimeout(() => {
      callback.apply(this, args)
    }, delay) as any
  }

  return debounced
}

export function useDebounce<T> (value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(
    () => {
      const handler = setTimeout(() => {
        setDebouncedValue(value)
      }, delay)
      return () => {
        clearTimeout(handler)
      }
    },
    [value]
  )
  return debouncedValue
}
