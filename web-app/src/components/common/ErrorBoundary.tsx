import { Component, type ErrorInfo, type ReactNode } from 'react'
import { GlobalError } from '@/components/common/GlobalError'

type ErrorBoundaryProps = {
  children: ReactNode
  /** Optional label for logging (e.g. "root", "chat"). */
  name?: string
  /** Optional custom fallback; defaults to GlobalError. */
  fallback?: (error: unknown, reset: () => void) => ReactNode
}

type ErrorBoundaryState = {
  error: unknown | null
}

/**
 * Catches render errors in the subtree so one failing component cannot
 * white-screen the entire application.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const label = this.props.name ?? 'ErrorBoundary'
    console.error(`[${label}] Uncaught render error:`, error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (error != null) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.reset)
      }
      return <GlobalError error={error} />
    }
    return this.props.children
  }
}
