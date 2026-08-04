import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel, PanelHeader } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useLabStore }  from '@/store/labStore'
import { useAuthStore } from '@/store/authStore'
import { useAdminStore } from '@/store/adminStore'
import { enrollUser } from '@/lib/db'

type Step = 'identity' | 'photos' | 'pin' | 'review'
const STEPS: { id: Step; num: string; label: string }[] = [
  { id: 'identity', num: '01', label: 'Identity Profile'  },
  { id: 'photos',   num: '02', label: 'Biometric Capture' },
  { id: 'pin',      num: '03', label: 'PIN Provision'     },
  { id: 'review',   num: '04', label: 'Review & Confirm'  },
]

type PhotoStatus = 'pending' | 'uploading' | 'accepted' | 'rejected'
interface PhotoSlot { id: string; label: string; status: PhotoStatus; url: string | null; file: File | null }

const initPhotos = (): PhotoSlot[] => [
  { id: 'p1', label: 'Front-facing, neutral', status: 'pending', url: null, file: null },
  { id: 'p2', label: 'Slight left angle',     status: 'pending', url: null, file: null },
  { id: 'p3', label: 'Slight right angle',    status: 'pending', url: null, file: null },
]

interface Draft {
  firstName: string; lastName: string; universityId: string; email: string; role: string
}

const initDraft = (): Draft => ({ firstName: '', lastName: '', universityId: '', email: '', role: 'student' })

export function EnrollmentPage() {
  const navigate = useNavigate()
  const { selectedLabId } = useLabStore()
  const { admin }         = useAuthStore()
  const { refreshUsers }  = useAdminStore()

  const [step, setStep]       = useState<Step>('identity')
  const [draft, setDraft]     = useState<Draft>(initDraft())
  const [photos, setPhotos]   = useState<PhotoSlot[]>(initPhotos())
  const [pin]                 = useState(String(Math.floor(100000 + Math.random() * 900000)))
  const [pinCopied, setPinCopied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState(false)

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const idx = STEPS.findIndex(s => s.id === step)

  const isUploading = false

  const handleFileSelect = async (slotId: string, file: File) => {
    try {
      const url = URL.createObjectURL(file)
      setPhotos(p => p.map(s => s.id === slotId
        ? { ...s, status: 'accepted', url, file }
        : s
      ))
    } catch (err) {
      console.error('File load error:', err)
      setPhotos(p => p.map(s => s.id === slotId ? { ...s, status: 'rejected' } : s))
    }
  }

  const copyPin = () => {
    void navigator.clipboard.writeText(pin)
    setPinCopied(true)
    setTimeout(() => setPinCopied(false), 2000)
  }

  const canContinue = () => {
    if (step === 'identity') {
      return (
        draft.firstName.trim() !== '' &&
        draft.lastName.trim() !== '' &&
        draft.universityId.trim() !== '' &&
        draft.email.trim() !== ''
      )
    }
    if (step === 'photos') {
      return photos.every(p => p.status === 'accepted')
    }
    return true
  }

  const handleConfirm = async () => {
    if (!selectedLabId) return setError('No lab selected.')
    setSubmitting(true)
    setError(null)
    try {
      const files = photos.filter(p => p.file).map(p => p.file!)
      await enrollUser({
        universityId: draft.universityId,
        fullName: `${draft.firstName} ${draft.lastName}`.trim(),
        email: draft.email,
        roles: [draft.role as import('@/types/admin').UserRole],
        labId: selectedLabId,
        pin,
        faceImageUrls: [],
        capturedBy: admin?.firebaseUid ?? 'admin',
        photos: files
      })
      await refreshUsers(selectedLabId)
      setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Enrollment failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return (
    <div className="flex flex-col gap-7">
      <div>
        <p className="font-mono text-[11px] tracking-widest uppercase text-[#94a3b8] mb-3">Done</p>
        <h1 className="text-4xl font-bold tracking-tight text-[#0f172a]">Administrator Enrolled</h1>
        <p className="text-sm text-[#475569] mt-2">{draft.firstName} {draft.lastName} has been added to the lab.</p>
      </div>
      <div className="flex gap-3">
        <Button variant="primary" onClick={() => { setDone(false); setStep('identity'); setDraft(initDraft()); setPhotos(initPhotos()) }}>Enroll Another</Button>
        <Button variant="ghost" onClick={() => navigate('/users')}>View Administrators</Button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-7">
      <div>
        <p className="font-mono text-[11px] tracking-widest uppercase text-orange-600 font-extrabold mb-2">Add New Administrator</p>
        <h1 className="text-4xl font-extrabold tracking-tight text-orange-600">Enrollment Wizard</h1>
        <p className="text-sm text-[#475569] mt-2">Step-by-step to prevent biometric data errors at the door.</p>
      </div>

      {/* Stepper */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {STEPS.map((s, i) => {
          const isActive = s.id === step, isDone = i < idx
          return (
            <button key={s.id} onClick={() => i <= idx && setStep(s.id)}
              className={`flex flex-col gap-2 p-4 rounded-lg border text-left transition-all ${
                isActive ? 'border-[#ea580c] bg-[#ffedd5] shadow-sm'
                : isDone  ? 'border-slate-200 bg-raised cursor-pointer'
                : 'border-slate-100 bg-raised cursor-not-allowed opacity-40'
              }`}>
              <span className={`font-mono text-[11px] ${isActive ? 'text-[#ea580c] font-extrabold' : 'text-slate-400 font-bold'}`}>{isDone ? '✓ done' : s.num}</span>
              <span className={`text-sm font-semibold ${isActive ? 'text-[#ea580c] font-extrabold' : 'text-slate-600'}`}>{s.label}</span>
            </button>
          )
        })}
      </div>

      {/* Step 1 - Identity */}
      {step === 'identity' && (
        <Panel>
          <PanelHeader eyebrow="Step 01" title="Identity Profile" />
          <div className="grid grid-cols-2 gap-5 max-w-xl">
            {([
              { key: 'firstName',   label: 'First Name',    ph: 'Nguyen'      },
              { key: 'lastName',    label: 'Last Name',     ph: 'Thien Trung' },
              { key: 'universityId',label: 'University ID', ph: '104240702'   },
              { key: 'email',       label: 'Email',         ph: 'student@university.edu', full: true },
            ] as { key: keyof Draft; label: string; ph: string; full?: boolean }[]).map(({ key, label, ph, full }) => (
              <div key={key} className={`flex flex-col gap-2 ${full ? 'col-span-2' : ''}`}>
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">{label}</label>
                <input value={draft[key] as string}
                  onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} placeholder={ph}
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 transition-colors"
                />
              </div>
            ))}
            <div className="flex flex-col gap-2">
              <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Role</label>
              <select value={draft.role} onChange={e => setDraft(d => ({ ...d, role: e.target.value }))}
                className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50">
                <option value="student">Student</option>
                <option value="lecturer">Lecturer</option>
                <option value="teacher_assistant">Teacher Assistant</option>
                <option value="guest">Guest</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
          </div>
        </Panel>
      )}

      {/* Step 2 - Photos */}
      {step === 'photos' && (
        <Panel>
          <PanelHeader eyebrow="Step 02" title="Biometric Capture" />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="flex flex-col gap-4 lg:col-span-8 xl:col-span-9">
              <p className="text-sm text-[#475569] leading-relaxed">Upload <strong className="text-[#0f172a]">3 clear photos</strong>. Good lighting, face fully visible.</p>
              <ul className="flex flex-col gap-2 lg:col-span-4 xl:col-span-3">
                {['No glasses or hat', 'Even lighting', 'Neutral expression', 'Face centered'].map(tip => (
                  <li key={tip} className="flex items-center gap-2.5 text-sm text-[#475569]">
                    <span className="w-1 h-1 rounded-full bg-green shrink-0" />{tip}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-3">
              {photos.map(photo => (
                <div key={photo.id}>
                  <input
                    ref={el => { fileRefs.current[photo.id] = el }}
                    type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(photo.id, f) }}
                  />
                  <div
                    onClick={() => fileRefs.current[photo.id]?.click()}
                    className={`flex items-center gap-4 px-5 py-4 rounded-lg border cursor-pointer transition-all ${
                      photo.status === 'accepted'  ? 'border-green/25 bg-green/5'
                      : photo.status === 'uploading' ? 'border-green/10 bg-green/3'
                      : photo.status === 'rejected'  ? 'border-red/20 bg-red/5'
                      : 'border-dashed border-slate-300 bg-raised hover:border-slate-400'
                    }`}>
                    <div className={`w-11 h-11 rounded flex items-center justify-center text-lg shrink-0 ${
                      photo.status === 'accepted'  ? 'bg-green/10 text-green'
                      : photo.status === 'uploading' ? 'bg-green/5 text-green'
                      : photo.status === 'rejected'  ? 'bg-red/10 text-red'
                      : 'bg-slate-200 text-[#94a3b8]'
                    }`}>
                      {photo.status === 'accepted' ? '✓' : photo.status === 'uploading' ? '...' : photo.status === 'rejected' ? 'x' : '↑'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#0f172a]">{photo.label}</p>
                      <p className="font-mono text-[11px] text-[#94a3b8] mt-1">
                        {photo.status === 'accepted'  ? 'Uploaded - Click to choose different file'
                         : photo.status === 'uploading' ? 'Uploading...'
                         : photo.status === 'rejected'  ? 'Upload failed - try again'
                         : 'Click to choose file'}
                      </p>
                    </div>
                    <Badge tone={
                      photo.status === 'accepted'  ? 'green'
                      : photo.status === 'uploading' ? 'blue'
                      : photo.status === 'rejected'  ? 'red'
                      : 'neutral'
                    }>{photo.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {/* Step 3 - PIN */}
      {step === 'pin' && (
        <Panel>
          <PanelHeader eyebrow="Step 03" title="PIN Provisioning" />
          <div className="flex flex-col gap-5 max-w-md">
            <p className="text-sm text-[#475569] leading-relaxed">Auto-generated 6-digit PIN. <strong className="text-[#0f172a]">Only shown once</strong> - deliver before saving.</p>
            <div className="border border-green/20 rounded-lg bg-green/5 px-7 py-6 flex flex-col gap-5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8]">Generated PIN</span>
              <strong className="font-mono text-6xl tracking-[0.3em] text-green leading-none">{pin}</strong>
              <div className="flex gap-2">
                <Button variant="primary" onClick={copyPin}>{pinCopied ? '✓ Copied!' : 'Copy PIN'}</Button>
              </div>
            </div>
            <div className="flex items-start gap-3 px-4 py-3.5 bg-amber/5 border border-amber/20 rounded text-sm text-amber">
              <span className="shrink-0">⚠️</span> PIN cannot be viewed again once saved. The node manifest must be regenerated via Cloud Function to activate it.
            </div>
          </div>
        </Panel>
      )}

      {/* Step 4 - Review */}
      {step === 'review' && (
        <Panel>
          <PanelHeader eyebrow="Step 04" title="Review & Confirm" />
          <div className="flex flex-col gap-3 max-w-lg">
            {[
              { label: 'Full Name',     value: `${draft.firstName} ${draft.lastName}`.trim() || '-' },
              { label: 'University ID', value: draft.universityId || '-' },
              { label: 'Email',         value: draft.email || '-' },
              { label: 'Role',          value: draft.role.charAt(0).toUpperCase() + draft.role.slice(1) },
              { label: 'Photos',        value: `${photos.filter(p => p.status === 'accepted').length} / 3 uploaded` },
              { label: 'PIN',           value: '••••••' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center gap-4 px-5 py-3.5 bg-raised border border-line rounded">
                <span className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">{label}</span>
                <span className="text-sm font-semibold text-[#0f172a]">{value}</span>
              </div>
            ))}
            {error && (
              <div className="flex items-start gap-2 px-4 py-3 bg-red/5 border border-red/20 rounded text-sm text-red">
                <span>⚠️</span> {error}
              </div>
            )}
            <Button variant="primary" className="mt-3 w-fit" onClick={handleConfirm} disabled={submitting}>
              {submitting ? 'Enrolling...' : 'Confirm & Enroll Administrator'}
            </Button>
          </div>
        </Panel>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => idx > 0 && setStep(STEPS[idx - 1].id)} disabled={idx === 0}>← Back</Button>
        {idx < STEPS.length - 1 && (
          <Button variant="primary" onClick={() => setStep(STEPS[idx + 1].id)} disabled={isUploading || !canContinue()}>
            {isUploading ? 'Uploading...' : 'Continue →'}
          </Button>
        )}
      </div>
    </div>
  )
}

