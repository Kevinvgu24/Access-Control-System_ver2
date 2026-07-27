import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useLabStore }  from '@/store/labStore'
import { useAdminStore } from '@/store/adminStore'

const NAV = [
  { href: '/overview',   icon: '▣', label: 'Dashboard'  },
  { href: '/users',      icon: '◈', label: 'Administrator' },
  { href: '/enrollment', icon: '⊕', label: 'Enrollment' },
  { href: '/schedules',  icon: '📅', label: 'Schedules'  },
  { href: '/logs',       icon: '≡', label: 'Logs'       },
  { href: '/system',     icon: '◎', label: 'System'     },
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
      <div className="px-6 py-7 border-b border-line">
        <div className="flex items-center gap-2 mb-1">
          <span className={`blink w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
          <span className={`font-mono text-[10px] tracking-widest uppercase ${systemStatus.overall === 'online' ? 'text-green' : 'text-amber'}`}>
            {systemStatus.overall === 'online' ? 'Live' : systemStatus.overall}
          </span>
        </div>
        <p className="text-[17px] font-bold tracking-tight text-[#0f172a] leading-tight mt-2">Smart Lab</p>
        <p className="font-mono text-[11px] text-[#94a3b8] mt-1 truncate">
          {selectedLabName ?? 'No lab selected'}
        </p>
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
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold font-sans border-2 transition-all shadow-sm ${
                isActive 
                  ? 'bg-orange-500 text-white border-orange-600 shadow-md shadow-orange-500/30 scale-[1.02] font-black' 
                  : 'bg-white text-slate-800 border-slate-200 hover:bg-orange-500 hover:text-white hover:border-orange-600 hover:shadow-md'
              }`
            }
          >
            <span className="text-sm leading-none shrink-0">{icon}</span>
            <span className="truncate">{label}</span>
          </NavLink>
        ))}


        {/* Switch lab */}
        <button
          onClick={() => { clearLab(); navigate('/labs') }}
          className="flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium transition-all text-[#475569] hover:text-[#334155] hover:bg-slate-100 mt-1 cursor-pointer"
        >
          <span className="text-base leading-none">⊞</span>
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
