import { useSmtStore } from '../../store/useSmtStore';
import type { StatusFilterType } from '../../types';
import { Search, Volume2, VolumeX, History, FileSpreadsheet, X } from 'lucide-react';
import clsx from 'clsx';

export function FilterBar() {
  const searchQuery = useSmtStore((state) => state.searchQuery);
  const setSearchQuery = useSmtStore((state) => state.setSearchQuery);
  const statusFilter = useSmtStore((state) => state.statusFilter);
  const setStatusFilter = useSmtStore((state) => state.setStatusFilter);
  const soundAlertEnabled = useSmtStore((state) => state.soundAlertEnabled);
  const toggleSoundAlert = useSmtStore((state) => state.toggleSoundAlert);
  const setIsReplenishmentModalOpen = useSmtStore((state) => state.setIsReplenishmentModalOpen);
  const setIsCsvInspectorOpen = useSmtStore((state) => state.setIsCsvInspectorOpen);

  const filters: { label: string; value: StatusFilterType; countColor?: string }[] = [
    { label: 'All Statuses', value: 'all' },
    { label: 'Critical (<30s)', value: 'critical' },
    { label: 'Warning (<90s)', value: 'warning' },
    { label: 'OK Status', value: 'ok' },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
      {/* 1. Search Bar */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by part number, feeder slot, or description..."
          className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg pl-10 pr-9 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all placeholder:text-gray-400"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 2. Status Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mr-1 hidden lg:inline">Filter:</span>
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
              statusFilter === f.value
                ? f.value === 'critical'
                  ? "bg-red-600 text-white border-red-600 shadow-sm"
                  : f.value === 'warning'
                  ? "bg-yellow-500 text-white border-yellow-500 shadow-sm"
                  : f.value === 'ok'
                  ? "bg-green-600 text-white border-green-600 shadow-sm"
                  : "bg-gray-900 text-white border-gray-900 shadow-sm"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 3. Quick Action Toolbar */}
      <div className="flex items-center gap-2 border-t md:border-t-0 border-gray-100 pt-3 md:pt-0">
        {/* Sound Toggle */}
        <button
          onClick={toggleSoundAlert}
          title={soundAlertEnabled ? "Mute audio alert chime" : "Enable audio alert chime"}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
            soundAlertEnabled
              ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
              : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200"
          )}
        >
          {soundAlertEnabled ? <Volume2 className="w-4 h-4 text-blue-600" /> : <VolumeX className="w-4 h-4 text-gray-400" />}
          <span className="hidden sm:inline">{soundAlertEnabled ? "Audio On" : "Audio Muted"}</span>
        </button>

        {/* Replenishment Log Modal Button */}
        <button
          onClick={() => setIsReplenishmentModalOpen(true)}
          title="Open Reel Replenishment Activity Log"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-lg text-xs font-bold border border-gray-200 transition-colors"
        >
          <History className="w-4 h-4 text-gray-500" />
          <span className="hidden sm:inline">Reload Log</span>
        </button>

        {/* CSV Inspector Tool */}
        <button
          onClick={() => setIsCsvInspectorOpen(true)}
          title="Test real machine CSV file parsing"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs font-bold border border-purple-200 transition-colors"
        >
          <FileSpreadsheet className="w-4 h-4 text-purple-600" />
          <span className="hidden sm:inline">CSV Inspector</span>
        </button>
      </div>
    </div>
  );
}
