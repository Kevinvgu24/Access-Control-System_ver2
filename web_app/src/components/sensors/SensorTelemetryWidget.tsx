import { useState, useEffect } from 'react'
import { useLabStore } from '@/store/labStore'

export interface SubnodeCapability {
  id?: string
  name: string
  metric_key: string
  unit: string
  category?: string
}

export interface SubnodeInfo {
  id: string
  name: string
  sensors: string
  online: boolean
  sensor_ok: boolean
  error_msg: string | null
  last_updated: string | null
  capabilities?: SubnodeCapability[]
  data: Record<string, any>
}

interface TelemetryData {
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
  subnodes: SubnodeInfo[]
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
    online: false,
    subnodes: [
      {
        id: 'subnode1',
        name: 'Subnode 1',
        sensors: '',
        online: false,
        sensor_ok: false,
        error_msg: 'Disconnected',
        last_updated: null,
        data: {}
      },
      {
        id: 'subnode2',
        name: 'Subnode 2',
        sensors: '',
        online: false,
        sensor_ok: false,
        error_msg: 'Disconnected',
        last_updated: null,
        data: {}
      }
    ]
  })
  const [selectedSubnodeId, setSelectedSubnodeId] = useState<string>('subnode1')
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

  const subnodes = telemetry.subnodes || []
  const activeSubnode = subnodes.find(s => s.id === selectedSubnodeId) || subnodes[0]

  const tempColor = !telemetry.online 
    ? 'text-red-600 font-black' 
    : telemetry.temperature > 35 
    ? 'text-red-600' 
    : telemetry.temperature > 28 
    ? 'text-amber-600' 
    : 'text-emerald-600'

  const tempBg = !telemetry.online 
    ? 'bg-red-50/90 border-red-300' 
    : telemetry.temperature > 35 
    ? 'bg-red-50 border-red-200' 
    : telemetry.temperature > 28 
    ? 'bg-amber-50 border-amber-200' 
    : 'bg-emerald-50 border-emerald-200'

  const mapsUrl = telemetry.latitude && telemetry.longitude 
    ? `https://www.google.com/maps?q=${telemetry.latitude},${telemetry.longitude}` 
    : '#'

  // Helper renderer for dynamic metrics inside Subnode Inspection panel
  const renderMetricCard = (key: string, value: any) => {
    if (typeof value === 'object' || key === 'status_ok' || key === 'node_id') return null

    let title = key.replace('_', ' ').toUpperCase()
    let unit = ''
    let icon = '📊'
    let colorClass = 'text-indigo-300'

    if (key.includes('temp')) {
      title = 'Temperature'
      unit = '°C'
      icon = '🌡️'
      colorClass = 'text-emerald-400'
    } else if (key.includes('hum')) {
      title = 'Humidity'
      unit = '% RH'
      icon = '💧'
      colorClass = 'text-blue-400'
    } else if (key.includes('pm25') || key.includes('dust')) {
      title = 'PM2.5 Fine Dust'
      unit = 'µg/m³'
      icon = '🌫️'
      colorClass = value > 50 ? 'text-red-400' : value > 25 ? 'text-amber-400' : 'text-emerald-400'
    } else if (key.includes('co2')) {
      title = 'CO2 Concentration'
      unit = 'ppm'
      icon = '🍃'
      colorClass = 'text-emerald-300'
    } else if (key.includes('lux') || key.includes('light')) {
      title = 'Ambient Light'
      unit = 'Lux'
      icon = '☀️'
      colorClass = 'text-amber-300'
    } else if (key.includes('lat') || key.includes('lng') || key.includes('latitude')) {
      return null // Handled separately in GPS block
    }

    return (
      <div key={key} className="bg-slate-800/80 border border-slate-700 rounded-lg p-4">
        <div className="flex justify-between items-center">
          <span className="text-slate-400 text-[10px] uppercase font-bold">{title}</span>
          <span className="text-base">{icon}</span>
        </div>
        <p className={`text-2xl font-black mt-2 ${colorClass}`}>
          {activeSubnode.online ? `${value} ${unit}`.trim() : '--'}
        </p>
        <p className="text-[10px] text-slate-400 mt-2 font-mono">Key: {key}</p>
      </div>
    )
  }

  if (compact) {
    return (
      <div className="flex flex-col gap-3">
        <div className={`border-2 rounded-lg px-4 py-2.5 flex items-center justify-between shadow-sm transition-all ${
          telemetry.online 
            ? 'bg-emerald-50 border-emerald-300 text-slate-900' 
            : 'bg-amber-50 border-amber-400 text-red-700 animate-pulse'
        }`}>
          <div className="flex items-center gap-2 text-xs font-bold font-mono">
            <span className="text-base">{telemetry.online ? '🟢' : '🚨'}</span>
            <span className={telemetry.online ? 'text-slate-900' : 'text-red-700 font-extrabold'}>
              {telemetry.online 
                ? 'SYSTEM CONNECTED: Dynamic ESP32 subnodes active.' 
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

        <div className="grid grid-cols-3 gap-2">
          {subnodes.map((node) => {
            const cleanName = node.name ? node.name.split('-')[0].trim() : node.id
            return (
              <div
                key={node.id}
                onClick={() => setSelectedSubnodeId(node.id)}
                className={`border-2 rounded-lg p-2 cursor-pointer transition-all flex flex-col items-center justify-center text-center aspect-square ${
                  selectedSubnodeId === node.id ? 'ring-2 ring-indigo-500' : ''
                } ${node.online ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300'}`}
              >
                <span className="font-mono text-xs font-black text-slate-900 truncate w-full">{cleanName}</span>
                <span className={`mt-1.5 px-2 py-0.5 rounded text-[9px] font-mono font-black uppercase ${
                  node.online ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white animate-pulse'
                }`}>
                  {node.online ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Universal Status Notification Banner */}
      <div className={`border-2 rounded-xl p-4 flex items-center justify-between shadow-md transition-all ${
        telemetry.online 
          ? 'bg-emerald-50 border-emerald-300 text-slate-900' 
          : 'bg-amber-50 border-amber-400 text-red-700 animate-pulse'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-2xl shrink-0 ${
            telemetry.online ? 'bg-emerald-100 border border-emerald-300' : 'bg-red-100 border border-red-300'
          }`}>
            {telemetry.online ? '🟢' : '🚨'}
          </div>
          <div>
            <h4 className={`font-mono font-extrabold text-sm uppercase tracking-wider ${
              telemetry.online ? 'text-slate-900' : 'text-red-700'
            }`}>
              {telemetry.online 
                ? 'SYSTEM CONNECTED: DYNAMIC ESP32 SUBNODES ACTIVE' 
                : 'HARDWARE DISCONNECTION ALERT: ESP32 SUBNODES UNREACHABLE'}
            </h4>
            <p className={`text-xs mt-0.5 font-sans font-semibold ${
              telemetry.online ? 'text-slate-700' : 'text-red-600 font-bold'
            }`}>
              {telemetry.online 
                ? 'Raspberry Pi 5 is receiving dynamic sensor telemetry (DHT11, PM2.5 Dust, GNSS GPS, CO2) directly from ESP32 subnodes via MQTT.' 
                : 'Raspberry Pi 5 has not received MQTT telemetry data from subnodes (Timeout > 7 sec). Check Wi-Fi and power!'}
            </p>
          </div>
        </div>
        <span className={`px-3.5 py-1.5 font-mono text-xs font-black rounded-lg shadow-lg uppercase tracking-widest shrink-0 transition-all ${
          telemetry.online 
            ? 'bg-emerald-600 text-white border border-emerald-700 shadow-emerald-500/20' 
            : 'bg-red-600 text-white border border-red-700 shadow-red-500/30 animate-pulse'
        }`}>
          {telemetry.online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      {/* 2. Main Consolidated Telemetry Dashboard Table (FIRST IN SECTION) */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h3 className="font-mono text-xs uppercase font-extrabold text-slate-800 tracking-wider mb-4">
          Consolidated Telemetry Dashboard Table
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Temperature Card */}
          <div className={`border rounded-xl p-5 transition-all relative overflow-hidden shadow-sm ${
            telemetry.online ? tempBg : 'bg-red-50/90 border-red-300'
          }`}>
            <div className="flex justify-between items-start">
              <div>
                <p className="font-mono text-xs uppercase font-bold text-slate-600 tracking-wider">Environment Temp</p>
                <h4 className="text-xs text-slate-500 font-semibold mt-0.5">DHT11 Sensor</h4>
              </div>
              <span className="text-2xl">{telemetry.online ? '🌡️' : '🚨'}</span>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              {telemetry.online ? (
                <>
                  <span className={`text-5xl font-black tracking-tight ${tempColor}`}>
                    {loading ? '--' : telemetry.temperature.toFixed(1)}
                  </span>
                  <span className="text-lg font-bold text-slate-600">°C</span>
                </>
              ) : (
                <div className="py-2">
                  <span className="text-3xl font-black text-red-600 font-mono">OFFLINE</span>
                  <p className="text-xs font-bold text-red-600 mt-1">Subnode Signal Lost</p>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between font-mono text-xs">
              <span className="text-slate-600 font-semibold">Subnode 1 Status:</span>
              <span className={`px-2.5 py-1 rounded text-xs font-mono font-black uppercase tracking-wider ${
                telemetry.dht_ok && telemetry.online 
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                  : 'bg-red-600 text-white border border-red-700 animate-pulse'
              }`}>
                {telemetry.dht_ok && telemetry.online ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
          </div>

          {/* Humidity Card */}
          <div className={`border rounded-xl p-5 transition-all relative overflow-hidden shadow-sm ${
            telemetry.online ? 'bg-blue-50/50 border-blue-100' : 'bg-red-50/90 border-red-300'
          }`}>
            <div className="flex justify-between items-start">
              <div>
                <p className="font-mono text-xs uppercase font-bold text-slate-600 tracking-wider">Relative Humidity</p>
                <h4 className="text-xs text-slate-500 font-semibold mt-0.5">DHT11 Sensor</h4>
              </div>
              <span className="text-2xl">{telemetry.online ? '💧' : '🚨'}</span>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              {telemetry.online ? (
                <>
                  <span className="text-5xl font-black text-blue-700 tracking-tight">
                    {loading ? '--' : telemetry.humidity.toFixed(1)}
                  </span>
                  <span className="text-lg font-bold text-slate-600">% RH</span>
                </>
              ) : (
                <div className="py-2">
                  <span className="text-3xl font-black text-red-600 font-mono">OFFLINE</span>
                  <p className="text-xs font-bold text-red-600 mt-1">Subnode Signal Lost</p>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-blue-200/60 flex items-center justify-between font-mono text-xs">
              <span className="text-slate-600 font-semibold">Humidity Level:</span>
              <span className={`px-2.5 py-1 rounded text-xs font-mono font-black uppercase tracking-wider ${
                telemetry.online 
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                  : 'bg-red-600 text-white border border-red-700 animate-pulse'
              }`}>
                {telemetry.online ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
          </div>

          {/* GPS Location Card */}
          <div className={`border rounded-xl p-5 transition-all relative overflow-hidden shadow-sm flex flex-col justify-between ${
            telemetry.online ? 'bg-indigo-50/50 border-indigo-100' : 'bg-red-50/90 border-red-300'
          }`}>
            <div>
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-mono text-xs uppercase font-bold text-slate-600 tracking-wider">GNSS / GPS Location</p>
                  <h4 className="text-xs text-slate-500 font-semibold mt-0.5">LC76G Sensor</h4>
                </div>
                <span className="text-2xl">{telemetry.online ? '📡' : '🚨'}</span>
              </div>

              <div className="mt-4">
                {telemetry.online && telemetry.latitude ? (
                  <div>
                    <p className="font-mono text-xl font-bold text-indigo-950 tracking-tight">
                      {telemetry.latitude.toFixed(6)}° N
                    </p>
                    <p className="font-mono text-xl font-bold text-indigo-950 tracking-tight">
                      {telemetry.longitude.toFixed(6)}° E
                    </p>
                  </div>
                ) : telemetry.online ? (
                  <div className="flex items-center gap-2 text-indigo-700 font-mono text-sm py-2">
                    <span className="blink w-2 h-2 rounded-full bg-amber-500" />
                    <span>Searching Satellites…</span>
                  </div>
                ) : (
                  <div className="py-2">
                    <span className="text-3xl font-black text-red-600 font-mono">OFFLINE</span>
                    <p className="text-xs font-bold text-red-600 mt-1">Subnode 2 Unreachable</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-indigo-200/60 flex items-center justify-between font-mono text-xs">
              <div className="flex items-center gap-3 text-slate-700 font-bold">
                {telemetry.online ? (
                  <>
                    <span>🛸 {telemetry.satellites} Sats</span>
                    <span>⛰️ {telemetry.altitude.toFixed(0)}m Alt</span>
                  </>
                ) : (
                  <span className="text-red-700 font-extrabold">⚠️ Disconnected</span>
                )}
              </div>

              {telemetry.online && telemetry.latitude ? (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-bold text-xs rounded shadow-sm transition-colors flex items-center gap-1"
                >
                  <span>Google Maps</span> ↗
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Bottom Two-Column Split Layout: Inspection Panel (Left/Main) + Subnode Small Square Grid (Right Side) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Left Side (2 Columns): Dynamic Sensor Inspection Panel */}
        <div className="lg:col-span-2">
          {activeSubnode ? (
            <div className="bg-slate-900 text-white border border-slate-800 rounded-xl p-6 shadow-md">
              <div className="flex justify-between items-start border-b border-slate-800 pb-4 mb-4">
                <div>
                  <span className="font-mono text-[10px] text-indigo-400 uppercase font-extrabold tracking-widest">
                    Dynamic Sensor Inspection Panel
                  </span>
                  <h3 className="text-xl font-bold text-white mt-1">
                    {activeSubnode.name} Hardware Schema & Real-time Telemetry
                  </h3>
                  {activeSubnode.sensors && (
                    <p className="text-xs text-slate-400 mt-0.5">Declared Sensors: {activeSubnode.sensors}</p>
                  )}
                </div>

                <div className="flex items-center gap-3 font-mono text-xs">
                  <span className={`px-3 py-1 rounded font-extrabold uppercase ${
                    activeSubnode.online 
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                      : 'bg-red-600 text-white border border-red-700 animate-pulse'
                  }`}>
                    {activeSubnode.online ? '● SUBNODE ACTIVE' : '✖ SUBNODE OFFLINE'}
                  </span>
                </div>
              </div>

              {/* Render Dynamic Metrics from Subnode Data Payload */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono text-xs">
                {Object.entries(activeSubnode.data || {}).map(([key, val]) => renderMetricCard(key, val))}

                {/* GPS Block if present */}
                {activeSubnode.data.latitude ? (
                  <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-4">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 text-[10px] uppercase font-bold">GNSS GPS Position</span>
                      <span className="text-base">📡</span>
                    </div>
                    <p className="text-xl font-bold text-indigo-300 mt-2">
                      {activeSubnode.online 
                        ? `${Number(activeSubnode.data.latitude).toFixed(5)}°, ${Number(activeSubnode.data.longitude).toFixed(5)}°`
                        : 'No Fix'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-2 font-mono">
                      {activeSubnode.data.satellites || 0} Sats · {activeSubnode.data.altitude_m || 0}m Alt
                    </p>
                  </div>
                ) : null}

                {/* Diagnostic Health Card */}
                <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-4 flex flex-col justify-between">
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold">Health Diagnostic</span>
                    <p className={`text-sm font-bold mt-2 ${
                      activeSubnode.sensor_ok && activeSubnode.online ? 'text-emerald-400' : 'text-red-400 font-black'
                    }`}>
                      {activeSubnode.sensor_ok && activeSubnode.online 
                        ? '✓ Dynamic Schema Transmitting OK' 
                        : activeSubnode.error_msg || '⚠️ Subnode Fault Reported'}
                    </p>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2">
                    Heartbeat: {activeSubnode.last_updated ? new Date(activeSubnode.last_updated).toLocaleTimeString() : 'None'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 text-slate-400 p-8 rounded-xl text-center font-mono">
              Select a subnode from the grid to inspect details.
            </div>
          )}
        </div>

        {/* Right Side (1 Column): Subnodes Selection Grid (Small Square Cards, 3 Cards Per Row, Name + Online/Offline Only) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-mono text-xs uppercase font-extrabold text-slate-800 tracking-wider">
              Subnodes Grid
            </h3>
            <span className="font-mono text-[11px] text-slate-500 font-bold">
              {subnodes.filter(s => s.online).length}/{subnodes.length} Online
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {subnodes.map((node) => {
              const isSelected = node.id === selectedSubnodeId
              const cleanName = node.name ? node.name.split('-')[0].trim() : node.id
              return (
                <div
                  key={node.id}
                  onClick={() => setSelectedSubnodeId(node.id)}
                  className={`border-2 rounded-xl p-3 cursor-pointer transition-all flex flex-col items-center justify-center text-center aspect-square shadow-sm ${
                    isSelected 
                      ? 'border-indigo-600 ring-2 ring-indigo-500/20 bg-indigo-50/30' 
                      : node.online 
                      ? 'bg-emerald-50 border-emerald-300 hover:border-emerald-400' 
                      : 'bg-red-50 border-red-300 hover:border-red-400'
                  }`}
                >
                  <span className="font-mono text-xs font-black text-slate-900 truncate w-full">{cleanName}</span>
                  <span className={`mt-2 px-2 py-0.5 rounded text-[10px] font-mono font-black uppercase tracking-wider ${
                    node.online 
                      ? 'bg-emerald-600 text-white border border-emerald-700' 
                      : 'bg-red-600 text-white border border-red-700 shadow-sm animate-pulse'
                  }`}>
                    {node.online ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}
