import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeVisibleLabs, createLab, updateLab, archiveLab } from '@/lib/db'
import { useLabStore } from '@/store/labStore'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import type { Lab } from '@/types/admin'

export function LabSelectorPage() {
  const [labs, setLabs] = useState<Lab[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { selectLab, warning, setWarning } = useLabStore()
  const { admin, labAccessIds } = useAuthStore()
  const navigate = useNavigate()

  // Quick Open Lab states
  const [showNewLabModal, setShowNewLabModal] = useState(false)
  const [newLabName, setNewLabName] = useState('')
  const [newLabCode, setNewLabCode] = useState('')
  const [newLabLocation, setNewLabLocation] = useState('')
  const [newLabManager, setNewLabManager] = useState('')
  const [creatingLab, setCreatingLab] = useState(false)

  // Edit Lab states
  const [showEditLabModal, setShowEditLabModal] = useState(false)
  const [editLabId, setEditLabId] = useState('')
  const [editLabName, setEditLabName] = useState('')
  const [editLabCode, setEditLabCode] = useState('')
  const [editLabLocation, setEditLabLocation] = useState('')
  const [editLabManager, setEditLabManager] = useState('')
  const [updatingLab, setUpdatingLab] = useState(false)

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

  const handleUpdateLab = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editLabName.trim()) {
      alert('Lab Name is required')
      return
    }
    setUpdatingLab(true)
    try {
      await updateLab(editLabId, {
        name: editLabName.trim(),
        code: editLabCode.trim() || undefined,
        location: editLabLocation.trim() || '',
        manager: editLabManager.trim()
      })
      alert(`Lab room "${editLabName}" updated successfully!`)
      setShowEditLabModal(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update lab room')
    } finally {
      setUpdatingLab(false)
    }
  }

  const handleDeleteLab = async (labId: string, labName: string) => {
    if (confirm(`Are you sure you want to permanently delete "${labName}"?\nWARNING: This will permanently delete the lab room and all its configurations, schedules, clusters, nodes, and event logs.`)) {
      try {
        await archiveLab(labId)
        // If the deleted lab was the currently selected one, clear the selection
        const { selectedLabId, clearLab } = useLabStore.getState()
        if (selectedLabId === labId) {
          clearLab()
        }
        alert(`Lab room "${labName}" and all associated data have been permanently deleted.`)
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to delete lab room')
      }
    }
  }

  return (
    <div className="flex flex-col gap-7">
      {warning && (
        <div className="bg-amber/10 border border-amber/20 text-amber text-xs font-mono px-4 py-3 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{warning}</span>
          </div>
          <button 
            onClick={() => setWarning(null)} 
            className="text-amber/60 hover:text-amber cursor-pointer text-sm font-bold"
          >
            ✕
          </button>
        </div>
      )}
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {labs.map(lab => (
            <div
              key={lab.id}
              onClick={() => pick(lab)}
              className="group bg-surface border border-line rounded-xl p-5 text-left hover:border-orange-500/40 hover:bg-orange-500/5 transition-all cursor-pointer shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <span className={`inline-flex px-2 py-0.5 rounded font-mono text-[11px] font-bold border ${
                    lab.status === 'active'
                      ? 'bg-green/10 text-green border-green/20'
                      : 'bg-amber/10 text-amber border-amber/20'
                  }`}>{lab.status}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-[#64748b] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">{lab.code}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditLabId(lab.id)
                        setEditLabName(lab.name)
                        setEditLabCode(lab.code || '')
                        setEditLabLocation(lab.location || '')
                        setEditLabManager(lab.manager || '')
                        setShowEditLabModal(true)
                      }}
                      className="text-blue/60 hover:text-blue transition-colors text-[11px] font-mono px-1.5 py-0.5 rounded hover:bg-blue/5 flex items-center gap-1 border border-transparent hover:border-blue/10 cursor-pointer"
                      title="Edit Lab"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteLab(lab.id, lab.name)
                      }}
                      className="text-red/60 hover:text-red transition-colors text-[11px] font-mono px-1.5 py-0.5 rounded hover:bg-red/5 flex items-center gap-1 border border-transparent hover:border-red/10 cursor-pointer"
                      title="Delete Lab"
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </div>
                <p className="text-xl font-extrabold text-[#0f172a] leading-tight">{lab.name}</p>
                <p className="font-mono text-[11px] text-[#64748b] mt-1.5 flex items-center gap-1.5">
                  <span>📍 {[lab.location, lab.manager ? `Quản lý: ${lab.manager}` : ''].filter(Boolean).join(' · ') || '—'}</span>
                </p>
              </div>

              {/* RPi 5 Node Security Passcode & Audit Badge */}
              <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-slate-800/80 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2">
                  <div className="flex flex-col min-w-0">
                    <span className="font-mono text-[10px] text-orange-600 font-extrabold uppercase tracking-wider flex items-center gap-1">
                      🔐 RPi5 Passcode
                    </span>
                    <span className="font-mono text-sm font-black text-orange-600 truncate">
                      {lab.activationCode || `ACT-${(lab.code || '304').toUpperCase()}`}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const codeToCopy = lab.activationCode || `ACT-${(lab.code || '304').toUpperCase()}`
                      navigator.clipboard.writeText(codeToCopy)
                      alert(`Đã sao chép mã kích hoạt RPi5: ${codeToCopy}`)
                    }}
                    className="text-[11px] font-mono bg-orange-500/20 hover:bg-orange-500/30 text-orange-700 font-bold px-2.5 py-1 rounded border border-orange-500/30 transition-colors shrink-0 cursor-pointer active:scale-95"
                    title="Sao chép mã kích hoạt"
                  >
                    📋 Copy
                  </button>
                </div>

                {lab.nodeActivatedAt && (
                  <div className="flex flex-col gap-0.5 px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-[10px] font-mono text-emerald-700">
                    <span className="font-bold truncate">🕒 Kích hoạt: {lab.nodeActivatedAt}</span>
                    <span className="truncate">👤 Admin: {lab.nodeActivatedBy || 'Kevin'}</span>
                  </div>
                )}
              </div>
            </div>
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
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Lab Code</label>
                <input 
                  type="text" 
                  value={newLabCode} 
                  onChange={e => setNewLabCode(e.target.value.toUpperCase())}
                  placeholder="e.g., IoT-C205"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Location</label>
                <input 
                  type="text" 
                  value={newLabLocation} 
                  onChange={e => setNewLabLocation(e.target.value)}
                  placeholder="e.g., Building C, Room 205"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Manager / Supervisor</label>
                <input 
                  type="text" 
                  value={newLabManager} 
                  onChange={e => setNewLabManager(e.target.value)}
                  placeholder="e.g., TS. Nguyen Van A"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 w-full"
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

      {/* Edit Lab Modal */}
      {showEditLabModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !updatingLab && setShowEditLabModal(false)} />
          <div className="relative z-10 w-full max-w-lg bg-surface border border-line rounded-xl shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-[#0f172a]">Edit Lab Room Details</h3>
              <button onClick={() => !updatingLab && setShowEditLabModal(false)} className="text-[#94a3b8] hover:text-[#0f172a] transition-colors text-xl cursor-pointer">✕</button>
            </div>
            
            <form onSubmit={handleUpdateLab} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Lab Name</label>
                <input 
                  type="text" 
                  value={editLabName} 
                  onChange={e => setEditLabName(e.target.value)} 
                  placeholder="e.g., IoT Lab C205"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 w-full"
                  disabled={updatingLab}
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Lab Code</label>
                <input 
                  type="text" 
                  value={editLabCode} 
                  onChange={e => setEditLabCode(e.target.value.toUpperCase())} 
                  placeholder="e.g., IoT-C205"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 w-full"
                  disabled={updatingLab}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Location</label>
                <input 
                  type="text" 
                  value={editLabLocation} 
                  onChange={e => setEditLabLocation(e.target.value)} 
                  placeholder="e.g., Building C, Room 205"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 w-full"
                  disabled={updatingLab}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Manager / Supervisor</label>
                <input 
                  type="text" 
                  value={editLabManager} 
                  onChange={e => setEditLabManager(e.target.value)} 
                  placeholder="e.g., TS. Nguyen Van A"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 w-full"
                  disabled={updatingLab}
                />
              </div>

              <div className="flex gap-2 justify-end mt-4">
                <Button 
                  variant="ghost" 
                  type="button" 
                  onClick={() => setShowEditLabModal(false)}
                  disabled={updatingLab}
                >
                  Cancel
                </Button>
                <Button 
                  variant="primary" 
                  type="submit"
                  disabled={updatingLab || !editLabName.trim()}
                >
                  {updatingLab ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
