import { Component, type ErrorInfo, type ReactNode } from "react"
import { cn } from "../lib/utils.js"

export interface ErrorFallbackProps {
  error: Error
  resetError: () => void
}

export interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: (props: ErrorFallbackProps) => ReactNode
  onError?: (error: Error, info: ErrorInfo) => void
  className?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  private resetError = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({
          error: this.state.error,
          resetError: this.resetError,
        })
      }
      return (
        <DefaultErrorFallback
          className={this.props.className}
          error={this.state.error}
          resetError={this.resetError}
        />
      )
    }
    return this.props.children
  }
}

export interface DefaultErrorFallbackProps extends ErrorFallbackProps {
  className?: string
}

export function DefaultErrorFallback({
  error,
  resetError,
  className,
}: DefaultErrorFallbackProps) {
  return (
    <div
      role="alert"
      data-component="error-boundary"
      data-variant="default"
      className={cn(
        "flex flex-col items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4",
        className,
      )}
    >
      <div data-slot="error-boundary-title" className="text-sm font-semibold text-destructive">
        Something went wrong
      </div>
      <pre
        data-slot="error-boundary-message"
        className="max-h-48 w-full overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 text-xs"
      >
        {error.message}
      </pre>
      <button
        type="button"
        data-slot="error-boundary-reset"
        onClick={resetError}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Try again
      </button>
    </div>
  )
}