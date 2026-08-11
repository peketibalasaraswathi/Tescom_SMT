import { create } from 'zustand';
import type { SmtComponent, SmtLine, ReplenishmentEvent, StatusFilterType } from '../types';

interface SmtState {
  activeLineId: string;
  lines: Record<string, SmtLine>;
  components: Record<string, SmtComponent>;
  
  // Search & Filter
  searchQuery: string;
  statusFilter: StatusFilterType;
  
  // Replenishment Log
  replenishmentEvents: ReplenishmentEvent[];
  
  // Settings & Modals
  soundAlertEnabled: boolean;
  isReplenishmentModalOpen: boolean;
  isCsvInspectorOpen: boolean;

  // Actions
  setActiveLine: (lineId: string) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: StatusFilterType) => void;
  toggleSoundAlert: () => void;
  setIsReplenishmentModalOpen: (open: boolean) => void;
  setIsCsvInspectorOpen: (open: boolean) => void;

  updateInventoryBatch: (newComponents: SmtComponent[]) => void;
  updateLineStatus: (lineId: string, status: SmtLine['connection_status']) => void;
  updateLinesData: (linesArray: SmtLine[]) => void;
  
  addReplenishmentEvent: (event: ReplenishmentEvent) => void;
  setReplenishmentHistory: (events: ReplenishmentEvent[]) => void;
}

export const useSmtStore = create<SmtState>((set) => ({
  activeLineId: 'line_1',
  lines: {
    'line_1': { id: 'line_1', name: 'SMT Line 1', connection_status: 'offline', last_updated: Date.now() },
    'line_2': { id: 'line_2', name: 'SMT Line 2', connection_status: 'offline', last_updated: Date.now() },
    'line_3': { id: 'line_3', name: 'SMT Line 3', connection_status: 'offline', last_updated: Date.now() },
    'line_4': { id: 'line_4', name: 'SMT Line 4', connection_status: 'offline', last_updated: Date.now() }
  },
  components: {},
  
  searchQuery: '',
  statusFilter: 'all',
  replenishmentEvents: [],
  soundAlertEnabled: true,
  isReplenishmentModalOpen: false,
  isCsvInspectorOpen: false,

  setActiveLine: (lineId) => set({ activeLineId: lineId }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  toggleSoundAlert: () => set((state) => ({ soundAlertEnabled: !state.soundAlertEnabled })),
  setIsReplenishmentModalOpen: (open) => set({ isReplenishmentModalOpen: open }),
  setIsCsvInspectorOpen: (open) => set({ isCsvInspectorOpen: open }),

  updateLinesData: (incomingLines) => set((state) => {
    const updatedLines = { ...state.lines };
    incomingLines.forEach(line => {
      updatedLines[line.id] = { ...updatedLines[line.id], ...line, last_updated: Date.now() };
    });
    return { lines: updatedLines };
  }),

  updateInventoryBatch: (newComponents) => set((state) => {
    const updatedComponents = { ...state.components };
    newComponents.forEach((comp) => {
      const uniqueKey = `${comp.line_id}-${comp.feeder_position}`;
      updatedComponents[uniqueKey] = comp;
    });
    return { components: updatedComponents };
  }),

  updateLineStatus: (lineId, status) => set((state) => ({
    lines: { ...state.lines, [lineId]: { ...state.lines[lineId], connection_status: status } }
  })),

  addReplenishmentEvent: (event) => set((state) => ({
    replenishmentEvents: [event, ...state.replenishmentEvents.filter(e => e.id !== event.id)].slice(0, 100)
  })),

  setReplenishmentHistory: (events) => set({ replenishmentEvents: events })
}));