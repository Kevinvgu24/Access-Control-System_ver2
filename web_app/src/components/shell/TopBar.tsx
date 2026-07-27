import { useAdminStore } from '@/store/adminStore'

export function TopBar() {
  const { systemStatus } = useAdminStore()
  const sys  = systemStatus.overall
  const cam  = systemStatus.cameraState
  const sync = systemStatus.syncState

  const getStatus = (val: string, onlineVals: string[], warningVals: string[]) => {
    if (onlineVals.includes(val)) return 'online'
    if (warningVals.includes(val)) return 'warning'
    return 'offline'
  }

  return (
    <div className="h-14 flex items-center px-8 gap-8 bg-surface border-b border-line shrink-0 shadow-sm z-10 relative">
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8] font-bold">Node</span>
        <span className="font-sans text-xs font-black text-slate-700 bg-slate-100 px-2.5 py-1 rounded border border-slate-200 uppercase tracking-wider">{systemStatus.nodeLabel || 'UNKNOWN'}</span>
      </div>
      
      <div className="w-px h-6 bg-slate-200" />
      
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
      
      <div className="ml-auto flex items-center gap-2.5">
        <span className="font-mono text-[10px] text-[#94a3b8] uppercase tracking-widest font-bold">Last Sync</span>
        <span className="font-mono text-[11px] text-slate-600 font-medium bg-slate-50 px-2.5 py-1 rounded border border-slate-100">{systemStatus.lastSyncAt}</span>
      </div>
    </div>
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
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8] font-bold">{label}</span>
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded border font-mono text-[10px] font-black uppercase tracking-widest shadow-sm ${styles[status]}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${dotColors[status]}`} />
        {value}
      </div>
    </div>
  )
}
