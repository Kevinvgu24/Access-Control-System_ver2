import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Sidebar }         from '@/components/shell/Sidebar'
import { TopBar }          from '@/components/shell/TopBar'
import { LoginPage }       from '@/pages/LoginPage'
import { LabSelectorPage } from '@/pages/LabSelectorPage'
import { OverviewPage }    from '@/pages/OverviewPage'
import { UsersPage }       from '@/pages/UsersPage'
import { EnrollmentPage }  from '@/pages/EnrollmentPage'
import { SchedulesPage }   from '@/pages/SchedulesPage'
import { LogsPage }        from '@/pages/LogsPage'
import { SystemPage }      from '@/pages/SystemPage'
import { useAuthStore }    from '@/store/authStore'
import { useLabStore }     from '@/store/labStore'
import { useAdminStore }   from '@/store/adminStore'

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-dark flex items-center justify-center">
      <div className="flex items-center gap-3">
        <span className="blink w-2 h-2 rounded-full bg-green" />
        <span className="font-mono text-xs text-[#94a3b8] uppercase tracking-widest">Initializing...</span>
      </div>
    </div>
  )
}

function AuthenticatedApp() {
  const { selectedLabId, selectedLabName, closeMobileMenu } = useLabStore()
  const { admin, error, signOut } = useAuthStore()
  const subscribe = useAdminStore(s => s.subscribe)
  const systemStatus = useAdminStore(s => s.systemStatus)

  // Immediately optimize layout on initial page load and window resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        closeMobileMenu()
      }
    }
    // Run on initial mount immediately
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [closeMobileMenu])

  useEffect(() => {
    if (selectedLabId && selectedLabName) {
      return subscribe(selectedLabId, selectedLabName)
    }
  }, [selectedLabId, selectedLabName, subscribe])

  if (!admin) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-surface border border-red/20 rounded-lg p-7 flex flex-col gap-4 shadow-sm">
          <div>
            <p className="font-mono text-[11px] tracking-widest uppercase text-red mb-2">Access</p>
            <h1 className="text-2xl font-bold tracking-tight text-[#0f172a]">Admin Profile Required</h1>
            <p className="text-sm text-[#475569] mt-2">
              {error ?? 'This authenticated account is not mapped to an active admin profile.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void signOut() }}
            className="bg-red/10 border border-red/25 text-red hover:bg-red/20 font-semibold text-sm px-4 py-2.5 rounded cursor-pointer transition-colors self-start"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full max-w-full overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar />
        
        {systemStatus.overall === 'offline' ? (
          <div className="bg-[#fce8e8] border-b border-[#e06666]/30 px-4 sm:px-8 py-3.5 flex items-center justify-between text-[#e06666] shrink-0 gap-3">
            <div className="flex items-center gap-3 sm:gap-4">
              <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7 text-[#e06666] shrink-0" />
              <span className="text-sm sm:text-lg font-extrabold uppercase tracking-wider font-mono text-[#e06666] hidden sm:inline">System Alert:</span>
              <span className="text-xs sm:text-base font-bold text-[#e06666]">Device is currently offline. Please check power source or network connection.</span>
            </div>
            <div className="text-[10px] sm:text-xs font-mono uppercase px-2.5 py-1 sm:px-3.5 sm:py-1.5 bg-[#e06666] text-[#fce8e8] rounded font-black border border-[#e06666] shadow-sm animate-pulse shrink-0">
              SYSTEM OFFLINE
            </div>
          </div>
        ) : systemStatus.cameraState === 'disconnected' ? (
          <div className="bg-amber-50 border-b border-amber-300 px-4 sm:px-8 py-2.5 flex items-center justify-between text-amber-900 shrink-0 gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-xs sm:text-base font-extrabold uppercase tracking-wider font-mono text-amber-800">Service Alert:</span>
              <span className="text-xs sm:text-sm font-bold text-amber-800">Face recognition process is stopped. Please check or restart the application.</span>
            </div>
            <div className="text-[10px] font-mono uppercase px-2.5 py-1 bg-amber-500 text-white rounded font-bold border border-amber-600 shrink-0">
              CAMERA STOPPED
            </div>
          </div>
        ) : null}

        <main className="flex-1 overflow-y-auto p-3 sm:p-6 lg:p-8 pb-16 min-w-0 transition-all duration-300">
          <Routes>
            <Route path="/labs"    element={<LabSelectorPage />} />
            {selectedLabId ? (
              <>
                <Route path="/"           element={<Navigate to="/overview" replace />} />
                <Route path="/overview"   element={<OverviewPage />} />
                <Route path="/users"      element={<UsersPage />} />
                <Route path="/enrollment" element={<EnrollmentPage />} />
                <Route path="/schedules"  element={<SchedulesPage />} />
                <Route path="/logs"       element={<LogsPage />} />
                <Route path="/system"     element={<SystemPage />} />
              </>
            ) : (
              <Route path="*" element={<LabSelectorPage />} />
            )}
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  const { user, initialized, init } = useAuthStore()

  useEffect(() => {
    return init()
  }, [init])

  if (!initialized) return <LoadingScreen />

  return (
    <BrowserRouter>
      {user ? <AuthenticatedApp /> : <LoginPage />}
    </BrowserRouter>
  )
}
