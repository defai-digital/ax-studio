import { createContext, useContext } from 'react'
import type { Context } from 'react'

export function createStrictContext<T>(
  errorMessage: string
): [Context<T | null>, () => T] {
  const context = createContext<T | null>(null)

  function useStrictContext(): T {
    const value = useContext(context)
    if (!value) {
      throw new Error(errorMessage)
    }
    return value
  }

  return [context, useStrictContext]
}
