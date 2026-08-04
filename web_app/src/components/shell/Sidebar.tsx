import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore }  from '@/store/authStore'
import { useLabStore }   from '@/store/labStore'
import { useAdminStore } from '@/store/adminStore'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'

const IconChart    = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="12" width="4" height="8" rx="1"/><rect x="10" y="7" width="4" height="13" rx="1"/><rect x="17" y="3" width="4" height="17" rx="1"/></svg>;
const IconUser     = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IconPlus     = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>;
const IconCalendar = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const IconList     = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;
const IconGear     = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
const IconSwap     = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7 21 3 17 7 13"/><line x1="15" y1="17" x2="3" y2="17"/></svg>;

const NAV = [
  { href: '/overview',   icon: <IconChart />,    label: 'Dashboard'  },
  { href: '/users',      icon: <IconUser />,     label: 'Administrator' },
  { href: '/enrollment', icon: <IconPlus />,     label: 'Enrollment' },
  { href: '/schedules',  icon: <IconCalendar />, label: 'Schedules'  },
  { href: '/logs',       icon: <IconList />,     label: 'Logs'       },
  { href: '/system',     icon: <IconGear />,     label: 'System'     },
]

export function Sidebar() {
  const { admin, signOut } = useAuthStore()
  const { 
    selectedLabId, 
    clearLab, 
    setWarning,
    sidebarCollapsed,
    toggleSidebar,
    mobileMenuOpen,
    closeMobileMenu
  } = useLabStore()
  
  const systemStatus = useAdminStore(s => s.systemStatus)
  const navigate     = useNavigate()

  const handleSignOut = async () => {
    clearLab()
    closeMobileMenu()
    await signOut()
  }

  const statusDot = systemStatus.overall === 'online'
    ? 'bg-green' : systemStatus.overall === 'grace_period'
    ? 'bg-amber' : 'bg-red'

  // Fluid width class: full width on desktop/tablet during moderate zoom, icon-only only if manually collapsed
  const sidebarWidthClass = sidebarCollapsed ? 'w-16 md:w-20' : 'w-[200px] lg:w-[220px]'

  return (
    <>
      {/* Mobile Drawer Overlay Backdrop */}
      {mobileMenuOpen && (
        <div 
          onClick={closeMobileMenu}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden transition-opacity"
        />
      )}

      {/* Main Sidebar Element */}
      <aside className={`
        fixed md:sticky top-0 left-0 z-50 h-screen shrink-0 flex flex-col bg-darker border-r border-line
        transition-all duration-300 ease-in-out
        ${sidebarWidthClass}
        ${mobileMenuOpen ? 'translate-x-0 w-[240px]' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Header */}
        <div className={`px-3.5 py-4 border-b border-line flex items-center ${sidebarCollapsed && !mobileMenuOpen ? 'justify-center' : 'justify-between'}`}>
          <button 
            onClick={() => { closeMobileMenu(); navigate('/labs'); }}
            className="flex items-center gap-2.5 text-left group hover:opacity-80 transition-all cursor-pointer overflow-hidden"
            title="Return to Switch Lab page"
          >
            <div className="w-8 h-8 lg:w-9 lg:h-9 rounded-lg bg-[#ea580c] flex items-center justify-center text-white shadow-sm shrink-0 border-2 border-[#ffedd5]">
              <span className="font-black text-[11px] lg:text-[12px] tracking-widest">VGU</span>
            </div>
            {(!sidebarCollapsed || mobileMenuOpen) && (
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`blink w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} />
                  <span className={`font-mono text-[9px] tracking-widest uppercase ${systemStatus.overall === 'online' ? 'text-green' : 'text-amber'}`}>
                    {systemStatus.overall === 'online' ? 'Live' : systemStatus.overall}
                  </span>
                </div>
                <p className="text-[14px] lg:text-[15px] font-bold tracking-tight text-[#0f172a] leading-tight group-hover:text-[#ea580c] transition-colors truncate">
                  Smart Lab
                </p>
              </div>
            )}
          </button>

          {/* Desktop Collapse Toggle */}
          {!mobileMenuOpen && (
            <button
              onClick={toggleSidebar}
              className="hidden md:flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
              title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          )}

          {/* Mobile Close Button */}
          {mobileMenuOpen && (
            <button
              onClick={closeMobileMenu}
              className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation Links (Labels always visible during moderate zoom/resize) */}
        <nav className="flex flex-col p-2 gap-1 flex-1 overflow-y-auto custom-scrollbar">
          {NAV.map(({ href, icon, label }) => (
            <NavLink 
              key={href} 
              to={href}
              onClick={(e) => {
                closeMobileMenu()
                if (!selectedLabId) {
                  e.preventDefault()
                  setWarning('You must choose a lab to continue')
                }
              }}
              title={sidebarCollapsed && !mobileMenuOpen ? label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs lg:text-sm font-bold font-sans transition-all cursor-pointer ${
                  sidebarCollapsed && !mobileMenuOpen ? 'justify-center' : ''
                } ${
                  isActive 
                    ? 'bg-orange-500 text-white shadow-sm font-black' 
                    : 'text-slate-700 hover:bg-slate-200 hover:text-slate-900 font-bold'
                }`
              }
            >
              <span className="text-base lg:text-lg leading-none shrink-0">{icon}</span>
              {(!sidebarCollapsed || mobileMenuOpen) && (
                <span className="truncate">{label}</span>
              )}
            </NavLink>
          ))}

          {/* Switch Lab Button */}
          <button
            onClick={() => { closeMobileMenu(); clearLab(); navigate('/labs'); }}
            title={sidebarCollapsed && !mobileMenuOpen ? 'Switch Lab' : undefined}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs lg:text-sm font-medium transition-all text-[#475569] hover:text-[#334155] hover:bg-slate-200 mt-1 cursor-pointer ${
              sidebarCollapsed && !mobileMenuOpen ? 'justify-center' : ''
            }`}
          >
            <span className="text-base lg:text-lg leading-none shrink-0 flex items-center justify-center"><IconSwap /></span>
            {(!sidebarCollapsed || mobileMenuOpen) && (
              <span className="truncate">Switch Lab</span>
            )}
          </button>
        </nav>

        {/* Footer Admin Profile Info */}
        <div className={`px-3.5 py-3 border-t border-line flex flex-col gap-0.5 ${sidebarCollapsed && !mobileMenuOpen ? 'items-center text-center' : ''}`}>
          {(!sidebarCollapsed || mobileMenuOpen) ? (
            <>
              <p className="font-mono text-[9px] lg:text-[10px] text-[#94a3b8] uppercase tracking-wider truncate">
                {admin?.type === 'super_admin' ? 'Super Admin' : 'Lab Admin'}
              </p>
              <button
                onClick={handleSignOut}
                className="font-mono text-[10px] lg:text-[11px] text-[#475569] hover:text-red transition-colors cursor-pointer text-left font-bold"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="font-mono text-[9px] text-[#475569] hover:text-red transition-colors cursor-pointer font-bold"
            >
              Exit
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
