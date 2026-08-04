import { useAdminStore } from '@/store/adminStore'
import { useLabStore }   from '@/store/labStore'
import { Menu }           from 'lucide-react'

export function TopBar() {
  const { systemStatus } = useAdminStore()
  const { selectedLabName, toggleMobileMenu } = useLabStore()
  const sys  = systemStatus.overall
  const cam  = systemStatus.cameraState
  const sync = systemStatus.syncState

  const getStatus = (val: string, onlineVals: string[], warningVals: string[]) => {
    if (onlineVals.includes(val)) return 'online'
    if (warningVals.includes(val)) return 'warning'
    return 'offline'
  }

  return (
    <header className="min-h-[3.5rem] py-2 px-3 sm:px-6 md:px-8 bg-surface border-b border-line shrink-0 shadow-sm z-10 relative flex items-center justify-between gap-2 sm:gap-4 md:gap-6 flex-wrap md:flex-nowrap">
      {/* Left: Mobile Toggle & Lab Name */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <button
          onClick={toggleMobileMenu}
          className="md:hidden flex items-center justify-center p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          title="Open Navigation Menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-[#94a3b8] font-bold">Lab</span>
          <span className="font-sans text-[11px] sm:text-xs font-black text-slate-700 bg-slate-100 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded border border-slate-200 uppercase tracking-wider">
            {selectedLabName || 'UNKNOWN'}
          </span>
        </div>
      </div>

      {/* Middle: System Status Badges (Always Visible) */}
      <div className="flex items-center gap-2 sm:gap-4 md:gap-6 shrink-0">
        <div className="w-px h-5 sm:h-6 bg-slate-200 shrink-0" />
        
        <StatusBadge 
          label="System" 
          value={sys.replace('_', ' ')} 
          status={getStatus(sys, ['online'], ['grace_period'])} 
        />
        <StatusBadge 
          label="Camera" 
          value={cam} 
          status={getStatus(cam, ['connected'], [])} 
        />
        <StatusBadge 
          label="Sync" 
          value={sync} 
          status={getStatus(sync, ['live'], ['delayed'])} 
        />
      </div>

      {/* Right: Last Sync Time (Always Visible) */}
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
        <span className="font-mono text-[9px] sm:text-[10px] text-[#94a3b8] uppercase tracking-widest font-bold">Last Sync</span>
        <span className="font-mono text-[10px] sm:text-[11px] text-slate-600 font-medium bg-slate-50 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded border border-slate-100 shrink-0">
          {systemStatus.lastSyncAt}
        </span>
      </div>
    </header>
  )
}

function StatusBadge({ label, value, status }: { label: string; value: string; status: 'online' | 'offline' | 'warning' }) {
  const styles = {
    online: 'bg-green/10 text-green border-green/20',
    offline: 'bg-[#fce8e8] text-[#e06666] border-[#e06666]/30',
    warning: 'bg-amber/10 text-amber border-amber/20',
  }

  const dotColors = {
    online: 'bg-green animate-pulse',
    offline: 'bg-[#e06666]',
    warning: 'bg-amber',
  }

  return (
    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
      <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-[#94a3b8] font-bold">{label}</span>
      <div className={`flex items-center gap-1 sm:gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded border font-mono text-[9px] sm:text-[10px] font-black uppercase tracking-widest shadow-sm ${styles[status]}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[status]}`} />
        <span>{value}</span>
      </div>
    </div>
  )
}
