import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeVisibleLabs, createLab } from '@/lib/db'
import { useLabStore } from '@/store/labStore'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import type { Lab } from '@/types/admin'

export function LabSelectorPage() {
  const [labs, setLabs] = useState<Lab[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { selectLab } = useLabStore()
  const { admin, labAccessIds } = useAuthStore()
  const navigate = useNavigate()

  // Quick Open Lab states
  const [showNewLabModal, setShowNewLabModal] = useState(false)
  const [newLabName, setNewLabName] = useState('')
  const [newLabCode, setNewLabCode] = useState('')
  const [newLabLocation, setNewLabLocation] = useState('')
  const [newLabManager, setNewLabManager] = useState('')
  const [creatingLab, setCreatingLab] = useState(false)

  useEffect(() => {
    if (!admin) {
      setLabs([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    return subscribeVisibleLabs({
      isSuperAdmin: admin.type === 'super_admin',
      labIds: labAccessIds,
      onData: nextLabs => {
        setLabs(nextLabs.filter(l => l.status !== 'inactive'))
        setLoading(false)
      },
      onError: err => {
        setError(err.message)
        setLoading(false)
      },
    })
  }, [admin, labAccessIds])

  const pick = (lab: Lab) => {
    selectLab(lab.id, lab.name)
    navigate('/overview')
  }

  const openCreateLabModal = () => {
    setNewLabName('')
    setNewLabCode('')
    setNewLabLocation('')
    setNewLabManager('')
    setShowNewLabModal(true)
  }

  const handleCreateLab = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newLabName.trim()) {
      alert('Lab Name is required')
      return
    }
    setCreatingLab(true)
    try {
      const newId = await createLab({
        name: newLabName.trim(),
        code: newLabCode.trim() || undefined,
        location: newLabLocation.trim() || '',
        timezone: 'Asia/Ho_Chi_Minh',
        manager: newLabManager.trim()
      }, admin?.firebaseUid ?? 'admin')
      alert(`Lab room "${newLabName}" created successfully!`)
      setShowNewLabModal(false)
      
      // Auto select and navigate to overview
      selectLab(newId, newLabName.trim())
      navigate('/overview')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create lab room')
    } finally {
      setCreatingLab(false)
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <p className="font-mono text-[11px] tracking-widest uppercase text-[#94a3b8] mb-3">Select</p>
          <h1 className="text-4xl font-bold tracking-tight text-[#0f172a]">Choose Lab</h1>
          <p className="text-sm text-[#475569] mt-2">
            {admin?.type === 'super_admin' ? 'All labs — super admin view.' : `You have access to ${labs.length} lab(s).`}
          </p>
        </div>
        {admin?.type === 'super_admin' && (
          <Button variant="primary" onClick={openCreateLabModal}>+ New Lab</Button>
        )}
      </div>

      {loading ? (
        <p className="font-mono text-xs text-[#94a3b8]">Loading labs…</p>
      ) : error ? (
        <div className="bg-surface border border-red/20 rounded-lg p-8 text-center shadow-sm">
          <p className="font-mono text-xs text-red">Failed to load labs: {error}</p>
        </div>
      ) : labs.length === 0 ? (
        <div className="bg-surface border border-line rounded-lg p-8 text-center shadow-sm">
          <p className="font-mono text-xs text-[#94a3b8]">
            {admin?.type === 'super_admin'
              ? 'No labs available. Click "+ New Lab" to create the first lab room.'
              : 'No active labs are assigned to this admin yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {labs.map(lab => (
            <button
              key={lab.id}
              onClick={() => pick(lab)}
              className="bg-surface border border-line rounded-lg p-6 text-left hover:border-green/25 hover:bg-green/5 transition-all cursor-pointer shadow-sm"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <span className={`inline-flex px-2 py-0.5 rounded font-mono text-[11px] border ${
                  lab.status === 'active'
                    ? 'bg-green/10 text-green border-green/20'
                    : 'bg-amber/10 text-amber border-amber/20'
                }`}>{lab.status}</span>
                <span className="font-mono text-[11px] text-[#94a3b8]">{lab.code}</span>
              </div>
              <p className="text-lg font-bold text-[#0f172a] leading-tight">{lab.name}</p>
              <p className="font-mono text-[11px] text-[#94a3b8] mt-2">{[lab.location, lab.manager].filter(Boolean).join(' · ') || '—'}</p>
            </button>
          ))}
        </div>
      )}

      {/* New Lab Creation Modal */}
      {showNewLabModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !creatingLab && setShowNewLabModal(false)} />
          <div className="relative z-10 w-full max-w-lg bg-surface border border-line rounded-xl shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-[#0f172a]">Open New Lab Room</h3>
              <button onClick={() => !creatingLab && setShowNewLabModal(false)} className="text-[#94a3b8] hover:text-[#0f172a] transition-colors text-xl cursor-pointer">✕</button>
            </div>
            
            <form onSubmit={handleCreateLab} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Lab Name</label>
                <input 
                  type="text" 
                  value={newLabName} 
                  onChange={e => setNewLabName(e.target.value)}
                  placeholder="e.g., IoT Lab C205"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-green/30 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Lab Code</label>
                <input 
                  type="text" 
                  value={newLabCode} 
                  onChange={e => setNewLabCode(e.target.value.toUpperCase())}
                  placeholder="e.g., IoT-C205"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-green/30 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Location</label>
                <input 
                  type="text" 
                  value={newLabLocation} 
                  onChange={e => setNewLabLocation(e.target.value)}
                  placeholder="e.g., Building C, Room 205"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-green/30 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Manager / Supervisor</label>
                <input 
                  type="text" 
                  value={newLabManager} 
                  onChange={e => setNewLabManager(e.target.value)}
                  placeholder="e.g., TS. Nguyen Van A"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-green/30 w-full"
                />
              </div>

              <div className="flex gap-2 justify-end mt-4">
                <Button variant="ghost" type="button" onClick={() => setShowNewLabModal(false)} disabled={creatingLab}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={creatingLab || !newLabName.trim()}>
                  {creatingLab ? 'Creating...' : 'Open Lab'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
