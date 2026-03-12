import React, { Component, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '12px', fontFamily: 'system-ui, sans-serif', color: '#ccc' }}>
          <div style={{ fontSize: '14px', color: '#f87171' }}>Something went wrong</div>
          <div style={{ fontSize: '12px', color: '#666', maxWidth: '400px', textAlign: 'center' }}>{(this.state.error as Error).message}</div>
          <button onClick={() => window.location.reload()} style={{ marginTop: '8px', padding: '6px 16px', background: '#3f3f46', border: '1px solid #52525b', borderRadius: '6px', color: '#e4e4e7', cursor: 'pointer', fontSize: '13px' }}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster theme="dark" position="bottom-right" />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
