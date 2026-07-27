import { useState, useEffect } from 'react'
import { useLabStore } from '@/store/labStore'

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

export interface SubnodeData {
  id: string
  name: string
  online: boolean
  sensors?: string
  last_updated?: string
  data: Record<string, any>
  sensor_ok?: boolean
  error_msg?: string
}

export function SensorTelemetryWidget({ compact = false }: { compact?: boolean }) {
  const { selectedLabId } = useLabStore()

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
  
  const [subnodes, setSubnodes] = useState<SubnodeData[]>([
    {
      id: 'subnode-1',
      name: 'Subnode 1',
      online: true,
      sensors: 'DHT11 Temp & Humidity, PM2.5 Dust',
      sensor_ok: true,
      last_updated: new Date().toISOString(),
      data: { temperature: 28.5, humidity: 62.0, pm25: 18.4, co2: 420, light: 350 }
    },
    {
      id: 'subnode-2',
      name: 'Subnode 2',
      online: false,
      sensors: 'LC76G GNSS GPS, CO2 Sensor',
      sensor_ok: false,
      error_msg: 'Hardware Unreachable (MQTT Timeout > 7s)',
      last_updated: new Date(Date.now() - 15000).toISOString(),
      data: { latitude: 10.762622, longitude: 106.660172, satellites: 0 }
    }
  ])

  const [selectedSubnodeId, setSelectedSubnodeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchTelemetry = async () => {
    if (!selectedLabId) return
    try {
      const res = await fetch(`/api/labs/${selectedLabId}/sensors/latest`)
      if (res.ok) {
        const data = await res.json()
        setTelemetry(data)
        if (data.subnodes && Array.isArray(data.subnodes)) {
          setSubnodes(data.subnodes)
        }
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
    ? 'text-[#b91c1c] font-black' 
    : 'text-orange-600 font-black'

  const tempBg = 'bg-white border-slate-200'

  const mapsUrl = telemetry.latitude && telemetry.longitude 
    ? `https://www.google.com/maps?q=${telemetry.latitude},${telemetry.longitude}` 
    : '#'

  const activeSubnode = subnodes.find(s => s.id === selectedSubnodeId)

  if (compact) {
    return (
      <div className="flex flex-col gap-3">
        <div className={`border-2 rounded-lg px-4 py-2.5 flex items-center justify-between shadow-sm transition-all ${
          telemetry.online 
            ? 'bg-emerald-50 border-emerald-300 text-slate-900' 
            : 'bg-[#fce8e8] border-[#e06666]/40 text-[#e06666]'
        }`}>
          <div className="flex items-center gap-2 text-xs font-bold font-mono">
            <span className="text-base">{telemetry.online ? '🟢' : '🚨'}</span>
            <span className={telemetry.online ? 'text-slate-900' : 'text-[#e06666] font-extrabold'}>
              {telemetry.online 
                ? 'SYSTEM CONNECTED: Dynamic ESP32 sensor telemetry active.' 
                : 'HARDWARE DISCONNECTION ALERT: ESP32 SUBNODES UNREACHABLE!'}
            </span>
          </div>
          <span className={`px-2.5 py-1 text-[10px] font-mono font-black rounded uppercase tracking-wider ${
            telemetry.online 
              ? 'bg-emerald-600 text-white border border-emerald-700' 
              : 'bg-[#fce8e8] text-[#e06666] border border-[#e06666] shadow-md shadow-red-500/30 animate-pulse'
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
          : 'bg-[#fce8e8] border-[#e06666]/40 text-[#e06666]'
      }`}>
        <div className="flex items-center gap-3.5">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-2xl shrink-0 ${
            telemetry.online ? 'bg-emerald-100 border border-emerald-300' : 'bg-[#fce8e8] border border-[#e06666]/40'
          }`}>
            {telemetry.online ? '🟢' : '🚨'}
          </div>
          <div>
            <h4 className={`font-sans font-extrabold text-sm uppercase tracking-wide ${
              telemetry.online ? 'text-slate-900' : 'text-[#e06666] font-black'
            }`}>
              {telemetry.online 
                ? 'SYSTEM CONNECTED: DYNAMIC SENSOR TELEMETRY ACTIVE' 
                : 'HARDWARE DISCONNECTION ALERT: ESP32 SUBNODES UNREACHABLE'}
            </h4>
            <p className={`text-xs mt-0.5 font-sans font-bold ${
              telemetry.online ? 'text-slate-700' : 'text-[#e06666]'
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
            : 'bg-[#fce8e8] text-[#e06666] border border-[#e06666] shadow-red-500/30 animate-pulse'
        }`}>
          {telemetry.online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      {/* 2. Main 6-Column Grid Layout (Left: 4/6 Width | Right: 2/6 Width Subnodes List) */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-6 items-start">

        {/* LEFT PANEL (4/6 Width): Switches between Room Telemetry Overview OR Subnode Inspection Panel */}
        <div className="lg:col-span-4">
          {activeSubnode ? (
            /* Subnode Specific Inspection Panel */
            <div className="bg-slate-900 text-white border border-slate-800 rounded-xl p-6 shadow-md flex flex-col gap-5">
              <div className="flex justify-between items-start border-b border-slate-800 pb-4">
                <div>
                  <button 
                    onClick={() => setSelectedSubnodeId(null)}
                    className="font-mono text-xs text-orange-400 hover:text-orange-300 font-bold flex items-center gap-1.5 mb-2 transition-colors cursor-pointer"
                  >
                    <span>← Back to Room Telemetry Overview</span>
                  </button>
                  <h3 className="text-xl font-bold text-white tracking-tight">
                    {activeSubnode.name} — Hardware Inspection & Telemetry
                  </h3>
                  {activeSubnode.sensors && (
                    <p className="text-xs text-slate-400 mt-1 font-mono">
                      Declared Sensor Modules: <span className="text-slate-200 font-semibold">{activeSubnode.sensors}</span>
                    </p>
                  )}
                </div>

                <span className={`px-3 py-1 rounded text-xs font-mono font-black uppercase tracking-wider ${
                  activeSubnode.online && activeSubnode.sensor_ok
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : activeSubnode.online
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-red-600 text-white border border-red-700 animate-pulse'
                }`}>
                  {activeSubnode.online && activeSubnode.sensor_ok ? '● ONLINE (OK)' : activeSubnode.online ? '⚠️ WARNING' : '✖ OFFLINE'}
                </span>
              </div>

              {/* Dynamic Telemetry Metric Cards for Active Subnode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 font-mono text-xs">
                {Object.entries(activeSubnode.data || {}).map(([key, val]) => (
                  <div key={key} className="bg-slate-800/80 border border-slate-700 rounded-lg p-4 flex flex-col justify-between">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">{key.replace('_', ' ')}</span>
                      <span className="text-base">📊</span>
                    </div>
                    <p className="text-2xl font-black text-white mt-2">
                      {activeSubnode.online ? (typeof val === 'number' ? val.toFixed(1) : String(val)) : '--'}
                    </p>
                  </div>
                ))}

                {/* Subnode Hardware Health Card */}
                <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-4 flex flex-col justify-between col-span-full sm:col-span-2">
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Hardware Health Diagnostic</span>
                    <p className={`text-sm font-extrabold mt-2 ${
                      activeSubnode.sensor_ok && activeSubnode.online 
                        ? 'text-emerald-400' 
                        : activeSubnode.online 
                        ? 'text-amber-300' 
                        : 'text-red-400 font-black'
                    }`}>
                      {activeSubnode.sensor_ok && activeSubnode.online 
                        ? '✓ Hardware sensors operational & transmitting telemetry manifest OK' 
                        : activeSubnode.error_msg || '⚠️ Hardware disconnect or sensor timeout reported'}
                    </p>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-3 font-mono">
                    Last Heartbeat: {activeSubnode.last_updated ? new Date(activeSubnode.last_updated).toLocaleTimeString() : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Default: Room Telemetry Overview Panel (Occupies 4/6 width) */
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col gap-5">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <span className="font-mono text-[11px] text-orange-600 uppercase font-black tracking-widest">
                    Facility Environmental Metrics
                  </span>
                  <h3 className="font-mono text-base uppercase font-black text-orange-600 tracking-wider mt-0.5">
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

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 font-mono">
                {/* Temperature Card */}
                <div className="border rounded-xl p-4 transition-all flex flex-col justify-between shadow-sm bg-white border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase font-bold text-slate-600">Temperature</span>
                    <span className="text-xl">{telemetry.online ? '🌡️' : '🚨'}</span>
                  </div>
                  <p className={`text-3xl font-black mt-3 ${tempColor}`}>
                    {telemetry.online ? `${telemetry.temperature.toFixed(1)}°C` : '--'}
                  </p>
                </div>

                {/* Humidity Card */}
                <div className="border rounded-xl p-4 transition-all flex flex-col justify-between shadow-sm bg-white border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase font-bold text-slate-600">Humidity</span>
                    <span className="text-xl">{telemetry.online ? '💧' : '🚨'}</span>
                  </div>
                  <p className="text-3xl font-black text-orange-600 mt-3">
                    {telemetry.online ? `${telemetry.humidity.toFixed(1)}%` : '--'}
                  </p>
                </div>

                {/* PM2.5 Fine Dust */}
                <div className="border rounded-xl p-4 transition-all flex flex-col justify-between shadow-sm bg-white border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase font-bold text-slate-600">PM2.5 Dust</span>
                    <span className="text-xl">{telemetry.online ? '🌫️' : '🚨'}</span>
                  </div>
                  <p className="text-3xl font-black text-slate-900 mt-3">
                    {telemetry.online && telemetry.pm25 ? `${telemetry.pm25.toFixed(1)}` : '--'}
                    <span className="text-xs font-normal text-slate-500 ml-1">µg/m³</span>
                  </p>
                </div>

                {/* CO2 Concentration */}
                <div className="border rounded-xl p-4 transition-all flex flex-col justify-between shadow-sm bg-white border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase font-bold text-slate-600">CO2 Level</span>
                    <span className="text-xl">{telemetry.online ? '🍃' : '🚨'}</span>
                  </div>
                  <p className="text-3xl font-black text-orange-600 mt-3">
                    {telemetry.online && telemetry.co2 ? `${telemetry.co2}` : '--'}
                    <span className="text-xs font-normal text-slate-500 ml-1">ppm</span>
                  </p>
                </div>

                {/* Light Lux */}
                <div className="border rounded-xl p-4 transition-all flex flex-col justify-between shadow-sm bg-white border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase font-bold text-slate-600">Light Lux</span>
                    <span className="text-xl">{telemetry.online ? '☀️' : '🚨'}</span>
                  </div>
                  <p className="text-3xl font-black text-orange-600 mt-3">
                    {telemetry.online && telemetry.light ? `${telemetry.light}` : '--'}
                    <span className="text-xs font-normal text-slate-500 ml-1">Lux</span>
                  </p>
                </div>

                {/* GPS Location Card */}
                <div className="border rounded-xl p-4 transition-all flex flex-col justify-between shadow-sm bg-white border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase font-bold text-slate-600">GNSS GPS</span>
                    <span className="text-xl">{telemetry.online ? '📡' : '🚨'}</span>
                  </div>
                  <div className="mt-2">
                    {telemetry.online && telemetry.latitude ? (
                      <div>
                        <p className="text-xs font-bold text-slate-900 truncate">{telemetry.latitude.toFixed(4)}°N</p>
                        <p className="text-xs font-bold text-slate-900 truncate">{telemetry.longitude.toFixed(4)}°E</p>
                      </div>
                    ) : (
                      <p className="text-xs font-bold text-[#b91c1c] mt-1">No Fix / Offline</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono text-slate-500">
                <span>Last Updated: {telemetry.last_updated ? new Date(telemetry.last_updated).toLocaleTimeString() : 'N/A'}</span>
                {telemetry.online && telemetry.latitude ? (
                  <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline font-bold">
                    View Google Maps ↗
                  </a>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL (2/6 Width): Subnodes Selection List & Status Badges */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div>
              <span className="font-mono text-[11px] text-orange-600 uppercase font-black tracking-widest">
                ESP32 Hardware Nodes
              </span>
              <h3 className="font-mono text-xs uppercase font-extrabold text-orange-600 tracking-wider mt-0.5">
                Subnodes List
              </h3>
            </div>
            <span className="font-mono text-[11px] text-slate-500 font-bold">
              {subnodes.filter(s => s.online).length}/{subnodes.length} Online
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {subnodes.map((node) => {
              const isSelected = node.id === selectedSubnodeId
              return (
                <div
                  key={node.id}
                  onClick={() => setSelectedSubnodeId(isSelected ? null : node.id)}
                  className={`border rounded-xl p-3.5 cursor-pointer transition-all flex items-center justify-between shadow-sm ${
                    isSelected 
                      ? 'bg-orange-500 text-white border-transparent shadow-md font-bold' 
                      : node.online && node.sensor_ok
                      ? 'bg-white text-slate-900 border-slate-200 hover:bg-slate-100 hover:border-slate-300' 
                      : node.online
                      ? 'bg-amber-50/50 text-slate-900 border-amber-300 hover:bg-amber-100'
                      : 'bg-red-50 text-slate-900 border-red-300 hover:bg-red-100'
                  }`}
                >
                  <div className="min-w-0 flex flex-col gap-1">
                    <span className={`font-mono text-sm font-black truncate ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                      {node.name}
                    </span>
                    <span className={`text-[11px] truncate font-mono ${isSelected ? 'text-white/90' : 'text-slate-500'}`}>
                      {node.sensors ? node.sensors.split(',')[0] : 'ESP32 Subnode'}
                    </span>
                  </div>

                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-black uppercase tracking-wider shrink-0 ${
                    node.online && node.sensor_ok
                      ? 'bg-emerald-600 text-white border border-emerald-700' 
                      : node.online
                      ? 'bg-amber-500 text-white border border-amber-600'
                      : 'bg-red-600 text-white border border-red-700 shadow-sm animate-pulse'
                  }`}>
                    {node.online && node.sensor_ok ? 'ONLINE' : node.online ? 'WARNING' : 'OFFLINE'}
                  </span>
                </div>
              )
            })}
          </div>

          <p className="text-[11px] text-slate-400 font-mono text-center pt-2">
            Click any subnode to inspect detailed sensors on the left panel.
          </p>
        </div>

      </div>
    </div>
  )
}
