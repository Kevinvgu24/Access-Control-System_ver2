import { useState, useEffect } from 'react'
import { useLabStore } from '@/store/labStore'

interface SensorData {
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
}

export function SensorTelemetryWidget({ compact = false }: { compact?: boolean }) {
  const { selectedLabId } = useLabStore()
  const [sensor, setSensor] = useState<SensorData>({
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
    online: false
  })
  const [loading, setLoading] = useState(true)

  const fetchTelemetry = async () => {
    if (!selectedLabId) return
    try {
      const res = await fetch(`/api/labs/${selectedLabId}/sensors/latest`)
      if (res.ok) {
        const data = await res.json()
        setSensor(data)
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

  const tempColor = !sensor.online 
    ? 'text-red-600' 
    : sensor.temperature > 35 
    ? 'text-red-600' 
    : sensor.temperature > 28 
    ? 'text-amber-600' 
    : 'text-emerald-600'

  const tempBg = !sensor.online 
    ? 'bg-red-50/80 border-red-300' 
    : sensor.temperature > 35 
    ? 'bg-red-50 border-red-200' 
    : sensor.temperature > 28 
    ? 'bg-amber-50 border-amber-200' 
    : 'bg-emerald-50 border-emerald-200'

  const mapsUrl = sensor.latitude && sensor.longitude 
    ? `https://www.google.com/maps?q=${sensor.latitude},${sensor.longitude}` 
    : '#'

  if (compact) {
    return (
      <div className="flex flex-col gap-3">
        {/* Red Disconnection Alert Banner if Raspberry Pi 5 lost ESP32 connection */}
        {!sensor.online && (
          <div className="bg-red-600 text-white border border-red-700 px-4 py-2.5 rounded-lg flex items-center justify-between shadow-md animate-pulse">
            <div className="flex items-center gap-2 text-xs font-bold font-mono">
              <span className="text-base">🚨</span>
              <span>CẢNH BÁO MẤT KẾT NỐI: Raspberry Pi 5 không nhận được dữ liệu từ các node ESP32!</span>
            </div>
            <span className="px-2 py-0.5 bg-black/30 text-white text-[10px] font-mono font-bold rounded uppercase tracking-wider">
              DISCONNECTED
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {/* Temp & Hum Card */}
          <div className={`border rounded-lg p-4 flex flex-col justify-between shadow-sm transition-all ${
            !sensor.online ? 'bg-red-50/90 border-red-300' : 'bg-surface border-line'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase font-bold text-slate-600">Environmental (DHT11)</span>
              <span className={`w-2.5 h-2.5 rounded-full ${sensor.dht_ok && sensor.online ? 'bg-emerald-500 blink' : 'bg-red-600 blink'}`} />
            </div>
            <div className="flex items-baseline gap-4 mt-2">
              {sensor.online ? (
                <>
                  <div>
                    <span className="text-2xl font-extrabold text-slate-800 tracking-tight">{sensor.temperature.toFixed(1)}</span>
                    <span className="text-xs font-bold text-slate-500 ml-1">°C</span>
                  </div>
                  <div>
                    <span className="text-xl font-bold text-blue-600 tracking-tight">{sensor.humidity.toFixed(1)}</span>
                    <span className="text-xs font-bold text-slate-500 ml-1">% RH</span>
                  </div>
                </>
              ) : (
                <div>
                  <span className="text-lg font-black text-red-600 font-mono uppercase tracking-wider">-- MẤT NỐI --</span>
                  <p className="text-[10px] font-bold text-red-500">ESP32 #1 Offline</p>
                </div>
              )}
            </div>
          </div>

          {/* GPS Card */}
          <div className={`border rounded-lg p-4 flex flex-col justify-between shadow-sm transition-all ${
            !sensor.online ? 'bg-red-50/90 border-red-300' : 'bg-surface border-line'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase font-bold text-slate-600">GNSS Location (LC76G)</span>
              <span className={`w-2.5 h-2.5 rounded-full ${sensor.gnss_ok && sensor.online ? 'bg-emerald-500 blink' : 'bg-red-600 blink'}`} />
            </div>
            <div className="mt-2 flex items-center justify-between">
              {sensor.online ? (
                <>
                  <div>
                    <p className="font-mono text-xs font-bold text-slate-800">
                      {sensor.latitude ? `${sensor.latitude.toFixed(4)}°, ${sensor.longitude.toFixed(4)}°` : 'Acquiring GPS...'}
                    </p>
                    <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                      {sensor.satellites} Sats · {sensor.altitude.toFixed(0)}m Alt
                    </p>
                  </div>
                  {sensor.latitude ? (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold rounded border border-indigo-200 transition-colors"
                    >
                      Map ↗
                    </a>
                  ) : null}
                </>
              ) : (
                <div>
                  <span className="text-lg font-black text-red-600 font-mono uppercase tracking-wider">-- MẤT NỐI --</span>
                  <p className="text-[10px] font-bold text-red-500">ESP32 #2 Gateway Offline</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Prominent Red Alert Banner if Raspberry Pi 5 lost ESP32 connection */}
      {!sensor.online && (
        <div className="bg-red-600 text-white border-2 border-red-700 rounded-xl p-4 flex items-center justify-between shadow-lg animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-black/20 flex items-center justify-center text-2xl shrink-0">
              🚨
            </div>
            <div>
              <h4 className="font-mono font-extrabold text-sm uppercase tracking-wider">
                CẢNH BÁO MẤT KẾT NỐI VỚI THIẾT BỊ ESP32
              </h4>
              <p className="text-xs text-red-100 mt-0.5 font-sans font-medium">
                Raspberry Pi 5 đã mất tín hiệu nhận dữ liệu MQTT từ trạm ESP32 #1 & ESP32 #2 (Timeout &gt; 7 giây). Kiểm tra nguồn điện và kết nối Wi-Fi!
              </p>
            </div>
          </div>
          <span className="px-3 py-1 bg-white text-red-700 font-mono text-xs font-black rounded-md shadow uppercase tracking-widest shrink-0">
            DISCONNECTED
          </span>
        </div>
      )}

      {/* Top Header Card */}
      <div className={`border rounded-xl p-6 shadow-md relative overflow-hidden text-white transition-all ${
        sensor.online 
          ? 'bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-indigo-900/50' 
          : 'bg-gradient-to-r from-red-950 via-rose-950 to-red-900 border-red-700/50'
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg border flex items-center justify-center text-xl ${
              sensor.online ? 'bg-indigo-500/20 border-indigo-400/30' : 'bg-red-500/20 border-red-400/30'
            }`}>
              {sensor.online ? '🛰️' : '⚠️'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg text-white">ESP32 IoT Sensor & GPS Telemetry</h3>
                <span className={`px-2 py-0.5 border text-[10px] font-mono rounded font-semibold uppercase tracking-wider ${
                  sensor.online 
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' 
                    : 'bg-red-500/30 text-red-200 border-red-400/40'
                }`}>
                  {sensor.online ? 'MQTT Protocol / Connected' : 'MQTT Broker / Disconnected'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                2 ESP32 Nodes (ESP-NOW Mesh) ➔ RPi 5 MQTT Broker ➔ Web Dashboard
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 bg-white/10 border border-white/15 px-4 py-2 rounded-lg font-mono text-xs text-slate-200">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${sensor.online ? 'bg-emerald-400 blink' : 'bg-red-500 blink'}`} />
              <span>Trạng Thái RPi 5: <strong className={sensor.online ? 'text-emerald-400' : 'text-red-400 font-bold'}>
                {sensor.online ? 'Đang Nhận Dữ Liệu' : 'MẤT KẾT NỐI ESP32'}
              </strong></span>
            </div>
            <span className="text-slate-500">|</span>
            <div>
              Cập nhật: <strong className="text-white">{sensor.last_updated ? new Date(sensor.last_updated).toLocaleTimeString() : 'Không có dữ liệu'}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Main Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Temperature Card */}
        <div className={`border rounded-xl p-5 transition-all relative overflow-hidden shadow-sm ${
          sensor.online ? tempBg : 'bg-red-50/90 border-red-300'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <p className="font-mono text-xs uppercase font-bold text-slate-600 tracking-wider">Environment Temp</p>
              <h4 className="text-xs text-slate-500 font-semibold mt-0.5">ESP32 #1 DHT11 Sensor</h4>
            </div>
            <span className="text-2xl">{sensor.online ? '🌡️' : '🚨'}</span>
          </div>

          <div className="mt-4 flex items-baseline gap-2">
            {sensor.online ? (
              <>
                <span className={`text-5xl font-black tracking-tight ${tempColor}`}>
                  {loading ? '--' : sensor.temperature.toFixed(1)}
                </span>
                <span className="text-lg font-bold text-slate-600">°C</span>
              </>
            ) : (
              <div className="py-2">
                <span className="text-3xl font-black text-red-600 font-mono">OFFLINE</span>
                <p className="text-xs font-bold text-red-500 mt-1">Không nhận được tín hiệu</p>
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between font-mono text-xs">
            <span className="text-slate-600 font-semibold">Trạng thái Node 1:</span>
            <span className={`px-2 py-0.5 rounded font-bold ${sensor.dht_ok && sensor.online ? 'bg-emerald-100 text-emerald-800' : 'bg-red-600 text-white'}`}>
              {sensor.dht_ok && sensor.online ? 'HOẠT ĐỘNG' : 'MẤT KẾT NỐI (RED ALERT)'}
            </span>
          </div>
        </div>

        {/* Humidity Card */}
        <div className={`border rounded-xl p-5 transition-all relative overflow-hidden shadow-sm ${
          sensor.online ? 'bg-blue-50/50 border-blue-100' : 'bg-red-50/90 border-red-300'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <p className="font-mono text-xs uppercase font-bold text-slate-600 tracking-wider">Relative Humidity</p>
              <h4 className="text-xs text-slate-500 font-semibold mt-0.5">ESP32 #1 DHT11 Sensor</h4>
            </div>
            <span className="text-2xl">{sensor.online ? '💧' : '🚨'}</span>
          </div>

          <div className="mt-4 flex items-baseline gap-2">
            {sensor.online ? (
              <>
                <span className="text-5xl font-black text-blue-700 tracking-tight">
                  {loading ? '--' : sensor.humidity.toFixed(1)}
                </span>
                <span className="text-lg font-bold text-slate-600">% RH</span>
              </>
            ) : (
              <div className="py-2">
                <span className="text-3xl font-black text-red-600 font-mono">OFFLINE</span>
                <p className="text-xs font-bold text-red-500 mt-1">Không nhận được tín hiệu</p>
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-blue-200/60 flex items-center justify-between font-mono text-xs">
            <span className="text-slate-600 font-semibold">Cảm biến ẩm:</span>
            <span className={`px-2 py-0.5 rounded font-bold ${sensor.online ? 'text-blue-900' : 'bg-red-600 text-white'}`}>
              {sensor.online ? (sensor.humidity > 70 ? 'Độ ẩm cao' : 'Độ ẩm chuẩn') : 'MẤT KẾT NỐI'}
            </span>
          </div>
        </div>

        {/* GPS Location Card */}
        <div className={`border rounded-xl p-5 transition-all relative overflow-hidden shadow-sm flex flex-col justify-between ${
          sensor.online ? 'bg-indigo-50/50 border-indigo-100' : 'bg-red-50/90 border-red-300'
        }`}>
          <div>
            <div className="flex justify-between items-start">
              <div>
                <p className="font-mono text-xs uppercase font-bold text-slate-600 tracking-wider">GNSS / GPS Coordinates</p>
                <h4 className="text-xs text-slate-500 font-semibold mt-0.5">ESP32 #2 Waveshare LC76G</h4>
              </div>
              <span className="text-2xl">{sensor.online ? '📡' : '🚨'}</span>
            </div>

            <div className="mt-4">
              {sensor.online && sensor.latitude ? (
                <div>
                  <p className="font-mono text-xl font-bold text-indigo-950 tracking-tight">
                    {sensor.latitude.toFixed(6)}° N
                  </p>
                  <p className="font-mono text-xl font-bold text-indigo-950 tracking-tight">
                    {sensor.longitude.toFixed(6)}° E
                  </p>
                </div>
              ) : sensor.online ? (
                <div className="flex items-center gap-2 text-indigo-700 font-mono text-sm py-2">
                  <span className="blink w-2 h-2 rounded-full bg-amber-500" />
                  <span>Searching Satellites…</span>
                </div>
              ) : (
                <div className="py-2">
                  <span className="text-3xl font-black text-red-600 font-mono">OFFLINE</span>
                  <p className="text-xs font-bold text-red-500 mt-1">ESP32 #2 Mất kết nối MQTT</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-indigo-200/60 flex items-center justify-between font-mono text-xs">
            <div className="flex items-center gap-3 text-slate-700 font-bold">
              {sensor.online ? (
                <>
                  <span>🛸 {sensor.satellites} Sats</span>
                  <span>⛰️ {sensor.altitude.toFixed(0)}m Alt</span>
                </>
              ) : (
                <span className="text-red-700 font-bold">⚠️ Gateway Offline</span>
              )}
            </div>

            {sensor.online && sensor.latitude ? (
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
  )
}
