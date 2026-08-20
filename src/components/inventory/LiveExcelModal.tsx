/**
 * LiveExcelModal.tsx — Real-Time Interactive Live Excel Spreadsheet Interface
 *
 * Features:
 *  - Full Excel-like spreadsheet look and feel (grid, row numbers, column letters, formula bar)
 *  - Category sheet tabs at the bottom (Master multi-sheet + individual categories)
 *  - Real-time live ingestion updates via Socket.io
 *  - In-sheet Download options: "Download Excel (.xlsx)" and "Download CSV"
 *  - Instant cell search & filtering, live calculation formulas (SUM, COUNT, HEALTH)
 */

import { useState, useEffect, useMemo } from 'react';
import { useSmtStore } from '../../store/useSmtStore';
import { useInventoryApi } from '../../hooks/useInventoryApi';
import { io } from 'socket.io-client';
import {
  FileSpreadsheet,
  Download,
  Search,
  RefreshCw,
  X,
  Radio,
  FileText,
  Copy,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Table,
  Sigma
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import type { ReelRecord } from '../../types';

const INVENTORY_SOCKET_URL = import.meta.env.VITE_INVENTORY_API_URL || 'http://localhost:3002';

interface LiveRow extends ReelRecord {
  category: string;
  isNew?: boolean;
}

export function LiveExcelModal() {
  const isOpen = useSmtStore((s) => s.isLiveExcelOpen);
  const activeCategory = useSmtStore((s) => s.liveExcelCategory);
  const closeLiveExcel = useSmtStore((s) => s.closeLiveExcel);
  const setLiveExcelCategory = useSmtStore((s) => s.setLiveExcelCategory);
  const masterConfig = useSmtStore((s) => s.masterConfig);

  const { fetchAllHistory, downloadCategoryExcel, downloadAllExcel } = useInventoryApi();

  const [historyData, setHistoryData] = useState<Record<string, ReelRecord[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCell, setSelectedCell] = useState<string>('A1');
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [newReelIds, setNewReelIds] = useState<Set<string>>(new Set());

  // ── Load full history when modal opens ────────────────────────
  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await fetchAllHistory();
      setHistoryData(data);
    } catch (err) {
      console.error('Failed to load history for live excel:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  // ── Socket listener for real-time live row additions ───────────
  useEffect(() => {
    if (!isOpen) return;
    const socket = io(INVENTORY_SOCKET_URL);

    socket.on('excel_reel_scanned', (payload: { componentType: string; reel: ReelRecord }) => {
      const { componentType, reel } = payload;
      setHistoryData((prev) => {
        const catReels = prev[componentType] ? [...prev[componentType]] : [];
        const existingIdx = catReels.findIndex(
          (r) => r.reelId === reel.reelId || (r.partNumber === reel.partNumber && r.partsId === reel.partsId && r.lotId === reel.lotId)
        );

        if (existingIdx >= 0) {
          catReels[existingIdx] = reel;
        } else {
          catReels.push(reel);
        }

        return { ...prev, [componentType]: catReels };
      });

      // Highlight the new reel
      setNewReelIds((prev) => new Set(prev).add(reel.reelId));
      setTimeout(() => {
        setNewReelIds((prev) => {
          const next = new Set(prev);
          next.delete(reel.reelId);
          return next;
        });
      }, 4000);

      toast.success(`📊 Live Excel: New scan added to ${componentType} (${reel.reelId})`, {
        duration: 3000,
        icon: '🟢'
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [isOpen]);

  // ── Compute table rows based on active category & search query ──
  const allRows: LiveRow[] = useMemo(() => {
    const rows: LiveRow[] = [];
    const types = masterConfig?.componentTypes || {};

    Object.keys(types).forEach((type) => {
      const reels = historyData[type] || [];
      reels.forEach((r) => {
        rows.push({
          ...r,
          category: type
        });
      });
    });

    // If activeCategory !== 'ALL', filter to that category
    const filteredByCategory = activeCategory === 'ALL'
      ? rows
      : rows.filter((r) => r.category === activeCategory);

    // Apply search filter
    if (!searchQuery.trim()) return filteredByCategory;
    const q = searchQuery.toLowerCase();
    return filteredByCategory.filter((r) =>
      r.reelId.toLowerCase().includes(q) ||
      r.partNumber.toLowerCase().includes(q) ||
      r.partsId.toLowerCase().includes(q) ||
      r.lotId.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q)
    );
  }, [historyData, masterConfig, activeCategory, searchQuery]);

  // ── Calculate live spreadsheet formulas (SUM, COUNT, etc.) ─────
  const stats = useMemo(() => {
    let totalInitial = 0;
    let totalRemaining = 0;
    let okCount = 0;
    let warnCount = 0;
    let critCount = 0;

    allRows.forEach((r) => {
      totalInitial += Number(r.initialQuantity || 0);
      totalRemaining += Number(r.remainingQuantity || 0);
      const st = (r.status || r.computedStatus || 'OK').toUpperCase();
      if (st === 'CRITICAL') critCount++;
      else if (st === 'WARNING') warnCount++;
      else okCount++;
    });

    const avgDepletion = totalInitial > 0
      ? Math.round(((totalInitial - totalRemaining) / totalInitial) * 100)
      : 0;

    return {
      rowCount: allRows.length,
      totalInitial,
      totalRemaining,
      avgDepletion,
      okCount,
      warnCount,
      critCount
    };
  }, [allRows]);

  // ── Download Handlers ─────────────────────────────────────────
  const handleDownloadExcel = () => {
    if (activeCategory === 'ALL') {
      downloadAllExcel();
    } else {
      downloadCategoryExcel(activeCategory);
    }
  };

  const handleDownloadCsv = () => {
    if (allRows.length === 0) {
      toast.error('No rows to export');
      return;
    }

    const headers = ['Row', 'Reel ID', 'Part Number', 'Category', 'Parts ID', 'Lot ID', 'Initial Qty', 'Remaining Qty', 'Level', 'Scanned At', 'Last Updated'];
    const csvContent = [
      headers.join(','),
      ...allRows.map((r, i) => [
        i + 1,
        `"${r.reelId}"`,
        `"${r.partNumber}"`,
        `"${r.category}"`,
        `"${r.partsId}"`,
        `"${r.lotId}"`,
        r.initialQuantity,
        r.remainingQuantity,
        `"${r.status || 'OK'}"`,
        `"${r.scannedAt}"`,
        `"${r.lastUpdated}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeCategory === 'ALL' ? 'SMT_Live_Master_Inventory.csv' : `${activeCategory}_Live_Inventory.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Downloaded CSV successfully', { icon: '📄' });
  };

  const handleCopyCell = (text: string, cellCoord: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCell(cellCoord);
    setSelectedCell(cellCoord);
    setTimeout(() => setCopiedCell(null), 1500);
  };

  if (!isOpen) return null;

  const activeMeta = masterConfig?.componentTypes[activeCategory];
  const workbookName = activeCategory === 'ALL' ? 'SMT_Inventory_Master.xlsx' : `${activeCategory}_Live_Inventory.xlsx`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl h-[92vh] flex flex-col border border-gray-300 overflow-hidden font-sans">
        
        {/* ── 1. EXCEL TITLE BAR (Classic Excel Ribbon Green) ──────── */}
        <div className="bg-[#107C41] text-white px-4 py-2.5 flex items-center justify-between shadow-md select-none shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-1.5 rounded-lg flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm tracking-wide font-mono">{workbookName}</span>
                <span className="text-[10px] uppercase font-bold bg-white/20 px-2 py-0.5 rounded text-white/90">
                  Live Spreadsheet
                </span>
                <span className="flex items-center gap-1 text-[11px] font-semibold bg-emerald-900/60 text-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-400/40">
                  <Radio className="w-3 h-3 text-emerald-300 animate-pulse" /> Live Real-Time Stream
                </span>
              </div>
              <p className="text-[11px] text-emerald-100/80">
                Interactive real-time Excel viewer · Instant updates upon QR scanner ingestion
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={closeLiveExcel}
              className="text-white/80 hover:text-white hover:bg-white/20 p-1.5 rounded-lg transition-colors"
              title="Close Excel Viewer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── 2. EXCEL RIBBON TOOLBAR & ACTIONS ─────────────────────── */}
        <div className="bg-[#F3F4F6] border-b border-gray-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 select-none">
          {/* Left search */}
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search cell values (Reel ID, Part Number, Lot ID)..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#107C41] focus:border-transparent font-mono shadow-2xs"
              />
            </div>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-xs text-gray-500 hover:text-gray-800 underline shrink-0"
              >
                Clear
              </button>
            )}
          </div>

          {/* Right Action buttons: DOWNLOAD EXCEL / CSV / REFRESH */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={isLoading}
              title="Refresh spreadsheet data from backend"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-md transition-all active:scale-95 shadow-2xs"
            >
              <RefreshCw className={clsx('w-3.5 h-3.5', isLoading && 'animate-spin text-emerald-600')} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadCsv}
              title="Export current view as .csv"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-md transition-all active:scale-95 shadow-2xs"
            >
              <FileText className="w-3.5 h-3.5 text-gray-600" />
              <span>Download CSV</span>
            </button>

            {/* PRIMARY IN-SHEET EXCEL DOWNLOAD BUTTON */}
            <button
              type="button"
              onClick={handleDownloadExcel}
              title={`Download official formatted Excel file (${activeCategory === 'ALL' ? 'All Categories' : activeCategory}.xlsx)`}
              className="flex items-center gap-2 px-4 py-1.5 text-xs font-bold text-white bg-[#107C41] hover:bg-[#0E6C38] rounded-md shadow-sm transition-all active:scale-95"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Download Excel (.xlsx)</span>
              <Download className="w-3.5 h-3.5 ml-0.5" />
            </button>
          </div>
        </div>

        {/* ── 3. EXCEL FORMULA & STATISTICS BAR ────────────────────── */}
        <div className="bg-[#FAFAFA] border-b border-gray-200 px-4 py-1.5 flex items-center gap-4 text-xs font-mono text-gray-700 shrink-0 select-none overflow-x-auto">
          <div className="flex items-center gap-1.5 bg-white border border-gray-300 px-2.5 py-0.5 rounded text-gray-800 font-bold shrink-0 shadow-2xs">
            <span className="text-gray-400">Cell:</span>
            <span className="text-[#107C41]">{selectedCell}</span>
          </div>

          <div className="flex items-center gap-1 text-gray-400 font-sans italic shrink-0">
            <Sigma className="w-3.5 h-3.5 text-[#107C41]" />
            <span className="font-bold text-gray-700 not-italic font-mono">fx = </span>
          </div>

          {/* Dynamic live calculation stats */}
          <div className="flex items-center gap-4 text-xs font-sans">
            <span className="bg-white border border-gray-200 px-2 py-0.5 rounded shadow-2xs">
              <strong className="text-gray-500 font-normal">ROWS:</strong> <b className="text-gray-900 font-mono">{stats.rowCount}</b>
            </span>
            <span className="bg-white border border-gray-200 px-2 py-0.5 rounded shadow-2xs">
              <strong className="text-gray-500 font-normal">SUM(Initial):</strong> <b className="text-blue-700 font-mono">{stats.totalInitial.toLocaleString()}</b>
            </span>
            <span className="bg-white border border-gray-200 px-2 py-0.5 rounded shadow-2xs">
              <strong className="text-gray-500 font-normal">SUM(Remaining):</strong> <b className="text-emerald-700 font-mono">{stats.totalRemaining.toLocaleString()}</b>
            </span>
            <span className="bg-white border border-gray-200 px-2 py-0.5 rounded shadow-2xs hidden md:inline-block">
              <strong className="text-gray-500 font-normal">STATUS:</strong>{' '}
              <span className="text-emerald-600 font-bold">{stats.okCount} OK</span> ·{' '}
              <span className="text-yellow-600 font-bold">{stats.warnCount} Warn</span> ·{' '}
              <span className="text-red-600 font-bold">{stats.critCount} Crit</span>
            </span>
          </div>
        </div>

        {/* ── 4. SPREADSHEET GRID (Excel Table) ────────────────────── */}
        <div className="flex-1 overflow-auto bg-[#F9FAFB]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <RefreshCw className="w-8 h-8 animate-spin text-[#107C41] mb-2" />
              <p className="font-medium text-sm">Loading Live Excel Records...</p>
            </div>
          ) : allRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Table className="w-10 h-10 mb-2 text-gray-300" />
              <p className="font-bold text-gray-600">No records found for this sheet</p>
              <p className="text-xs mt-1">Scan a reel with the QR scanner to see live rows appear here.</p>
            </div>
          ) : (
            <table className="w-full border-collapse text-xs font-mono">
              <thead>
                {/* Excel Column Letters (A, B, C, D...) */}
                <tr className="bg-[#E5E7EB] text-gray-500 text-[10px] font-bold border-b border-gray-300 sticky top-0 z-10 select-none">
                  <th className="w-12 py-1 px-2 text-center border-r border-gray-300 bg-[#D1D5DB] text-gray-700">#</th>
                  <th className="py-1 px-3 text-left border-r border-gray-300">A · Reel ID</th>
                  <th className="py-1 px-3 text-left border-r border-gray-300">B · Part Number</th>
                  <th className="py-1 px-3 text-left border-r border-gray-300">C · Category</th>
                  <th className="py-1 px-3 text-left border-r border-gray-300">D · Parts ID</th>
                  <th className="py-1 px-3 text-left border-r border-gray-300">E · Lot ID</th>
                  <th className="py-1 px-3 text-right border-r border-gray-300">F · Initial Qty</th>
                  <th className="py-1 px-3 text-right border-r border-gray-300">G · Remaining Qty</th>
                  <th className="py-1 px-3 text-center border-r border-gray-300">H · Level</th>
                  <th className="py-1 px-3 text-left border-r border-gray-300">I · Scanned At</th>
                  <th className="py-1 px-3 text-left">J · Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {allRows.map((row, idx) => {
                  const rowNum = idx + 1;
                  const isNewScan = newReelIds.has(row.reelId);
                  const st = (row.status || row.computedStatus || 'OK').toUpperCase();
                  const isEven = idx % 2 === 0;

                  return (
                    <tr
                      key={`${row.reelId}-${idx}`}
                      className={clsx(
                        'transition-colors duration-300 hover:bg-emerald-50/70',
                        isNewScan && 'bg-emerald-100 animate-pulse font-bold',
                        !isNewScan && isEven && 'bg-[#FAFAFA]',
                        !isNewScan && !isEven && 'bg-white'
                      )}
                    >
                      {/* Row Header Number (1, 2, 3...) */}
                      <td
                        onClick={() => setSelectedCell(`Row ${rowNum}`)}
                        className="py-2 px-2 text-center border-r border-gray-300 bg-[#F3F4F6] text-gray-500 font-bold select-none cursor-pointer hover:bg-gray-300"
                      >
                        {rowNum}
                      </td>

                      {/* A: Reel ID */}
                      <td
                        onClick={() => handleCopyCell(row.reelId, `A${rowNum}`)}
                        className={clsx(
                          'py-2 px-3 border-r border-gray-200 font-bold text-blue-700 cursor-pointer hover:bg-blue-50',
                          selectedCell === `A${rowNum}` && 'ring-2 ring-[#107C41] ring-inset'
                        )}
                        title="Click to copy Reel ID"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span>{row.reelId}</span>
                          {copiedCell === `A${rowNum}` ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-2.5 h-2.5 text-gray-300 opacity-0 group-hover:opacity-100" />
                          )}
                        </div>
                      </td>

                      {/* B: Part Number */}
                      <td
                        onClick={() => handleCopyCell(row.partNumber, `B${rowNum}`)}
                        className={clsx(
                          'py-2 px-3 border-r border-gray-200 text-gray-900 font-medium cursor-pointer hover:bg-gray-100',
                          selectedCell === `B${rowNum}` && 'ring-2 ring-[#107C41] ring-inset'
                        )}
                      >
                        {row.partNumber}
                      </td>

                      {/* C: Category */}
                      <td
                        onClick={() => setSelectedCell(`C${rowNum}`)}
                        className={clsx(
                          'py-2 px-3 border-r border-gray-200 text-gray-700 cursor-pointer',
                          selectedCell === `C${rowNum}` && 'ring-2 ring-[#107C41] ring-inset'
                        )}
                      >
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-sans text-[11px] font-semibold">
                          {row.category}
                        </span>
                      </td>

                      {/* D: Parts ID */}
                      <td
                        onClick={() => setSelectedCell(`D${rowNum}`)}
                        className={clsx(
                          'py-2 px-3 border-r border-gray-200 text-gray-600 cursor-pointer',
                          selectedCell === `D${rowNum}` && 'ring-2 ring-[#107C41] ring-inset'
                        )}
                      >
                        {row.partsId}
                      </td>

                      {/* E: Lot ID */}
                      <td
                        onClick={() => setSelectedCell(`E${rowNum}`)}
                        className={clsx(
                          'py-2 px-3 border-r border-gray-200 text-gray-600 cursor-pointer',
                          selectedCell === `E${rowNum}` && 'ring-2 ring-[#107C41] ring-inset'
                        )}
                      >
                        {row.lotId}
                      </td>

                      {/* F: Initial Qty */}
                      <td
                        onClick={() => setSelectedCell(`F${rowNum}`)}
                        className={clsx(
                          'py-2 px-3 border-r border-gray-200 text-right text-gray-700 cursor-pointer',
                          selectedCell === `F${rowNum}` && 'ring-2 ring-[#107C41] ring-inset'
                        )}
                      >
                        {Number(row.initialQuantity || 0).toLocaleString()}
                      </td>

                      {/* G: Remaining Qty */}
                      <td
                        onClick={() => setSelectedCell(`G${rowNum}`)}
                        className={clsx(
                          'py-2 px-3 border-r border-gray-200 text-right font-bold text-gray-900 cursor-pointer',
                          selectedCell === `G${rowNum}` && 'ring-2 ring-[#107C41] ring-inset'
                        )}
                      >
                        {Number(row.remainingQuantity || 0).toLocaleString()}
                      </td>

                      {/* H: Status Level */}
                      <td
                        onClick={() => setSelectedCell(`H${rowNum}`)}
                        className={clsx(
                          'py-2 px-3 border-r border-gray-200 text-center cursor-pointer',
                          selectedCell === `H${rowNum}` && 'ring-2 ring-[#107C41] ring-inset'
                        )}
                      >
                        {st === 'CRITICAL' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">
                            <XCircle className="w-3 h-3" /> Critical
                          </span>
                        ) : st === 'WARNING' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-100 text-yellow-700">
                            <AlertTriangle className="w-3 h-3" /> Warning
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">
                            <CheckCircle2 className="w-3 h-3" /> OK
                          </span>
                        )}
                      </td>

                      {/* I: Scanned At */}
                      <td
                        onClick={() => setSelectedCell(`I${rowNum}`)}
                        className={clsx(
                          'py-2 px-3 border-r border-gray-200 text-gray-500 text-[11px] cursor-pointer',
                          selectedCell === `I${rowNum}` && 'ring-2 ring-[#107C41] ring-inset'
                        )}
                      >
                        {row.scannedAt ? new Date(row.scannedAt).toISOString().replace('T', ' ').substring(0, 19) : ''}
                      </td>

                      {/* J: Last Updated */}
                      <td
                        onClick={() => setSelectedCell(`J${rowNum}`)}
                        className={clsx(
                          'py-2 px-3 text-gray-500 text-[11px] cursor-pointer',
                          selectedCell === `J${rowNum}` && 'ring-2 ring-[#107C41] ring-inset'
                        )}
                      >
                        {row.lastUpdated ? new Date(row.lastUpdated).toISOString().replace('T', ' ').substring(0, 19) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── 5. EXCEL BOTTOM SHEET TABS (Like Microsoft Excel) ──────── */}
        <div className="bg-[#E5E7EB] border-t border-gray-300 px-3 py-1.5 flex items-center justify-between gap-2 shrink-0 select-none overflow-x-auto">
          <div className="flex items-center gap-1">
            {/* Master tab */}
            <button
              type="button"
              onClick={() => setLiveExcelCategory('ALL')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-t transition-all border-b-2 shadow-2xs',
                activeCategory === 'ALL'
                  ? 'bg-white text-[#107C41] border-[#107C41] shadow-xs'
                  : 'bg-gray-200/80 text-gray-600 hover:bg-white/70 border-transparent'
              )}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Master (All Sheets)</span>
            </button>

            {/* Individual category tabs */}
            {masterConfig && Object.entries(masterConfig.componentTypes).map(([type, meta]) => {
              const isActive = activeCategory === type;
              const count = historyData[type]?.length ?? 0;

              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setLiveExcelCategory(type)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-t transition-all border-b-2 shadow-2xs',
                    isActive
                      ? 'bg-white text-[#107C41] border-[#107C41] shadow-xs'
                      : 'bg-gray-200/80 text-gray-600 hover:bg-white/70 border-transparent'
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: meta.color }}
                  />
                  <span>{meta.label}</span>
                  <span className="text-[10px] text-gray-400 font-mono">({count})</span>
                </button>
              );
            })}
          </div>

          <div className="text-[11px] text-gray-500 font-sans hidden sm:block shrink-0">
            Sheet: <b>{activeCategory === 'ALL' ? 'Master Combined Workbook' : `${activeMeta?.label || activeCategory} Tab`}</b> · {allRows.length} Rows Loaded
          </div>
        </div>

      </div>
    </div>
  );
}
