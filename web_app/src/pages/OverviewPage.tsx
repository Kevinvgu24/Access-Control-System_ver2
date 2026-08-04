import { useAdminStore } from '@/store/adminStore'
import { useLabStore } from '@/store/labStore'
import { Panel, PanelHeader } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { fmtConf, fmtMethod, fmtTs, resultLabel, resultTone } from '@/lib/format'
import { useNavigate } from 'react-router-dom'
import { SensorTelemetryWidget } from '@/components/sensors/SensorTelemetryWidget'
import { NotificationPanel } from '@/components/ui/NotificationPanel'

export function OverviewPage() {
  const { systemStatus, events, todayEntries, failedAttempts, averageConfidence, loading } = useAdminStore()
  const { selectedLabName } = useLabStore()
  const navigate = useNavigate()

  const sysStatusColor = systemStatus.overall === 'online' ? 'text-green' : systemStatus.overall === 'grace_period' ? 'text-amber' : 'text-red'
  const sysTopColor    = systemStatus.overall === 'online' ? 'bg-green'  : systemStatus.overall === 'grace_period' ? 'bg-amber'  : 'bg-red'

  const kpis = [
    { label: 'System Status',   value: systemStatus.overall.replace('_', ' '), sub: selectedLabName, color: sysStatusColor, top: sysTopColor },
    { label: "Today's Entries", value: String(todayEntries),  sub: 'Granted access',          color: 'text-[#0f172a]', top: 'bg-slate-200' },
    { label: 'Failed Attempts', value: String(failedAttempts),sub: 'Denied + liveness + PIN',  color: 'text-red',       top: 'bg-red'      },
    { label: 'Avg Confidence',  value: fmtConf(averageConfidence), sub: 'Rolling face avg',   color: 'text-blue',      top: 'bg-blue'     },
  ]

  return (
    <div className="flex flex-col gap-5 sm:gap-6 lg:gap-7">
      {/* Header (Always Visible & Fluid) */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3 sm:gap-4">
        <div>
          <p className="font-mono text-[10px] sm:text-[11px] tracking-widest uppercase text-orange-600 font-extrabold mb-1">Command Center</p>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-orange-600">Global Dashboard</h1>
          <p className="text-xs sm:text-sm text-[#475569] mt-1">Lab health, sync status, and live door activity.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="primary" onClick={() => navigate('/enrollment')}>+ Add User</Button>
          <Button variant="ghost" onClick={() => navigate('/logs')}>Export Logs</Button>
        </div>
      </div>

      {/* Sensor Telemetry Widget */}
      <SensorTelemetryWidget compact={true} />

      {/* KPIs: 2x2 grid on small screens, 4-col grid on medium/large screens. All cards remain 100% visible */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {kpis.map(({ label, value, sub, color, top }) => (
          <div key={label} className="bg-surface border border-line rounded-lg p-3.5 sm:p-5 lg:p-6 relative overflow-hidden shadow-sm flex flex-col justify-between min-w-0">
            <div className={`absolute top-0 inset-x-0 h-0.5 ${top} opacity-70`} />
            <p className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-[#94a3b8] mb-2 sm:mb-3 truncate">{label}</p>
            <p className={`text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-none capitalize ${color} truncate`}>{value}</p>
            <p className="text-[11px] sm:text-xs text-[#475569] mt-2 sm:mt-3 truncate">{sub}</p>
          </div>
        ))}
      </div>

      {/* Main Content Split: Side-by-side from medium screens (768px+) and desktop during zoom */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-6">
        {/* Live Activity Feed */}
        <div className="md:col-span-7 lg:col-span-8 flex flex-col">
          <Panel className="flex-1">
            <PanelHeader eyebrow="Real-time" title="Live Activity Feed"
              action={
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#94a3b8]">
                  <span className={`${loading ? '' : 'blink'} w-1.5 h-1.5 rounded-full bg-green`} />
                  {loading ? 'Loading...' : 'AUTO'}
                </span>
              }
            />
            <div className="flex flex-col gap-1.5 overflow-x-auto custom-scrollbar">
              {events.length === 0 && !loading && (
                <p className="py-6 text-center font-mono text-xs text-[#94a3b8]">No events yet.</p>
              )}
              {events.slice(0, 10).map(ev => (
                <div key={ev.id} className="flex items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 sm:py-3 rounded bg-raised hover:bg-slate-100 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 sm:gap-4 min-w-0 flex-1">
                    <span className="font-mono text-[11px] sm:text-[12px] text-[#94a3b8] shrink-0 w-9 sm:w-10">
                      {fmtTs(ev.occurredAt).slice(11, 16)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-semibold text-[#0f172a] truncate">{ev.displayName ?? 'Unknown User'}</p>
                      <p className="font-mono text-[10px] sm:text-[11px] text-[#94a3b8] mt-0.5 truncate">{fmtMethod(ev.method)} &rarr; {ev.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    {ev.confidence > 0 && <span className="font-mono text-[10px] sm:text-xs text-[#475569]">{fmtConf(ev.confidence)}</span>}
                    <Badge tone={resultTone(ev.result)}>{resultLabel(ev.result)}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Notification Panel */}
        <div className="md:col-span-5 lg:col-span-4 flex flex-col md:sticky md:top-4 self-start max-h-[calc(100vh-5rem)]">
          <Panel pad={false} className="overflow-hidden flex-1">
            <NotificationPanel />
          </Panel>
        </div>
      </div>
    </div>
  )
}

