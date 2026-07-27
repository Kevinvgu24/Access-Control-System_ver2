import { useAdminStore } from '@/store/adminStore'
import { Panel, PanelHeader } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { fmtConf, fmtMethod, fmtTs, resultLabel, resultTone } from '@/lib/format'
import { useNavigate } from 'react-router-dom'
import { SensorTelemetryWidget } from '@/components/sensors/SensorTelemetryWidget'

export function OverviewPage() {
  const { systemStatus, events, incidents, todayEntries, failedAttempts, averageConfidence, loading } = useAdminStore()
  const navigate = useNavigate()

  const sysStatusColor = systemStatus.overall === 'online' ? 'text-green' : systemStatus.overall === 'grace_period' ? 'text-amber' : 'text-red'
  const sysTopColor    = systemStatus.overall === 'online' ? 'bg-green'  : systemStatus.overall === 'grace_period' ? 'bg-amber'  : 'bg-red'

  const kpis = [
    { label: 'System Status',   value: systemStatus.overall.replace('_', ' '), sub: systemStatus.nodeLabel, color: sysStatusColor, top: sysTopColor },
    { label: "Today's Entries", value: String(todayEntries),  sub: 'Granted access',          color: 'text-[#0f172a]', top: 'bg-slate-200' },
    { label: 'Failed Attempts', value: String(failedAttempts),sub: 'Denied + liveness + PIN',  color: 'text-red',       top: 'bg-red'      },
    { label: 'Avg Confidence',  value: fmtConf(averageConfidence), sub: 'Rolling face avg',   color: 'text-blue',      top: 'bg-blue'     },
  ]

  return (
    <div className="flex flex-col gap-7">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <p className="font-mono text-[11px] tracking-widest uppercase text-[#94a3b8] mb-3">Command Center</p>
          <h1 className="text-4xl font-bold tracking-tight text-[#0f172a]">Global Dashboard</h1>
          <p className="text-sm text-[#475569] mt-2">Lab health, sync status, and live door activity.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => navigate('/enrollment')}>+ Add User</Button>
          <Button variant="ghost" onClick={() => navigate('/logs')}>Export Logs</Button>
        </div>
      </div>

      {/* Sensor Telemetry Widget */}
      <SensorTelemetryWidget compact={true} />

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map(({ label, value, sub, color, top }) => (
          <div key={label} className="bg-surface border border-line rounded-lg p-6 relative overflow-hidden shadow-sm">
            <div className={`absolute top-0 inset-x-0 h-0.5 ${top} opacity-70`} />
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8] mb-4">{label}</p>
            <p className={`text-5xl font-bold tracking-tight leading-none capitalize ${color}`}>{value}</p>
            <p className="text-xs text-[#475569] mt-3">{sub}</p>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 380px' }}>
        {/* Feed */}
        <Panel>
          <PanelHeader eyebrow="Real-time" title="Live Activity Feed"
            action={
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#94a3b8]">
                <span className={`${loading ? '' : 'blink'} w-1.5 h-1.5 rounded-full bg-green`} />
                {loading ? 'Loading…' : 'AUTO'}
              </span>
            }
          />
          <div className="flex flex-col gap-1">
            {events.length === 0 && !loading && (
              <p className="py-6 text-center font-mono text-xs text-[#94a3b8]">No events yet.</p>
            )}
            {events.slice(0, 10).map(ev => (
              <div key={ev.id} className="flex items-center justify-between gap-4 px-4 py-3 rounded bg-raised hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-4 min-w-0">
                  <span className="font-mono text-[12px] text-[#94a3b8] shrink-0 w-10">
                    {fmtTs(ev.occurredAt).slice(11, 16)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#0f172a] truncate">{ev.displayName ?? 'Unknown User'}</p>
                    <p className="font-mono text-[11px] text-[#94a3b8] mt-0.5 truncate">{fmtMethod(ev.method)} · {ev.reason}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {ev.confidence > 0 && <span className="font-mono text-xs text-[#475569]">{fmtConf(ev.confidence)}</span>}
                  <Badge tone={resultTone(ev.result)}>{resultLabel(ev.result)}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Right */}
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader eyebrow="Trend" title="Confidence Band" />
            <div className="flex flex-col gap-3">
              {events.slice(0, 6).map(ev => {
                const pct = Math.max(ev.confidence ?? 50, 15)
                const barColor = ev.result === 'granted' ? 'bg-green' : ev.result === 'denied' || ev.result === 'pin_failed' ? 'bg-red' : 'bg-amber'
                return (
                  <div key={ev.id} className="flex items-center gap-3">
                    <span className="font-mono text-[11px] text-[#94a3b8] w-10 shrink-0">{fmtTs(ev.occurredAt).slice(11, 16)}</span>
                    <div className="flex-1 h-1 rounded-full bg-slate-200 overflow-hidden">
                      <div className={`h-full rounded-full opacity-75 ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono text-[11px] text-[#475569] w-10 text-right shrink-0">{fmtConf(ev.confidence)}</span>
                  </div>
                )
              })}
              {events.length === 0 && (
                <p className="font-mono text-[11px] text-[#94a3b8]">No data yet.</p>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
