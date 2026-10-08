import React from 'react'
import ReactDOM from 'react-dom/client'
import { lazy, Suspense } from 'react'
import ErrorBoundary from './ErrorBoundary'
import './index.css'

const App = lazy(() => import('./App'))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div className="recovery-screen" role="status"><div className="recovery-card"><span className="recovery-brand">YU-Prep</span><h2>Загрузка рабочего пространства…</h2><p>Подготавливаем инструменты и 3D Viewer.</p><button className="wide-secondary" onClick={() => window.location.reload()}>Повторить загрузку</button></div></div>}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
)
