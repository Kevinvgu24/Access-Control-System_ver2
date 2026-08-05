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

function computeStats(events: AccessEvent[], incidents: Incident[] = [], users: User[] = []) {
  const safeEvents = Array.isArray(events) ? events : []
  const safeIncidents = Array.isArray(incidents) ? incidents : []
  const safeUsers = Array.isArray(users) ? users : []

  const todayEvents = safeEvents.filter(e => e && isToday(e.occurredAt))
  const todayEntries  = todayEvents.filter(e => e?.result === 'granted').length
  const failedAttempts = todayEvents.filter(e => e?.result === 'denied' || e?.result === 'liveness_failed' || e?.result === 'pin_failed').length

  const todayIncidents = safeIncidents.filter(i => i && isToday(i.createdAt)).length
  const todayUsers = safeUsers.filter(u => u && isToday(u.createdAt)).length
  const todayNotifications = todayEvents.length + todayIncidents + todayUsers

  const withConf = safeEvents.filter(e => e && e.confidence != null).slice(0, 30)
  const averageConfidence = withConf.length
    ? withConf.reduce((s, e) => s + (Number(e.confidence) || 0), 0) / withConf.length
    : null
  return { todayEntries, failedAttempts, todayNotifications, averageConfidence }
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
  borrowEquipment: (labId: string, id: string, data: { borrowerName: string; borrowerId: string; borrowDate: string; returnDate: string; borrowNotes?: string }, eqName: string, serialNumber: string) => Promise<void>
  returnEquipment: (labId: string, id: string, eqName: string, serialNumber: string) => Promise<void>
  nodeState: NodeState | null
  nodeConfig: NodeConfig | null
  incidents: Incident[]
  todayEntries: number
  failedAttempts: number
  todayNotifications: number
  averageConfidence: number | null
  loading: boolean

  readNotificationIds: Set<string>
  lastMarkAllReadTime: number
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: (ids?: string[]) => void

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

const NOTIF_READ_STORAGE_KEY = 'admin_read_notification_ids'
const NOTIF_MARK_ALL_TIME_KEY = 'admin_last_mark_all_read_time'

function getInitialReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIF_READ_STORAGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return new Set(arr)
    }
  } catch { /* ignore */ }
  return new Set()
}

function getInitialMarkAllTime(): number {
  try {
    const raw = localStorage.getItem(NOTIF_MARK_ALL_TIME_KEY)
    if (raw) {
      const val = Number(raw)
      if (!isNaN(val)) return val
    }
  } catch { /* ignore */ }
  return 0
}

function persistReadIds(set: Set<string>) {
  try {
    const arr = Array.from(set).slice(-300)
    localStorage.setItem(NOTIF_READ_STORAGE_KEY, JSON.stringify(arr))
  } catch { /* ignore */ }
}

function persistMarkAllTime(ts: number) {
  try {
    localStorage.setItem(NOTIF_MARK_ALL_TIME_KEY, String(ts))
  } catch { /* ignore */ }
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
  borrowEquipment: async (labId: string, id: string, data: { borrowerName: string; borrowerId: string; borrowDate: string; returnDate: string; borrowNotes?: string }, eqName: string, serialNumber: string) => {
    const res = await fetch(`/api/labs/${encodeURIComponent(labId)}/equipment/${encodeURIComponent(id)}/borrow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!res.ok) {
      const errData = await res.json()
      throw new Error(errData.error || 'Failed to borrow equipment')
    }
    await get().fetchEquipment(labId)

    // Add notification incident to dashboard store state
    const newIncident: Incident = {
      id: `borrow_${Date.now()}`,
      summary: `[Equipment Checked Out] "${eqName}" (${serialNumber}) borrowed by ${data.borrowerName} (ID: ${data.borrowerId}) from ${data.borrowDate} to ${data.returnDate}`,
      severity: 'medium',
      status: 'open',
      createdAt: new Date().toISOString()
    }
    set(state => {
      const incidents = [newIncident, ...(state.incidents || [])]
      return { incidents, ...computeStats(state.events, incidents, state.users) }
    })
  },
  returnEquipment: async (labId: string, id: string, eqName: string, serialNumber: string) => {
    const res = await fetch(`/api/labs/${encodeURIComponent(labId)}/equipment/${encodeURIComponent(id)}/return`, {
      method: 'POST'
    })
    if (!res.ok) {
      const errData = await res.json()
      throw new Error(errData.error || 'Failed to return equipment')
    }
    await get().fetchEquipment(labId)

    // Add return notification to dashboard
    const newIncident: Incident = {
      id: `return_${Date.now()}`,
      summary: `[Equipment Returned] "${eqName}" (${serialNumber}) was returned to lab storage`,
      severity: 'low',
      status: 'resolved',
      createdAt: new Date().toISOString()
    }
    set(state => {
      const incidents = [newIncident, ...(state.incidents || [])]
      return { incidents, ...computeStats(state.events, incidents, state.users) }
    })
  },
  nodeState: null,
  nodeConfig: null,
  incidents: [],
  todayEntries: 0,
  failedAttempts: 0,
  todayNotifications: 0,
  averageConfidence: null,
  loading: false,

  readNotificationIds: getInitialReadIds(),
  lastMarkAllReadTime: getInitialMarkAllTime(),

  markNotificationRead: (id: string) => {
    set(state => {
      const next = new Set(state.readNotificationIds)
      next.add(id)
      persistReadIds(next)
      return { readNotificationIds: next }
    })
  },

  markAllNotificationsRead: (ids: string[] = []) => {
    const now = Date.now()
    set(state => {
      const next = new Set([...state.readNotificationIds, ...ids])
      persistReadIds(next)
      persistMarkAllTime(now)
      return { readNotificationIds: next, lastMarkAllReadTime: now }
    })
  },

  subscribe: (labId, labName) => {
    try {
      set({ loading: true })
      const v = ++_subscribeVersion

    const unsubEvents    = subscribeAccessEvents(labId, 60, events => {
      const safeEvs = Array.isArray(events) ? events : []
      const { incidents, users } = get()
      set({ events: safeEvs, ...computeStats(safeEvs, incidents, users), loading: false })
    })
    const unsubIncidents = subscribeIncidents(labId, incidents => {
      const safeIncs = Array.isArray(incidents) ? incidents : []
      const { events, users } = get()
      set({ incidents: safeIncs, ...computeStats(events, safeIncs, users) })
    })

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
        if (_subscribeVersion === v) {
          const safeUsers = Array.isArray(users) ? users : []
          const { events, incidents } = get()
          set({ users: safeUsers, ...computeStats(events, incidents, safeUsers) })
        }
      }),
      nodeTask,
    ])

    // Periodic check (every 30s) to automatically reset daily stats/notifications on midnight day rollover
    const dayCheckTimer = setInterval(() => {
      if (_subscribeVersion === v) {
        const { events, incidents, users } = get()
        set(computeStats(events, incidents, users))
      }
    }, 30_000)

    return () => {
      try {
        clearInterval(dayCheckTimer)
        unsubEvents?.()
        unsubIncidents?.()
        unsubNode?.()
      } catch (e) {
        console.error('Error during cleanup:', e)
      }
    }
    } catch (err) {
      console.error('Error in subscribe:', err)
      return () => {}
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

