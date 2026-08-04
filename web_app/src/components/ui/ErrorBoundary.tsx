import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught component error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-surface border border-red/20 rounded-xl my-6 mx-auto max-w-lg shadow-sm">
          <div className="w-12 h-12 rounded-full bg-red/10 text-red flex items-center justify-center text-xl font-bold mb-3">
            !
          </div>
          <h2 className="text-lg font-bold text-[#0f172a] mb-1">Something went wrong</h2>
          <p className="font-mono text-xs text-[#94a3b8] text-center mb-4 leading-relaxed">
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs px-4 py-2 rounded transition-colors cursor-pointer"
          >
            Reload Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
