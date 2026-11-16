import { useCallback, useEffect, useState } from 'react'
import { fetchCapabilities, type Capabilities } from './lib/api'
import { Hero } from './components/Hero'
import { FAQ, Features, Footer, HowItWorks, Nav, RecentHistory, SupportedFormats } from './components/Sections'
import { Tools } from './components/Tools'
import { ToastProvider } from './components/ui'

export default function App() {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const bumpHistory = useCallback(() => setHistoryVersion((v) => v + 1), [])

  const load = useCallback(() => {
    setError(null)
    fetchCapabilities()
      .then(setCaps)
      .catch(() => setError('The conversion service is not reachable right now.'))
  }, [])
  useEffect(load, [load])

  return (
    <ToastProvider>
      <div id="top" className="relative min-h-screen">
        <Nav />
        <main>
          <Hero caps={caps} error={error} onRetry={load} onHistoryChange={bumpHistory} />

          <RecentHistory version={historyVersion} onChange={bumpHistory} />
          <SupportedFormats caps={caps} />
          <Features />
          <Tools caps={caps} onHistoryChange={bumpHistory} />
          <HowItWorks />
          <FAQ caps={caps} />
        </main>
        <Footer />
      </div>
    </ToastProvider>
  )
}
