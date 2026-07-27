import { useState, useEffect } from 'react'
import { useLabStore } from '@/store/labStore'

export interface SubnodeInfo {
  id: string
  name: string
  sensors: string
  online: boolean
  sensor_ok: boolean
  error_msg: string | null
  last_updated: string | null
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
    dht_ok: false,
    gnss_ok: false,
    last_updated: null,
    online: false,
    subnodes: [
      {
        id: 'subnode1',
        name: 'Subnode 1 - Environment',
        sensors: 'DHT11 Temp & Humidity',
        online: false,
        sensor_ok: false,
        error_msg: 'Disconnected',
        last_updated: null,
        data: { temperature: 0, humidity: 0 }
      },
      {
        id: 'subnode2',
        name: 'Subnode 2 - GPS Tracker',
        sensors: 'LC76G GNSS Module',
        online: false,
        sensor_ok: false,
        error_msg: 'Disconnected',
        last_updated: null,
        data: { latitude: 0, longitude: 0, altitude: 0, satellites: 0 }
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

  if (compact) {
    return (
      <div className="flex flex-col gap-3">
        {/* Universal Status Notification Banner: Light Yellow bg + Red text when disconnected; White bg + Green text when connected */}
        <div className={`border-2 rounded-lg px-4 py-2.5 flex items-center justify-between shadow-sm transition-all ${
          telemetry.online 
            ? 'bg-white border-emerald-200 text-emerald-800' 
            : 'bg-amber-50 border-amber-300 text-red-700 animate-pulse'
        }`}>
          <div className="flex items-center gap-2 text-xs font-bold font-mono">
            <span className="text-base">{telemetry.online ? '🟢' : '🚨'}</span>
            <span className={telemetry.online ? 'text-emerald-800' : 'text-red-700'}>
              {telemetry.online 
                ? 'SYSTEM CONNECTED: Direct MQTT subnodes active.' 
                : 'HARDWARE DISCONNECTION ALERT: ESP32 SUBNODES UNREACHABLE!'}
            </span>
          </div>
          <span className={`px-2.5 py-0.5 text-[10px] font-mono font-black rounded uppercase tracking-wider ${
            telemetry.online ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}>
            {telemetry.online ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>

        {/* Subnode Quick Status Grid */}
        <div className="grid grid-cols-2 gap-3">
          {subnodes.map((node) => (
            <div
              key={node.id}
              onClick={() => setSelectedSubnodeId(node.id)}
              className={`border rounded-lg p-3 cursor-pointer transition-all ${
                selectedSubnodeId === node.id ? 'ring-2 ring-indigo-500' : ''
              } ${node.online ? 'bg-surface border-line' : 'bg-red-50/80 border-red-300'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-extrabold text-slate-800">{node.name}</span>
                <span className={`px-1.5 py-0.5 text-[9px] font-mono font-black rounded uppercase ${
                  node.online ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-red-600 text-white animate-pulse'
                }`}>
                  {node.online ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
              <p className="text-[10px] font-semibold text-slate-500 mt-1 truncate">{node.sensors}</p>
              {!node.online && (
                <p className="text-[10px] font-bold text-red-600 mt-1">⚠️ Disconnected</p>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Universal Status Notification Banner */}
      <div className={`border-2 rounded-xl p-4 flex items-center justify-between shadow-md transition-all ${
        telemetry.online 
          ? 'bg-white border-emerald-200 text-emerald-900' 
          : 'bg-amber-50 border-amber-300 text-red-700 animate-pulse'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-2xl shrink-0 ${
            telemetry.online ? 'bg-emerald-100 border border-emerald-200' : 'bg-red-100 border border-red-200'
          }`}>
            {telemetry.online ? '🟢' : '🚨'}
          </div>
          <div>
            <h4 className={`font-mono font-extrabold text-sm uppercase tracking-wider ${
              telemetry.online ? 'text-emerald-800' : 'text-red-700'
            }`}>
              {telemetry.online 
                ? 'SYSTEM CONNECTED: DIRECT ESP32 MQTT SUBNODES ACTIVE' 
                : 'HARDWARE DISCONNECTION ALERT: ESP32 SUBNODES UNREACHABLE'}
            </h4>
            <p className={`text-xs mt-0.5 font-sans font-semibold ${
              telemetry.online ? 'text-emerald-700' : 'text-red-600'
            }`}>
              {telemetry.online 
                ? 'Raspberry Pi 5 is successfully receiving telemetry directly from independent ESP32 subnodes via MQTT.' 
                : 'Raspberry Pi 5 has not received MQTT telemetry data from subnodes (Timeout > 7 sec). Check Wi-Fi and power!'}
            </p>
          </div>
        </div>
        <span className={`px-3 py-1 font-mono text-xs font-black rounded-md shadow uppercase tracking-widest shrink-0 ${
          telemetry.online ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {telemetry.online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      {/* Subnodes Selection Grid & Diagnostics Section */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-mono text-xs uppercase font-extrabold text-slate-700 tracking-wider">
            Active ESP32 Subnodes Grid (Click to Inspect)
          </h3>
          <span className="font-mono text-xs text-slate-500">
            {subnodes.filter(s => s.online).length} / {subnodes.length} Subnodes Online
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {subnodes.map((node) => {
            const isSelected = node.id === selectedSubnodeId
            return (
              <div
                key={node.id}
                onClick={() => setSelectedSubnodeId(node.id)}
                className={`border-2 rounded-xl p-5 cursor-pointer transition-all relative overflow-hidden shadow-sm hover:shadow-md ${
                  isSelected 
                    ? 'border-indigo-600 ring-2 ring-indigo-500/20 bg-indigo-50/20' 
                    : node.online 
                    ? 'border-line bg-surface hover:border-indigo-300' 
                    : 'border-red-300 bg-red-50/80'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-black text-slate-900">{node.name}</span>
                      <span className="font-mono text-[10px] text-slate-400 font-bold">({node.id})</span>
                    </div>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">{node.sensors}</p>
                  </div>

                  <span className={`px-2.5 py-1 rounded text-xs font-mono font-black uppercase tracking-wider ${
                    node.online && node.sensor_ok
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : node.online
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-red-600 text-white border border-red-700 animate-pulse'
                  }`}>
                    {node.online && node.sensor_ok ? 'ONLINE' : node.online ? 'SENSOR FAULT' : 'OFFLINE'}
                  </span>
                </div>

                {/* Subnode Sensor Brief Readout */}
                <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between font-mono text-xs">
                  <span className="text-slate-500">Last Telemetry:</span>
                  <span className="font-bold text-slate-800">
                    {node.last_updated ? new Date(node.last_updated).toLocaleTimeString() : 'No Data'}
                  </span>
                </div>

                {node.error_msg && !node.online && (
                  <div className="mt-2 px-3 py-1.5 bg-red-100 border border-red-200 rounded text-xs text-red-700 font-semibold font-mono flex items-center gap-2">
                    <span>🚨</span>
                    <span className="truncate">Fault: {node.error_msg}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Selected Subnode Inspection Panel */}
      {activeSubnode && (
        <div className="bg-slate-900 text-white border border-slate-800 rounded-xl p-6 shadow-md">
          <div className="flex justify-between items-start border-b border-slate-800 pb-4 mb-4">
            <div>
              <span className="font-mono text-[10px] text-indigo-400 uppercase font-extrabold tracking-widest">
                Detailed Inspection Panel
              </span>
              <h3 className="text-xl font-bold text-white mt-1">
                {activeSubnode.name} Diagnostic & Real-time Metrics
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Assigned Hardware Sensors: {activeSubnode.sensors}</p>
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

          {/* Subnode Sensor Diagnostic Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
            {activeSubnode.id === 'subnode1' || activeSubnode.data.temperature !== undefined ? (
              <>
                <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-4">
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Temperature</span>
                  <p className="text-3xl font-black text-emerald-400 mt-2">
                    {activeSubnode.online ? `${telemetry.temperature.toFixed(1)} °C` : '--'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-2">DHT11 Digital Pin GPIO4</p>
                </div>
                <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-4">
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Humidity</span>
                  <p className="text-3xl font-black text-blue-400 mt-2">
                    {activeSubnode.online ? `${telemetry.humidity.toFixed(1)} %` : '--'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-2">Relative Humidity Index</p>
                </div>
              </>
            ) : null}

            {activeSubnode.id === 'subnode2' || activeSubnode.data.latitude !== undefined ? (
              <>
                <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-4">
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Latitude / Longitude</span>
                  <p className="text-xl font-bold text-indigo-300 mt-2">
                    {activeSubnode.online && telemetry.latitude 
                      ? `${telemetry.latitude.toFixed(5)}°, ${telemetry.longitude.toFixed(5)}°` 
                      : 'No GNSS Fix'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-2">Waveshare LC76G UART</p>
                </div>
                <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-4">
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Satellites & Altitude</span>
                  <p className="text-xl font-bold text-amber-300 mt-2">
                    {activeSubnode.online ? `🛸 ${telemetry.satellites} Sats · ${telemetry.altitude.toFixed(0)}m` : '--'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-2">GNSS Active Tracking</p>
                </div>
              </>
            ) : null}

            <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold">Health Diagnostic</span>
                <p className={`text-sm font-bold mt-2 ${
                  activeSubnode.sensor_ok && activeSubnode.online ? 'text-emerald-400' : 'text-red-400 font-black'
                }`}>
                  {activeSubnode.sensor_ok && activeSubnode.online 
                    ? '✓ All Sensors Operating Normally' 
                    : activeSubnode.error_msg || '⚠️ Subnode Error Reported'}
                </p>
              </div>
              <p className="text-[10px] text-slate-400 mt-2">
                Last Heartbeat: {activeSubnode.last_updated ? new Date(activeSubnode.last_updated).toLocaleTimeString() : 'None'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Consolidated Telemetry Dashboard Table */}
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
                <h4 className="text-xs text-slate-500 font-semibold mt-0.5">Subnode 1 (DHT11)</h4>
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
                <h4 className="text-xs text-slate-500 font-semibold mt-0.5">Subnode 1 (DHT11)</h4>
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
                  <h4 className="text-xs text-slate-500 font-semibold mt-0.5">Subnode 2 (LC76G)</h4>
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
    </div>
  )
}
