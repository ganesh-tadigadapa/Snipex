import { useCallback, useEffect, useState } from 'react'
import { fetchCapabilities, type Capabilities } from './lib/api'
import { Hero } from './components/Hero'
import { FAQ, Features, Footer, HowItWorks, Nav, RecentHistory, SupportedFormats, type Page } from './components/Sections'
import { ToolsPage } from './components/ToolsPage'
import { ToastProvider } from './components/ui'

/** "#/tools" is page 2; everything else ("#/", "#formats", …) belongs to page 1. */
function pageFromHash(): Page {
  return window.location.hash.startsWith('#/tools') ? 'tools' : 'home'
}

export default function App() {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const bumpHistory = useCallback(() => setHistoryVersion((v) => v + 1), [])
  const [page, setPage] = useState<Page>(pageFromHash)
  // While files are loaded (converter) or a tool is open, the page is a focused view.
  const [focused, setFocused] = useState(false)

  const load = useCallback(() => {
    setError(null)
    fetchCapabilities()
      .then(setCaps)
      .catch(() => setError('The conversion service is not reachable right now.'))
  }, [])
  useEffect(load, [load])

  useEffect(() => {
    const onHash = () => {
      const next = pageFromHash()
      setPage((prev) => {
        if (prev !== next) {
          setFocused(false)
          window.scrollTo(0, 0)
        }
        return next
      })
      // Section links (e.g. #formats) from page 2: scroll once page 1 has rendered.
      const id = window.location.hash.slice(1)
      if (id && !id.startsWith('/')) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }))
      else if (id === '/' || id === '') window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <ToastProvider>
      <div id="top" className="relative min-h-screen">
        <Nav focused={focused} page={page} />
        {page === 'tools' ? (
          <main>
            <ToolsPage caps={caps} onHistoryChange={bumpHistory} onFocusChange={setFocused} />
          </main>
        ) : (
          <>
            <main>
              <Hero caps={caps} error={error} onRetry={load} onHistoryChange={bumpHistory} onFocusChange={setFocused} />
              {!focused && (
                <>
                  <RecentHistory version={historyVersion} onChange={bumpHistory} />
                  <SupportedFormats caps={caps} />
                  <Features />
                  <HowItWorks />
                  <FAQ caps={caps} />
                </>
              )}
            </main>
            {!focused && <Footer />}
          </>
        )}
      </div>
    </ToastProvider>
  )
}
