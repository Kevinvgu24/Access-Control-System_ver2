import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface LabState {
  selectedLabId: string | null
  selectedLabName: string | null
  selectedClusterId: string | null
  selectedNodeId: string | null
  sidebarCollapsed: boolean
  mobileMenuOpen: boolean
  warning: string | null
  selectLab: (id: string, name: string) => void
  selectNode: (clusterId: string, nodeId: string) => void
  clearLab: () => void
  cacheNode: (clusterId: string, nodeId: string) => void
  setWarning: (msg: string | null) => void
  toggleSidebar: () => void
  toggleMobileMenu: () => void
  closeMobileMenu: () => void
}

export const useLabStore = create<LabState>()(
  persist(
    (set) => ({
      selectedLabId: null,
      selectedLabName: null,
      selectedClusterId: null,
      selectedNodeId: null,
      sidebarCollapsed: false,
      mobileMenuOpen: false,
      warning: null,

      selectLab: (id, name) =>
        set({ selectedLabId: id, selectedLabName: name, selectedClusterId: null, selectedNodeId: null, warning: null }),

      selectNode: (clusterId, nodeId) =>
        set({ selectedClusterId: clusterId, selectedNodeId: nodeId }),

      cacheNode: (clusterId, nodeId) =>
        set({ selectedClusterId: clusterId, selectedNodeId: nodeId }),

      clearLab: () =>
        set({ selectedLabId: null, selectedLabName: null, selectedClusterId: null, selectedNodeId: null, warning: null }),

      setWarning: (msg) =>
        set({ warning: msg }),

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      toggleMobileMenu: () =>
        set((state) => ({ mobileMenuOpen: !state.mobileMenuOpen })),

      closeMobileMenu: () =>
        set({ mobileMenuOpen: false }),
    }),
    { 
      name: 'lab-selection',
      partialize: (state) => ({
        selectedLabId: state.selectedLabId,
        selectedLabName: state.selectedLabName,
        selectedClusterId: state.selectedClusterId,
        selectedNodeId: state.selectedNodeId,
        sidebarCollapsed: state.sidebarCollapsed,
      })
    }
  )
)
