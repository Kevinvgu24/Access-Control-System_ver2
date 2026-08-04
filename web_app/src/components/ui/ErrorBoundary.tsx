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

  private handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  private handleResetCache = () => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch (e) {
      console.error('Failed to clear storage:', e)
    }
    window.location.href = '/labs'
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-surface border border-red/30 rounded-xl my-6 mx-auto max-w-xl shadow-lg">
          <div className="w-12 h-12 rounded-full bg-red/10 text-red flex items-center justify-center text-xl font-bold mb-3">
            !
          </div>
          <h2 className="text-lg font-bold text-[#0f172a] mb-1">System Notice: Render Error</h2>
          <div className="bg-red-50 border border-red-200 rounded p-3 my-3 w-full text-left overflow-auto max-h-36">
            <p className="font-mono text-xs text-red-700 font-bold break-all">
              {this.state.error?.name}: {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
          </div>
          <p className="text-xs text-[#475569] text-center mb-5 leading-relaxed">
            If reloading the page does not resolve the issue, click <strong>Reset App Cache & Lab Selection</strong> to clear stored session data.
          </p>
          <div className="flex gap-3 flex-wrap justify-center">
            <button
              onClick={this.handleReload}
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs px-5 py-2.5 rounded transition-colors cursor-pointer"
            >
              Reload Page
            </button>
            <button
              onClick={this.handleResetCache}
              className="bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs px-5 py-2.5 rounded transition-colors cursor-pointer"
            >
              Reset App Cache & Select Lab
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
