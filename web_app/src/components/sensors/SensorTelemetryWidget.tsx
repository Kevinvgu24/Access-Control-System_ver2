import { useState, useEffect } from 'react'
import { useLabStore } from '@/store/labStore'
import { useAdminStore } from '@/store/adminStore'
import { Badge } from '@/components/ui/Badge'
import { fmtConf, fmtMethod, fmtTs, resultLabel, resultTone } from '@/lib/format'

export interface TelemetryData {
  temperature: number
  humidity: number
  latitude: number
  longitude: number
  altitude: number
  speed: number
  satellites: number
  pm25?: number
  co2?: number
  light?: number
  dht_ok: boolean
  gnss_ok: boolean
  last_updated: string | null
  online: boolean
}

export function SensorTelemetryWidget({ compact = false }: { compact?: boolean }) {
  const { selectedLabId } = useLabStore()
  const { events, loading: adminLoading } = useAdminStore()

  const [telemetry, setTelemetry] = useState<TelemetryData>({
    temperature: 0,
    humidity: 0,
    latitude: 0,
    longitude: 0,
    altitude: 0,
    speed: 0,
    satellites: 0,
    pm25: 0,
    co2: 0,
    light: 0,
    dht_ok: false,
    gnss_ok: false,
    last_updated: null,
    online: false
  })
  const [loading, setLoading] = useState(true)

  const fetchTelemetry = async () => {
    if (!selectedLabId) return
    try {
      const res = await fetch(`/api/labs/${selectedLabId}/sensors/latest`)
      if (res.ok) {
        const data = await res.json()
        setTelemetry(data)
      }
    } catch (e) {
      console.error('Failed to fetch sensor telemetry:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTelemetry()
    const interval = setInterval(fetchTelemetry, 2500)
    return () => clearInterval(interval)
  }, [selectedLabId])

  const tempColor = !telemetry.online 
    ? 'text-red-600 font-black' 
    : telemetry.temperature > 35 
    ? 'text-red-600' 
    : telemetry.temperature > 28 
    ? 'text-amber-600' 
    : 'text-emerald-600'

  const tempBg = !telemetry.online 
    ? 'bg-red-50 border-red-300' 
    : telemetry.temperature > 35 
    ? 'bg-red-50 border-red-200' 
    : telemetry.temperature > 28 
    ? 'bg-amber-50 border-amber-200' 
    : 'bg-emerald-50 border-emerald-200'

  const mapsUrl = telemetry.latitude && telemetry.longitude 
    ? `https://www.google.com/maps?q=${telemetry.latitude},${telemetry.longitude}` 
    : '#'

  if (compact) {
    return (
      <div className="flex flex-col gap-3">
        <div className={`border-2 rounded-lg px-4 py-2.5 flex items-center justify-between shadow-sm transition-all ${
          telemetry.online 
            ? 'bg-emerald-50 border-emerald-300 text-slate-900' 
            : 'bg-red-50 border-red-400 text-red-700 animate-pulse'
        }`}>
          <div className="flex items-center gap-2 text-xs font-bold font-mono">
            <span className="text-base">{telemetry.online ? '🟢' : '🚨'}</span>
            <span className={telemetry.online ? 'text-slate-900' : 'text-red-700 font-extrabold'}>
              {telemetry.online 
                ? 'SYSTEM CONNECTED: Dynamic ESP32 sensor node telemetry active.' 
                : 'HARDWARE DISCONNECTION ALERT: ESP32 SUBNODES UNREACHABLE!'}
            </span>
          </div>
          <span className={`px-2.5 py-1 text-[10px] font-mono font-black rounded uppercase tracking-wider ${
            telemetry.online 
              ? 'bg-emerald-600 text-white border border-emerald-700' 
              : 'bg-red-600 text-white border border-red-700 shadow-md shadow-red-500/30 animate-pulse'
          }`}>
            {telemetry.online ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Status Notification Banner */}
      <div className={`border-2 rounded-xl p-4 flex items-center justify-between shadow-md transition-all ${
        telemetry.online 
          ? 'bg-emerald-50 border-emerald-300 text-slate-900' 
          : 'bg-red-50 border-red-400 text-red-800 animate-pulse'
      }`}>
        <div className="flex items-center gap-3.5">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-2xl shrink-0 ${
            telemetry.online ? 'bg-emerald-100 border border-emerald-300' : 'bg-red-100 border border-red-300'
          }`}>
            {telemetry.online ? '🟢' : '🚨'}
          </div>
          <div>
            <h4 className={`font-sans font-extrabold text-sm uppercase tracking-wide ${
              telemetry.online ? 'text-slate-900' : 'text-red-700'
            }`}>
              {telemetry.online 
                ? 'SYSTEM CONNECTED: DYNAMIC SENSOR TELEMETRY ACTIVE' 
                : 'HARDWARE DISCONNECTION ALERT: ESP32 SUBNODES UNREACHABLE'}
            </h4>
            <p className={`text-xs mt-0.5 font-sans font-semibold ${
              telemetry.online ? 'text-slate-700' : 'text-red-600'
            }`}>
              {telemetry.online 
                ? 'Raspberry Pi 5 is receiving telemetry data directly from ESP32 sensors via MQTT.' 
                : 'Raspberry Pi 5 has not received MQTT telemetry data from subnodes (Timeout > 7 sec). Check Wi-Fi and power!'}
            </p>
          </div>
        </div>
        <span className={`px-3.5 py-1.5 font-mono text-xs font-black rounded-lg shadow-md uppercase tracking-wider shrink-0 transition-all ${
          telemetry.online 
            ? 'bg-emerald-600 text-white border border-emerald-700 shadow-emerald-500/20' 
            : 'bg-red-600 text-white border border-red-700 shadow-red-500/30 animate-pulse'
        }`}>
          {telemetry.online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      {/* 2. Main Split Grid (50% Left: Room Telemetry Overview | 50% Right: Live Activity Feed) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* LEFT HALF (50%): Room Environmental & Telemetry Overview Panel */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col gap-5">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <span className="font-mono text-[10px] text-slate-400 uppercase font-extrabold tracking-widest">
                Environmental Metrics
              </span>
              <h3 className="font-mono text-sm uppercase font-extrabold text-slate-800 tracking-wider mt-0.5">
                Room Telemetry Overview
              </h3>
            </div>
            <span className={`px-2.5 py-1 rounded text-xs font-mono font-black uppercase tracking-wider ${
              telemetry.online 
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                : 'bg-red-600 text-white border border-red-700 shadow-sm animate-pulse'
            }`}>
              {telemetry.online ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono">
            {/* Temperature Card */}
            <div className={`border rounded-lg p-3.5 transition-all flex flex-col justify-between ${
              telemetry.online ? tempBg : 'bg-red-50 border-red-300'
            }`}>
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-slate-500">Temperature</span>
                <span className="text-base">{telemetry.online ? '🌡️' : '🚨'}</span>
              </div>
              <p className={`text-2xl font-black mt-2 ${tempColor}`}>
                {telemetry.online ? `${telemetry.temperature.toFixed(1)}°C` : '--'}
              </p>
            </div>

            {/* Humidity Card */}
            <div className={`border rounded-lg p-3.5 transition-all flex flex-col justify-between ${
              telemetry.online ? 'bg-blue-50/50 border-blue-100' : 'bg-red-50 border-red-300'
            }`}>
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-slate-500">Humidity</span>
                <span className="text-base">{telemetry.online ? '💧' : '🚨'}</span>
              </div>
              <p className="text-2xl font-black text-blue-700 mt-2">
                {telemetry.online ? `${telemetry.humidity.toFixed(1)}%` : '--'}
              </p>
            </div>

            {/* PM2.5 Fine Dust */}
            <div className={`border rounded-lg p-3.5 transition-all flex flex-col justify-between ${
              telemetry.online ? 'bg-slate-50 border-slate-200' : 'bg-red-50 border-red-300'
            }`}>
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-slate-500">PM2.5 Dust</span>
                <span className="text-base">{telemetry.online ? '🌫️' : '🚨'}</span>
              </div>
              <p className="text-2xl font-black text-slate-800 mt-2">
                {telemetry.online && telemetry.pm25 ? `${telemetry.pm25.toFixed(1)}` : '--'}
                <span className="text-xs font-normal text-slate-500 ml-1">µg/m³</span>
              </p>
            </div>

            {/* CO2 Concentration */}
            <div className={`border rounded-lg p-3.5 transition-all flex flex-col justify-between ${
              telemetry.online ? 'bg-emerald-50/40 border-emerald-200' : 'bg-red-50 border-red-300'
            }`}>
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-slate-500">CO2 Level</span>
                <span className="text-base">{telemetry.online ? '🍃' : '🚨'}</span>
              </div>
              <p className="text-2xl font-black text-emerald-700 mt-2">
                {telemetry.online && telemetry.co2 ? `${telemetry.co2}` : '--'}
                <span className="text-xs font-normal text-slate-500 ml-1">ppm</span>
              </p>
            </div>

            {/* Light Lux */}
            <div className={`border rounded-lg p-3.5 transition-all flex flex-col justify-between ${
              telemetry.online ? 'bg-amber-50/40 border-amber-200' : 'bg-red-50 border-red-300'
            }`}>
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-slate-500">Light Lux</span>
                <span className="text-base">{telemetry.online ? '☀️' : '🚨'}</span>
              </div>
              <p className="text-2xl font-black text-amber-700 mt-2">
                {telemetry.online && telemetry.light ? `${telemetry.light}` : '--'}
                <span className="text-xs font-normal text-slate-500 ml-1">Lux</span>
              </p>
            </div>

            {/* GPS Location Card */}
            <div className={`border rounded-lg p-3.5 transition-all flex flex-col justify-between ${
              telemetry.online ? 'bg-indigo-50/50 border-indigo-100' : 'bg-red-50 border-red-300'
            }`}>
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-slate-500">GNSS GPS</span>
                <span className="text-base">{telemetry.online ? '📡' : '🚨'}</span>
              </div>
              <div className="mt-2">
                {telemetry.online && telemetry.latitude ? (
                  <div>
                    <p className="text-xs font-bold text-indigo-950 truncate">{telemetry.latitude.toFixed(4)}°N</p>
                    <p className="text-xs font-bold text-indigo-950 truncate">{telemetry.longitude.toFixed(4)}°E</p>
                  </div>
                ) : (
                  <p className="text-xs font-bold text-red-600 mt-1">No Fix / Offline</p>
                )}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>Last Updated: {telemetry.last_updated ? new Date(telemetry.last_updated).toLocaleTimeString() : 'N/A'}</span>
            {telemetry.online && telemetry.latitude ? (
              <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline font-bold">
                View Maps ↗
              </a>
            ) : null}
          </div>
        </div>

        {/* RIGHT HALF (50%): Live Activity Feed Panel */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col gap-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <span className="font-mono text-[10px] text-slate-400 uppercase font-extrabold tracking-widest">
                Real-time Log Stream
              </span>
              <h3 className="font-mono text-sm uppercase font-extrabold text-slate-800 tracking-wider mt-0.5">
                Live Activity Feed
              </h3>
            </div>

            <span className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
              <span className={`${adminLoading ? '' : 'blink'} w-2 h-2 rounded-full bg-emerald-500`} />
              {adminLoading ? 'Loading…' : 'LIVE AUTO'}
            </span>
          </div>

          <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1">
            {events.length === 0 && !adminLoading && (
              <p className="py-8 text-center font-mono text-xs text-slate-400">No door activity logged yet.</p>
            )}
            {events.slice(0, 8).map(ev => (
              <div key={ev.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors border border-slate-100">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-[11px] text-slate-400 shrink-0 w-10">
                    {fmtTs(ev.occurredAt).slice(11, 16)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{ev.displayName ?? 'Unknown User'}</p>
                    <p className="font-mono text-[10px] text-slate-500 truncate mt-0.5">
                      {fmtMethod(ev.method)} · {ev.reason}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {ev.confidence > 0 && (
                    <span className="font-mono text-[11px] text-slate-500 font-semibold">{fmtConf(ev.confidence)}</span>
                  )}
                  <Badge tone={resultTone(ev.result)}>{resultLabel(ev.result)}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
