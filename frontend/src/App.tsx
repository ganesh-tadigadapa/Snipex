import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, RefreshCw, ShieldCheck, Timer, Zap } from 'lucide-react'
import { fetchCapabilities, type Capabilities } from './lib/api'
import { Converter } from './components/Converter'
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
          {/* Hero */}
          <section id="convert" className="relative overflow-hidden pt-32 pb-16 sm:pt-40">
            <div className="ambient pointer-events-none absolute inset-0" aria-hidden />
            <div className="grid-lines pointer-events-none absolute inset-0" aria-hidden />
            <div className="relative mx-auto max-w-4xl px-4 sm:px-6">
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="text-center">
                <a href="#formats" className="mb-7 inline-flex items-center gap-2 rounded-full border border-line bg-card/70 py-1 pr-3 pl-1 text-xs text-fg-2 backdrop-blur transition-colors hover:border-line-2">
                  <span className="rounded-full bg-violet/20 px-2 py-0.5 font-medium text-lavender">New</span>
                  {caps ? `${caps.conversions.length} conversion routes, all tested` : 'Universal file conversion'}
                </a>
                <h1 className="text-[44px] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-7xl">
                  Every File.
                  <br />
                  <span className="text-gradient">Any Format.</span>
                </h1>
                <p className="mx-auto mt-6 max-w-2xl text-base text-pretty text-fg-2 sm:text-lg">
                  Convert documents, presentations, spreadsheets, images and more. Upload multiple files, select your desired format
                  and get everything converted in one go.
                </p>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.12 }} className="mt-12">
                {caps ? (
                  <Converter caps={caps} onHistoryChange={bumpHistory} />
                ) : error ? (
                  <div className="rounded-[28px] border border-danger/30 bg-card/80 p-10 text-center">
                    <AlertTriangle className="mx-auto mb-3 size-8 text-danger" />
                    <p className="font-semibold">{error}</p>
                    <p className="mt-1 text-sm text-fg-2">Make sure the SNIPEX API is running, then try again.</p>
                    <button onClick={load} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-card-2 px-4 text-sm font-medium hover:border-line-2">
                      <RefreshCw className="size-4" /> Retry
                    </button>
                  </div>
                ) : (
                  <div className="rounded-[28px] border border-line bg-card/80 p-5" aria-busy="true" aria-label="Loading converter">
                    <div className="skeleton h-[300px] rounded-[20px]" />
                  </div>
                )}
              </motion.div>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-fg-3">
                <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-lavender" /> Files verified & sandboxed</span>
                <span className="flex items-center gap-1.5"><Timer className="size-3.5 text-lavender" /> Auto-deleted after {caps?.limits.retention_minutes ?? 60} min</span>
                <span className="flex items-center gap-1.5"><Zap className="size-3.5 text-lavender" /> No sign-up required</span>
              </div>
            </div>
          </section>

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
