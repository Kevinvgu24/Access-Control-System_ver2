import { useState, useEffect } from 'react'
import { useLabStore } from '@/store/labStore'
import { SensorTelemetryWidget } from '@/components/sensors/SensorTelemetryWidget'
import { Panel, PanelHeader } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
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

export function SensorsPage() {
  const { selectedLabId } = useLabStore()
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)

  const fetchHistory = async () => {
    if (!selectedLabId) return
    try {
      const res = await fetch(`/api/labs/${selectedLabId}/sensors/history?limit=25`)
      if (res.ok) {
        const data = await res.json()
        setHistory(data)
      }
    } catch (e) {
      console.error('Failed to fetch sensor history:', e)
    } finally {
      setLoading(false)
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
      const mockPayload = {
        dht11: {
          temperature_c: 28.5 + (Math.random() * 2 - 1),
          humidity_pct: 62.0 + (Math.random() * 4 - 2),
          sensor_ok: true
        },
        gnss: {
          latitude: 10.762622 + (Math.random() * 0.0004 - 0.0002),
          longitude: 106.660172 + (Math.random() * 0.0004 - 0.0002),
          altitude_m: 15.0 + (Math.random() * 2 - 1),
          speed_kmph: Math.random() * 2.5,
          satellites: 8 + Math.floor(Math.random() * 3),
          location_valid: true
        }
      }
      await fetch(`/api/labs/${selectedLabId}/sensors/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockPayload)
      })
      await fetchHistory()
    } catch (e) {
      console.error('Failed to post test telemetry:', e)
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="flex flex-col gap-7">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <p className="font-mono text-[11px] tracking-widest uppercase text-slate-500 mb-2">Hardware Telemetry</p>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">ESP32 & MQTT Sensor Center</h1>
          <p className="text-sm text-slate-600 mt-2">
            Real-time environmental monitoring (DHT11 Temperature & Humidity) and GNSS GPS Location Tracking.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={sendTestTelemetry} disabled={triggering}>
            {triggering ? 'Publishing…' : '⚡ Publish Test Telemetry'}
          </Button>
          <Button variant="ghost" onClick={fetchHistory}>
            🔄 Refresh History
          </Button>
        </div>
      </div>

      {/* Sensor Widget Component */}
      <SensorTelemetryWidget />

      {/* System Architecture Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-white shadow-sm">
        <h3 className="font-mono text-xs uppercase font-bold text-indigo-400 tracking-wider mb-3">
          Architecture & Protocol Topology
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 font-mono text-xs text-center">
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg p-3">
            <span className="text-xl block mb-1">🌡️</span>
            <p className="font-bold text-emerald-400">ESP32 #1</p>
            <p className="text-[10px] text-slate-400 mt-1">DHT11 Temp & RH</p>
          </div>
          <div className="flex items-center justify-center text-slate-500 font-bold text-base">
            ESP-NOW ➔
          </div>
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg p-3">
            <span className="text-xl block mb-1">🛰️</span>
            <p className="font-bold text-indigo-400">ESP32 #2 (Gateway)</p>
            <p className="text-[10px] text-slate-400 mt-1">LC76G GNSS + MQTT</p>
          </div>
          <div className="flex items-center justify-center text-slate-500 font-bold text-base">
            MQTT (1883) ➔
          </div>
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg p-3">
            <span className="text-xl block mb-1">🍓</span>
            <p className="font-bold text-rose-400">Raspberry Pi 5</p>
            <p className="text-[10px] text-slate-400 mt-1">Python Service & Web UI</p>
          </div>
        </div>
      </div>

      {/* Historical Telemetry Logs Table */}
      <Panel>
        <PanelHeader
          eyebrow="Audit Log"
          title="Recent Telemetry & GPS History"
          action={
            <span className="font-mono text-xs text-slate-500">
              Showing last {history.length} records
            </span>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-line bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Temperature</th>
                <th className="py-3 px-4">Humidity</th>
                <th className="py-3 px-4">GPS Latitude</th>
                <th className="py-3 px-4">GPS Longitude</th>
                <th className="py-3 px-4">Altitude / Speed</th>
                <th className="py-3 px-4">Satellites</th>
                <th className="py-3 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-slate-800">
              {history.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No sensor records logged yet. Flash ESP32 or click "Publish Test Telemetry".
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
                    <span className={`px-2 py-0.5 rounded font-bold ${row.dht_ok && row.gnss_ok ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {row.dht_ok && row.gnss_ok ? 'OK' : row.dht_ok ? 'GPS SEARCH' : 'DHT WARN'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
