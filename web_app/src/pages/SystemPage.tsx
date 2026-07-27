import { useState, useEffect } from 'react'
import { useAdminStore } from '@/store/adminStore'
import { useLabStore }   from '@/store/labStore'
import { useAuthStore }  from '@/store/authStore'
import { Panel, PanelHeader } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { LiveCamera } from '@/components/ui/LiveCamera'
import { SensorTelemetryWidget } from '@/components/sensors/SensorTelemetryWidget'
import { updateNodeConfig, getFirstLabNode } from '@/lib/db'
import { fmtTs } from '@/lib/format'

interface HistoryRecord {
  id: number
  temperature: number
  humidity: number
  latitude: number
  longitude: number
  altitude: number
  speed: number
  satellites: number
  dht_ok: boolean
  gnss_ok: boolean
  receivedAt: string
}

function Slider({ label, value, hint, onChange, warn }: {
  label: string; value: number; hint: string; onChange: (v: number) => void; warn?: boolean
}) {
  const color    = warn ? 'text-amber' : 'text-green'
  const barColor = warn ? 'bg-amber'   : 'bg-green'
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-start gap-4">
        <div>
          <p className="text-[15px] font-semibold text-[#0f172a]">{label}</p>
          <p className="text-sm text-[#475569] mt-1">{hint}</p>
        </div>
        <strong className={`font-mono text-3xl font-semibold leading-none shrink-0 ${color}`}>
          {value}<span className="text-base opacity-50">%</span>
        </strong>
      </div>
      <div className="relative h-1.5 rounded-full bg-line">
        <div className={`absolute left-0 top-0 h-full rounded-full opacity-75 transition-all ${barColor}`} style={{ width: `${value}%` }} />
        <input type="range" min={0} max={100} value={value} onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-[#94a3b8]"><span>0%</span><span>100%</span></div>
    </div>
  )
}

type MT = 'green' | 'amber' | 'red'
function Stat({ label, value, unit, tone }: { label: string; value: string | number; unit: string; tone: MT }) {
  const c: Record<MT, string> = { green: 'text-green', amber: 'text-amber', red: 'text-red' }
  return (
    <div className="bg-raised border border-line rounded-lg px-5 py-4 flex flex-col gap-2 shadow-sm">
      <span className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8]">{label}</span>
      <strong className={`font-mono text-3xl font-semibold leading-none ${c[tone]}`}>
        {value}<span className="text-sm opacity-50 ml-0.5">{unit}</span>
      </strong>
    </div>
  )
}

export function SystemPage() {
  const { nodeConfig, nodeState, refreshNodeConfig } = useAdminStore()
  const { selectedLabId, selectedNodeId } = useLabStore()
  const { admin }         = useAuthStore()

  const [localConf, setLocalConf] = useState<number>(nodeConfig?.confidenceThreshold ?? 90)
  const [localLiv,  setLocalLiv]  = useState<number>(nodeConfig?.livenessThreshold  ?? 78)
  const [saving, setSaving]       = useState(false)
  const [saved,  setSaved]        = useState(false)

  // Sensor History state
  const [history, setHistory]     = useState<HistoryRecord[]>([])
  const [loadingHist, setLoadingHist] = useState(true)
  const [triggering, setTriggering] = useState(false)

  const fetchHistory = async () => {
    if (!selectedLabId) return
    try {
      const res = await fetch(`/api/labs/${selectedLabId}/sensors/history?limit=15`)
      if (res.ok) {
        const data = await res.json()
        setHistory(data)
      }
    } catch (e) {
      console.error('Failed to fetch sensor history:', e)
    } finally {
      setLoadingHist(false)
    }
  }

  useEffect(() => {
    fetchHistory()
    const interval = setInterval(fetchHistory, 5000)
    return () => clearInterval(interval)
  }, [selectedLabId])

  const sendTestTelemetry = async () => {
    if (!selectedLabId) return
    setTriggering(true)
    try {
      // Subnode 1 - Environment & Air Quality Payload (DHT11 + SDS011 PM2.5 + CO2)
      await fetch(`/api/labs/${selectedLabId}/sensors/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: 'subnode1',
          device_name: 'Subnode 1 - Environment & Air Quality',
          metrics: {
            temperature_c: 28.5 + (Math.random() * 2 - 1),
            humidity_pct: 62.0 + (Math.random() * 4 - 2),
            pm25_ugm3: 15.0 + Math.random() * 8,
            co2_ppm: 415 + Math.floor(Math.random() * 30),
            light_lux: 320 + Math.floor(Math.random() * 50)
          },
          sensor_ok: true
        })
      })
      // Subnode 2 - GPS Tracker Payload (LC76G GNSS)
      await fetch(`/api/labs/${selectedLabId}/sensors/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: 'subnode2',
          device_name: 'Subnode 2 - GPS Tracker',
          metrics: {
            latitude: 10.762622 + (Math.random() * 0.0004 - 0.0002),
            longitude: 106.660172 + (Math.random() * 0.0004 - 0.0002),
            altitude_m: 15.0 + (Math.random() * 2 - 1),
            speed_kmph: Math.random() * 2.5,
            satellites: 8 + Math.floor(Math.random() * 3)
          },
          sensor_ok: true
        })
      })
      await fetchHistory()
    } catch (e) {
      console.error('Failed to post test telemetry:', e)
    } finally {
      setTriggering(false)
    }
  }

  const save = async () => {
    if (!selectedLabId) return
    setSaving(true)
    try {
      const node = await getFirstLabNode(selectedLabId)
      if (node) {
        await updateNodeConfig(
          selectedLabId, node.clusterId, node.id,
          { confidenceThreshold: localConf, livenessThreshold: localLiv },
          admin?.firebaseUid ?? 'unknown'
        )
        await refreshNodeConfig(selectedLabId, node.clusterId, node.id)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } finally {
      setSaving(false)
    }
  }

  const conf = localConf
  const fps  = nodeState?.cameraFps    ?? 0
  const cpu  = nodeState?.cpuPercent   ?? 0
  const ram  = nodeState?.ramPercent   ?? 0
  const temp = nodeState?.temperatureC ?? 0

  return (
    <div className="flex flex-col gap-7">
      {/* Page Header */}
      <div className="flex justify-between items-end">
        <div>
          <p className="font-mono text-[11px] tracking-widest uppercase text-orange-600 font-extrabold mb-2">System Control & IoT Center</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-orange-600">System Configuration & Telemetry</h1>
          <p className="text-sm text-[#475569] mt-2">
            Monitor real-time ESP32 sensors (DHT11 & LC76G GPS), camera stream, recognition thresholds, and core hardware metrics.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={sendTestTelemetry} disabled={triggering}>
            {triggering ? 'Publishing…' : '⚡ Test Telemetry Payload'}
          </Button>
          <Button variant="ghost" onClick={fetchHistory}>
            🔄 Refresh Log
          </Button>
        </div>
      </div>

      {/* Embedded Full ESP32 Sensor & GPS Telemetry Widget */}
      <SensorTelemetryWidget compact={false} />

      {/* Main Two-Column Layout */}
      <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 360px' }}>
        {/* Left Column - Live View, Hardware Metrics & Telemetry Log Table */}
        <div className="flex flex-col gap-5">
          {selectedLabId && selectedNodeId && (
            <Panel>
              <PanelHeader eyebrow="Camera Monitoring" title="IR Live View Stream" />
              <LiveCamera labId={selectedLabId} nodeId={selectedNodeId} />
            </Panel>
          )}

          <Panel>
            <PanelHeader eyebrow="Hardware Metrics" title="Raspberry Pi 5 Performance" />
            {nodeState ? (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="FPS"  value={fps.toFixed(1)} unit="fps" tone={fps < 15 ? 'red' : fps < 20 ? 'amber' : 'green'} />
                <Stat label="CPU"  value={cpu}            unit="%"   tone={cpu > 80 ? 'red' : cpu > 60 ? 'amber' : 'green'} />
                <Stat label="RAM"  value={ram}            unit="%"   tone={ram > 80 ? 'red' : ram > 60 ? 'amber' : 'green'} />
                <Stat label="Temp" value={temp}           unit="°C"  tone={temp > 70 ? 'red' : temp > 55 ? 'amber' : 'green'} />
              </div>
            ) : (
              <p className="font-mono text-[11px] text-[#94a3b8]">No telemetry — node offline or no active node found.</p>
            )}
          </Panel>

          {/* Historical Telemetry & GPS Log Table */}
          <Panel>
            <PanelHeader
              eyebrow="Audit Log"
              title="Recent Telemetry & GPS History"
              action={
                <span className="font-mono text-xs text-slate-500">
                  Last {history.length} records
                </span>
              }
            />

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-line bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Temp</th>
                    <th className="py-3 px-4">Humidity</th>
                    <th className="py-3 px-4">GPS Latitude</th>
                    <th className="py-3 px-4">GPS Longitude</th>
                    <th className="py-3 px-4">Alt / Speed</th>
                    <th className="py-3 px-4">Satellites</th>
                    <th className="py-3 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-slate-800">
                  {history.length === 0 && !loadingHist && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        No sensor records logged yet. Flash ESP32 or click "Test Telemetry Payload".
                      </td>
                    </tr>
                  )}
                  {history.map(row => (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {fmtTs(row.receivedAt)}
                      </td>
                      <td className="py-3 px-4 font-bold text-emerald-700">
                        {row.temperature ? `${row.temperature.toFixed(1)} °C` : '--'}
                      </td>
                      <td className="py-3 px-4 font-bold text-blue-700">
                        {row.humidity ? `${row.humidity.toFixed(1)} %` : '--'}
                      </td>
                      <td className="py-3 px-4">
                        {row.latitude ? `${row.latitude.toFixed(6)}°` : '--'}
                      </td>
                      <td className="py-3 px-4">
                        {row.longitude ? `${row.longitude.toFixed(6)}°` : '--'}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {row.altitude ? `${row.altitude.toFixed(0)}m / ${row.speed.toFixed(1)}km/h` : '--'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-200 font-bold">
                          🛸 {row.satellites}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={`px-2 py-0.5 rounded font-extrabold font-mono text-[11px] ${
                          row.dht_ok && row.gnss_ok 
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                            : row.dht_ok 
                            ? 'bg-amber-100 text-amber-900 border border-amber-300' 
                            : 'bg-red-600 text-white border border-red-700 animate-pulse'
                        }`}>
                          {row.dht_ok && row.gnss_ok ? 'ONLINE (OK)' : row.dht_ok ? 'GPS SEARCH' : 'OFFLINE (WARN)'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {/* Right Column - Recognition Controls and Tuning */}
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader eyebrow="Model Tuning" title="Recognition Thresholds"
              action={
                <Button variant="primary" size="sm" onClick={save} disabled={saving}>
                  {saved ? '✓ Saved' : saving ? 'Saving…' : 'Apply Changes'}
                </Button>
              }
            />
            <div className="flex flex-col gap-8">
              <Slider label="Match Confidence Threshold" hint="Minimum confidence score to grant face access."
                value={localConf} onChange={v => setLocalConf(v)} warn={localConf < 80} />
              <Slider label="Liveness Threshold" hint="How aggressively the system rejects spoofing attempts."
                value={localLiv} onChange={v => setLocalLiv(v)} />
            </div>
            {conf < 80 && (
              <div className="flex items-start gap-3 px-4 py-3.5 bg-amber/5 border border-amber/20 rounded text-sm text-amber mt-7">
                <span className="shrink-0">⚠</span> Low threshold increases false positives. Recommended minimum: 80%.
              </div>
            )}
            {nodeConfig && (
              <p className="font-mono text-[11px] text-[#94a3b8] mt-7 pt-5 border-t border-line">
                Updated {fmtTs(nodeConfig.updatedAt)} · {nodeConfig.updatedBy}
              </p>
            )}
            {!nodeConfig && (
              <p className="font-mono text-[11px] text-[#94a3b8] mt-7 pt-5 border-t border-line">
                No config found — defaults shown. Apply to create initial config.
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Testing Tips" title="Operational Guidance" />
            <ul className="flex flex-col gap-3">
              {[
                'Start at 90% confidence, lower if authorized users are rejected.',
                'High liveness + poor lighting = potential false rejections.',
                'Ensure ESP32 #2 is within Wi-Fi range for continuous MQTT data streaming.',
                'CPU above 80% consistently? Check model thread count.',
                'FPS below 15? Check camera buffer pipeline.',
              ].map(note => (
                <li key={note} className="flex items-start gap-3 text-sm text-[#475569] leading-snug">
                  <span className="w-1 h-1 rounded-full bg-[#cbd5e1] shrink-0 mt-1.5" />{note}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  )
}
