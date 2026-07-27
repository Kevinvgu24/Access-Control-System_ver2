import { useAdminStore } from '@/store/adminStore'

export function TopBar() {
  const { systemStatus } = useAdminStore()
  const sys  = systemStatus.overall
  const cam  = systemStatus.cameraState
  const sync = systemStatus.syncState

  const sysColor  = sys === 'online' ? 'text-emerald-600 font-extrabold' : sys === 'grace_period' ? 'text-amber-600 font-extrabold' : 'text-red-600 font-extrabold'
  const camColor  = cam === 'connected' ? 'text-emerald-600 font-extrabold' : 'text-red-600 font-extrabold'
  const syncColor = sync === 'live' ? 'text-emerald-600 font-extrabold' : sync === 'delayed' ? 'text-amber-600 font-extrabold' : 'text-red-600 font-extrabold'

  return (
    <div className="h-11 flex items-center px-8 gap-6 bg-surface border-b border-line shrink-0">
      <Item label="Node"   value={systemStatus.nodeLabel} color="text-slate-800 font-bold" />
      <div className="w-px h-4 bg-slate-200" />
      <Item label="System" value={sys.replace('_', ' ')} color={sysColor} />
      <Item label="Camera" value={cam}                   color={camColor} />
      <Item label="Sync"   value={sync}                  color={syncColor} />
      <div className="ml-auto font-mono text-[11px] text-slate-500 font-medium">{systemStatus.lastSyncAt}</div>
    </div>
  )
}

function Item({ label, value, color = 'text-slate-700' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">{label}</span>
      <span className={`capitalize tracking-wide ${color}`}>{value}</span>
    </div>
  )
}
