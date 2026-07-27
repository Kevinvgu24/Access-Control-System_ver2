import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useLabStore }  from '@/store/labStore'
import { useAdminStore } from '@/store/adminStore'

const IconChart = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>;
const IconUser = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IconPlus = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>;
const IconCalendar = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const IconList = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;
const IconGear = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
const IconSwap = () => <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7 21 3 17 7 13"/><line x1="15" y1="17" x2="3" y2="17"/></svg>;

const NAV = [
  { href: '/overview',   icon: <IconChart />, label: 'Dashboard'  },
  { href: '/users',      icon: <IconUser />, label: 'Administrator' },
  { href: '/enrollment', icon: <IconPlus />, label: 'Enrollment' },
  { href: '/schedules',  icon: <IconCalendar />, label: 'Schedules'  },
  { href: '/logs',       icon: <IconList />, label: 'Logs'       },
  { href: '/system',     icon: <IconGear />, label: 'System'     },
]

export function Sidebar() {
  const { admin, signOut }          = useAuthStore()
  const { selectedLabId, selectedLabName, clearLab, setWarning } = useLabStore()
  const systemStatus                  = useAdminStore(s => s.systemStatus)
  const navigate                      = useNavigate()

  const handleSignOut = async () => {
    clearLab()
    await signOut()
  }

  const statusDot = systemStatus.overall === 'online'
    ? 'bg-green' : systemStatus.overall === 'grace_period'
    ? 'bg-amber' : 'bg-red'

  return (
    <aside className="w-[220px] shrink-0 flex flex-col h-screen sticky top-0 bg-darker border-r border-line">
      <div className="px-6 py-6 border-b border-line">
        <div className="flex items-center gap-2 mb-4">
          <span className={`blink w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
          <span className={`font-mono text-[10px] tracking-widest uppercase ${systemStatus.overall === 'online' ? 'text-green' : 'text-amber'}`}>
            {systemStatus.overall === 'online' ? 'Live' : systemStatus.overall}
          </span>
        </div>
        
        <button 
          onClick={() => navigate('/labs')}
          className="flex items-center gap-3 text-left group hover:opacity-80 transition-all w-full cursor-pointer"
          title="Return to Switch Lab page"
        >
          <div className="w-10 h-10 rounded-lg bg-[#ea580c] flex items-center justify-center text-white shadow-sm shrink-0 border-2 border-[#ffedd5]">
            <span className="font-black text-[13px] tracking-widest">VGU</span>
          </div>
          <p className="text-[17px] font-bold tracking-tight text-[#0f172a] leading-tight group-hover:text-[#ea580c] transition-colors">
            Smart Lab
          </p>
        </button>
      </div>

      <nav className="flex flex-col p-3 gap-2 flex-1">
        {NAV.map(({ href, icon, label }) => (
          <NavLink key={href} to={href}
            onClick={(e) => {
              if (!selectedLabId) {
                e.preventDefault()
                setWarning('You must choose a lab to continue')
              }
            }}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[15px] font-bold font-sans transition-all cursor-pointer ${
                isActive 
                  ? 'bg-orange-500 text-white shadow-sm font-black' 
                  : 'text-slate-700 hover:bg-slate-200 hover:text-slate-900 font-bold'
              }`
            }
          >
            <span className="text-[18px] leading-none shrink-0">{icon}</span>
            <span className="truncate">{label}</span>
          </NavLink>
        ))}


        {/* Switch lab */}
        <button
          onClick={() => { clearLab(); navigate('/labs') }}
          className="flex items-center gap-3 px-3 py-2.5 rounded text-[17.5px] font-medium transition-all text-[#475569] hover:text-[#334155] hover:bg-slate-100 mt-1 cursor-pointer"
        >
          <span className="text-[20px] leading-none flex items-center justify-center"><IconSwap /></span>
          Switch Lab
        </button>
      </nav>

      <div className="px-5 py-4 border-t border-line flex flex-col gap-2">
        <p className="font-mono text-[10px] text-[#94a3b8] uppercase tracking-wider truncate">
          {admin?.type === 'super_admin' ? 'Super Admin' : 'Lab Admin'}
        </p>
        <button
          onClick={handleSignOut}
          className="font-mono text-[11px] text-[#475569] hover:text-red transition-colors cursor-pointer text-left"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
