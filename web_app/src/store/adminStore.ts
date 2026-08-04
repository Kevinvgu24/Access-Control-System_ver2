import { create } from 'zustand'
import {
  subscribeAccessEvents, subscribeIncidents, subscribeNodeState,
  getFirstLabNode, getLabUsers, getNodeConfig, deleteUser,
  updateUser, resetUserPin, updateUserStatus
} from '@/lib/db'
import type { AccessEvent, User, Incident, SystemStatus, NodeState, NodeConfig, Equipment } from '@/types/admin'
import { fmtTs } from '@/lib/format'
import { useLabStore } from '@/store/labStore'

// ── Helpers ─────────────────────────────────────────────────────────────────

function isToday(ts: any): boolean {
  if (!ts) return false
  let d: Date
  if (typeof ts.toDate === 'function') {
    d = ts.toDate()
  } else if (ts instanceof Date) {
    d = ts
  } else {
    d = new Date(ts)
  }
  if (isNaN(d.getTime())) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate()
}

function computeStats(events: AccessEvent[]) {
  const safeEvents = Array.isArray(events) ? events : []
  const today = safeEvents.filter(e => e && isToday(e.occurredAt))
  const todayEntries  = today.filter(e => e?.result === 'granted').length
  const failedAttempts = today.filter(e => e?.result === 'denied' || e?.result === 'liveness_failed' || e?.result === 'pin_failed').length
  const withConf = safeEvents.filter(e => e && e.confidence != null).slice(0, 30)
  const averageConfidence = withConf.length
    ? withConf.reduce((s, e) => s + (Number(e.confidence) || 0), 0) / withConf.length
    : null
  return { todayEntries, failedAttempts, averageConfidence }
}

function deriveSystemStatus(state: NodeState | null, nodeLabel: string): SystemStatus {
  if (!state || !state.onlineState) return { overall: 'offline', cameraState: 'unknown', syncState: 'offline', lastSyncAt: '-', nodeLabel }
  const syncState = state.onlineState === 'online' ? 'live'
    : state.onlineState === 'grace_period' ? 'delayed'
    : 'offline'
  return {
    overall:     state.onlineState,
    cameraState: state.modelStatus === 'running' ? 'connected' : 'disconnected',
    syncState,
    lastSyncAt:  fmtTs(state.updatedAt),
    nodeLabel,
  }
}

// ── Store ────────────────────────────────────────────────────────────────────

interface AdminStore {
  systemStatus: SystemStatus
  events: AccessEvent[]
  users: User[]
  equipment: Equipment[]
  fetchEquipment: (labId: string) => Promise<void>
  addEquipment: (labId: string, data: Partial<Equipment>) => Promise<void>
  updateEquipment: (labId: string, id: string, data: Partial<Equipment>) => Promise<void>
  deleteEquipment: (labId: string, id: string) => Promise<void>
  nodeState: NodeState | null
  nodeConfig: NodeConfig | null
  incidents: Incident[]
  todayEntries: number
  failedAttempts: number
  averageConfidence: number | null
  loading: boolean

  subscribe: (labId: string, labName: string) => () => void
  refreshUsers: (labId: string) => Promise<void>
  refreshNodeConfig: (labId: string, clusterId: string, nodeId: string) => Promise<void>
  deleteUser: (labId: string, userId: string) => Promise<void>
  updateUserProfile: (labId: string, userId: string, data: { fullName: string; universityId: string; email: string; role: string }) => Promise<void>
  resetUserPin: (labId: string, userId: string, pin: string) => Promise<void>
  updateUserStatus: (labId: string, userId: string, status: 'active' | 'suspended') => Promise<void>
}

const defaultStatus: SystemStatus = {
  overall: 'offline', cameraState: 'disconnected',
  syncState: 'offline', lastSyncAt: '-', nodeLabel: '-',
}

// Monotonically-increasing counter - guards stale async results after lab switch
let _subscribeVersion = 0

export const useAdminStore = create<AdminStore>((set, get) => ({
  systemStatus: defaultStatus,
  events: [],
  users: [],
  equipment: [],
  fetchEquipment: async (labId: string) => {
    try {
      const res = await fetch(`/api/labs/${encodeURIComponent(labId)}/equipment`)
      if (res.ok) {
        const data = await res.json()
        set({ equipment: data })
      }
    } catch (err) {
      console.error('Failed to fetch equipment:', err)
    }
  },
  addEquipment: async (labId: string, data: Partial<Equipment>) => {
    const res = await fetch(`/api/labs/${encodeURIComponent(labId)}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!res.ok) {
      const errData = await res.json()
      throw new Error(errData.error || 'Failed to add equipment')
    }
    await get().fetchEquipment(labId)
  },
  updateEquipment: async (labId: string, id: string, data: Partial<Equipment>) => {
    const res = await fetch(`/api/labs/${encodeURIComponent(labId)}/equipment/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!res.ok) {
      const errData = await res.json()
      throw new Error(errData.error || 'Failed to update equipment')
    }
    await get().fetchEquipment(labId)
  },
  deleteEquipment: async (labId: string, id: string) => {
    const res = await fetch(`/api/labs/${encodeURIComponent(labId)}/equipment/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
    if (!res.ok) {
      const errData = await res.json()
      throw new Error(errData.error || 'Failed to delete equipment')
    }
    await get().fetchEquipment(labId)
  },
  nodeState: null,
  nodeConfig: null,
  incidents: [],
  todayEntries: 0,
  failedAttempts: 0,
  averageConfidence: null,
  loading: false,

  subscribe: (labId, labName) => {
    set({ loading: true })
    const v = ++_subscribeVersion

    const unsubEvents    = subscribeAccessEvents(labId, 60, events => {
      const safeEvs = Array.isArray(events) ? events : []; set({ events: safeEvs, ...computeStats(safeEvs), loading: false })
    })
    const unsubIncidents = subscribeIncidents(labId, incidents => set({ incidents: Array.isArray(incidents) ? incidents : [] }))

    let unsubNode: (() => void) | undefined

    const setupNode = (clusterId: string, nodeId: string) => {
      const nodeLabel = `${labName} / Node ${(nodeId || "").slice(0, 4).toUpperCase()}`
      unsubNode = subscribeNodeState(labId, clusterId, nodeId, state => {
        set({ nodeState: state, systemStatus: deriveSystemStatus(state, nodeLabel) })
      })
      void getNodeConfig(labId, clusterId, nodeId).then(cfg => {
        if (_subscribeVersion === v) set({ nodeConfig: cfg })
      })
    }

    const { selectedClusterId, selectedNodeId, cacheNode } = useLabStore.getState()

    const nodeTask = selectedClusterId && selectedNodeId
      ? Promise.resolve(setupNode(selectedClusterId, selectedNodeId))
      : getFirstLabNode(labId).then(node => {
          if (!node || _subscribeVersion !== v) return
          cacheNode(node.clusterId, node.id)
          setupNode(node.clusterId, node.id)
        })

    void Promise.all([
      getLabUsers(labId).then(users => {
        if (_subscribeVersion === v) set({ users: Array.isArray(users) ? users : [] })
      }),
      nodeTask,
    ])

    return () => {
      unsubEvents()
      unsubIncidents()
      unsubNode?.()
    }
  },

  refreshUsers: async (labId) => {
    const users = await getLabUsers(labId)
    set({ users: Array.isArray(users) ? users : [] })
  },

  refreshNodeConfig: async (labId, clusterId, nodeId) => {
    const cfg = await getNodeConfig(labId, clusterId, nodeId)
    set({ nodeConfig: cfg })
  },

  deleteUser: async (labId, userId) => {
    await deleteUser(labId, userId)
    const users = await getLabUsers(labId)
    set({ users: Array.isArray(users) ? users : [] })
  },

  updateUserProfile: async (labId, userId, data) => {
    await updateUser(labId, userId, data)
    const users = await getLabUsers(labId)
    set({ users: Array.isArray(users) ? users : [] })
  },

  resetUserPin: async (labId, userId, pin) => {
    await resetUserPin(labId, userId, pin)
    const users = await getLabUsers(labId)
    set({ users: Array.isArray(users) ? users : [] })
  },

  updateUserStatus: async (labId, userId, status) => {
    await updateUserStatus(labId, userId, status)
    const users = await getLabUsers(labId)
    set({ users: Array.isArray(users) ? users : [] })
  },
}))

