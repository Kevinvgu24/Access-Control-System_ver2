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
  const [activationCode, setActivationCode] = useState<string>('')
  const [nodeActivatedAt, setNodeActivatedAt] = useState<string>('')
  const [nodeActivatedBy, setNodeActivatedBy] = useState<string>('')
  const [labCreator, setLabCreator]         = useState<string>('')

  useEffect(() => {
    if (!selectedLabId) return
    fetch('/api/labs')
      .then(res => res.json())
      .then((labs: Array<{ id: string; code: string; manager?: string; activationCode?: string; nodeActivatedAt?: string; nodeActivatedBy?: string }>) => {
        const found = labs.find(l => l.id === selectedLabId || l.code === selectedLabId)
        if (found) {
          setActivationCode(found.activationCode || `ACT-${(found.code || '304').toUpperCase()}`)
          setNodeActivatedAt(found.nodeActivatedAt || '')
          setNodeActivatedBy(found.nodeActivatedBy || '')
          setLabCreator(found.manager || 'Kevin (dawnnkevin9@gmail.com)')
        } else {
          setActivationCode(`ACT-${(selectedLabId || '304').toUpperCase()}`)
          setNodeActivatedAt('')
          setNodeActivatedBy('')
          setLabCreator(admin?.email || 'Kevin (dawnnkevin9@gmail.com)')
        }
      })
      .catch(() => {
        setActivationCode(`ACT-${(selectedLabId || '304').toUpperCase()}`)
        setNodeActivatedAt('')
        setNodeActivatedBy('')
        setLabCreator(admin?.email || 'Kevin (dawnnkevin9@gmail.com)')
      })
  }, [selectedLabId, admin])

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
      </div>

      {/* Node Deployment & Activation Security Badge */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-orange-950/40 border border-orange-500/30 rounded-xl p-5 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400 text-xl font-bold shrink-0">
            🔐
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-orange-400 font-extrabold uppercase tracking-wider">Raspberry Pi 5 Node Deployment Security</span>
              <span className="px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 text-[10px] font-mono font-bold">Lab Passcode</span>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono font-bold border border-blue-500/30">
                👤 Người Tạo Lab: {labCreator || admin?.email || 'Kevin (dawnnkevin9@gmail.com)'}
              </span>
            </div>
            <p className="text-sm font-semibold text-slate-200 mt-1">
              Mã Kích Hoạt (Activation Code) cho Phòng Lab <span className="text-orange-400 font-bold">{selectedLabId || '304'}</span> (Tạo bởi: <span className="text-blue-400 font-mono font-bold">{labCreator || admin?.email || 'Kevin'}</span>):
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Nhập mã kích hoạt này trên màn hình cài đặt Raspberry Pi 5 lần đầu để xác thực quyền quản lý và gán thiết bị vào phòng lab.
            </p>
            {nodeActivatedAt && (
              <div className="mt-2 flex items-center gap-3 text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-3 py-1 rounded-md">
                <span>🕒 Ngày giờ kích hoạt: <strong className="text-emerald-300">{nodeActivatedAt}</strong></span>
                <span>•</span>
                <span>👤 Kích hoạt bởi Admin: <strong className="text-emerald-300">{nodeActivatedBy || 'Kevin'}</strong></span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 self-stretch md:self-auto bg-slate-950 px-4 py-2.5 rounded-lg border border-orange-500/40">
          <span className="font-mono text-xl font-black tracking-widest text-orange-400">
            {activationCode || `ACT-${(selectedLabId || '304').toUpperCase()}`}
          </span>
          <button
            onClick={() => {
              const codeToCopy = activationCode || `ACT-${(selectedLabId || '304').toUpperCase()}`
              navigator.clipboard.writeText(codeToCopy)
              alert(`Đã sao chép mã kích hoạt: ${codeToCopy}`)
            }}
            className="text-xs font-mono bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 px-3 py-1.5 rounded border border-orange-500/30 transition-colors font-bold active:scale-95 cursor-pointer"
          >
            📋 Sao chép
          </button>
        </div>
      </div>

      {/* Embedded Full ESP32 Sensor & GPS Telemetry Widget */}
      <SensorTelemetryWidget compact={false} />

      {/* Main Two-Column Layout (Matching Sensor Telemetry Widget 4/6 and 2/6 Grid Alignment) */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-6 items-start">
        {/* Left Column (4/6 Width): IR Live View Stream & Hardware Performance */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <Panel>
            <PanelHeader eyebrow="Camera Monitoring" title={`IR Live View Stream — LAB: ${selectedLabId || '304'}`} />
            {selectedLabId && selectedNodeId ? (
              <LiveCamera labId={selectedLabId} nodeId={selectedNodeId} />
            ) : (
              <div className="aspect-video bg-slate-950 rounded-lg border border-line flex flex-col items-center justify-center gap-3">
                <span className="text-2xl">📷</span>
                <p className="font-mono text-xs text-slate-500 uppercase tracking-widest">No Node Selected</p>
                <p className="font-sans text-xs text-slate-600 max-w-xs text-center">Please select an active node to view the camera stream.</p>
              </div>
            )}
          </Panel>

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
        </div>

        {/* Right Column (2/6 Width): Recognition Controls & Operational Tuning */}
        <div className="lg:col-span-2 flex flex-col gap-6">
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
