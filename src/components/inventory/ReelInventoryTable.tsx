/**
 * ReelInventoryTable — Displays reel inventory grouped by component category.
 *
 * FULLY DATA-DRIVEN: categories are rendered dynamically from MASTER.json.
 * This component contains ZERO references to specific component types
 * (RESISTOR, CAPACITOR, etc.). It renders whatever MASTER.json defines.
 *
 * QR fields shown: partNumber, partsId, lotId, initialQuantity, remainingQuantity
 * Alert levels (OK, Warning, Critical) are computed on the backend using 
 * the absolute quantities defined in thresholds.json.
 */

import { useMemo, useState } from 'react';
import { useSmtStore } from '../../store/useSmtStore';
import { Package, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, XCircle, Loader2, Layers } from 'lucide-react';
import clsx from 'clsx';
import type { ReelRecord, MasterComponentEntry } from '../../types';

// ─── QUANTITY STATUS BADGE ────────────────────────────────────────────────────
function QuantityBadge({ reel }: { reel: ReelRecord }) {
  const level = reel.computedStatus || 'ok';

  if (level === 'critical') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 ring-1 ring-red-300">
      <XCircle className="w-3 h-3" /> Critical
    </span>
  );
  if (level === 'warning') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700 ring-1 ring-yellow-300">
      <AlertTriangle className="w-3 h-3" /> Warning
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">
      <CheckCircle2 className="w-3 h-3" /> OK
    </span>
  );
}

// ─── QUANTITY BAR ─────────────────────────────────────────────────────────────
function QuantityBar({ reel }: { reel: ReelRecord }) {
  const pct = reel.initialQuantity > 0
    ? Math.min(100, Math.round((reel.remainingQuantity / reel.initialQuantity) * 100))
    : 0;

  const color = 
    reel.computedStatus === 'critical' ? 'bg-red-500' : 
    reel.computedStatus === 'warning'  ? 'bg-yellow-400' : 
    'bg-green-500';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── CATEGORY ACCORDION ───────────────────────────────────────────────────────
interface CategoryAccordionProps {
  componentType: string;
  meta: MasterComponentEntry;
  reels: ReelRecord[];
}

function CategoryAccordion({ componentType, meta, reels }: CategoryAccordionProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Compute alert counts from backend-computed status
  const criticalCount = reels.filter(r => r.computedStatus === 'critical').length;
  const warningCount  = reels.filter(r => r.computedStatus === 'warning').length;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      {/* Header — clickable */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-white hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs shadow-sm"
            style={{ backgroundColor: meta.color }}
          >
            {meta.symbol}
          </div>
          <div className="text-left">
            <span className="font-bold text-gray-900 text-sm">{meta.label}</span>
            <span className="ml-2 text-xs text-gray-400 font-mono">{componentType}</span>
          </div>
          {criticalCount > 0 && (
            <span className="flex items-center gap-1 text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full animate-pulse">
              <XCircle className="w-3 h-3" /> {criticalCount} Critical
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1 text-xs font-bold text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full">
              <AlertTriangle className="w-3 h-3" /> {warningCount} Warning
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
            {reels.length} reel{reels.length !== 1 ? 's' : ''}
          </span>
          {isOpen
            ? <ChevronDown className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />
          }
        </div>
      </button>

      {/* Table */}
      {isOpen && (
        <div className="border-t border-gray-100">
          {reels.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400 italic">
              No reels registered for this component type yet.
              <br />
              <span className="text-xs">Scan a reel whose Part Number maps to {componentType} in MASTER.json.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Reel ID</th>
                    <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Part Number</th>
                    <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Parts ID</th>
                    <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Lot ID</th>
                    <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-52">Quantity</th>
                    <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Level</th>
                    <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Scanned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {reels.map(reel => {
                    const isCritical = reel.computedStatus === 'critical';
                    const isWarning  = reel.computedStatus === 'warning';
                    return (
                      <tr
                        key={reel.reelId}
                        className={clsx(
                          'transition-colors hover:bg-gray-50',
                          isCritical && 'bg-red-50/40',
                          isWarning  && 'bg-yellow-50/40'
                        )}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700">{reel.reelId}</td>
                        <td className="px-4 py-3 font-medium text-gray-900 font-mono text-xs">{reel.partNumber}</td>
                        <td className="px-4 py-3 text-xs text-gray-600 font-mono">{reel.partsId}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono">{reel.lotId}</td>
                        <td className="px-4 py-3 w-52">
                          <div className="mb-1 flex items-baseline gap-1.5">
                            <span className="font-mono font-bold text-gray-900">
                              {reel.remainingQuantity.toLocaleString()}
                            </span>
                            <span className="text-xs text-gray-400">
                              / {reel.initialQuantity.toLocaleString()}
                            </span>
                          </div>
                          <QuantityBar reel={reel} />
                        </td>
                        <td className="px-4 py-3"><QuantityBadge reel={reel} /></td>
                        <td className="px-4 py-3 text-xs text-gray-400">
                          {new Date(reel.scannedAt).toLocaleString('en-GB', {
                            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export function ReelInventoryTable() {
  const reelInventory = useSmtStore(s => s.reelInventory);
  const masterConfig  = useSmtStore(s => s.masterConfig);
  const isLoading     = useSmtStore(s => s.isReelInventoryLoading);

  // Global stats computed from backend status
  const stats = useMemo(() => {
    let total = 0, critical = 0, warning = 0, ok = 0;
    Object.values(reelInventory).forEach(cat => {
      (cat.reels ?? []).forEach(r => {
        total++;
        if (r.computedStatus === 'critical') critical++;
        else if (r.computedStatus === 'warning') warning++;
        else ok++;
      });
    });
    return { total, critical, warning, ok };
  }, [reelInventory]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-blue-500" />
        <p className="font-medium">Loading reel inventory...</p>
      </div>
    );
  }

  if (!masterConfig) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <Layers className="w-10 h-10 mb-3" />
        <p className="font-bold text-gray-600">Inventory server not connected</p>
        <p className="text-sm mt-1">Start <code className="bg-gray-100 px-1 rounded">inventory-server.js</code> on port 3002</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Reels', value: stats.total,    color: 'text-gray-900',   bg: 'bg-white' },
          { label: 'OK',          value: stats.ok,       color: 'text-green-700',  bg: 'bg-green-50' },
          { label: 'Warning',     value: stats.warning,  color: 'text-yellow-700', bg: 'bg-yellow-50' },
          { label: 'Critical',    value: stats.critical, color: 'text-red-700',    bg: 'bg-red-50' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={clsx('rounded-xl p-3 border border-gray-200 shadow-sm', bg)}>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</p>
            <p className={clsx('text-2xl font-extrabold mt-0.5', color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Category Accordions — rendered from MASTER.json, zero hardcoded categories */}
      <div className="space-y-3">
        {Object.entries(masterConfig.componentTypes).map(([type, meta]) => {
          const categoryData = reelInventory[type];
          const reels = categoryData?.reels ?? [];
          return (
            <CategoryAccordion
              key={type}
              componentType={type}
              meta={meta}
              reels={reels}
            />
          );
        })}
      </div>

      {Object.keys(masterConfig.componentTypes).length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Package className="w-10 h-10 mx-auto mb-2" />
          <p className="font-bold">No component types configured</p>
          <p className="text-sm mt-1">Add entries to <code className="bg-gray-100 px-1 rounded">MASTER.json → componentTypes</code></p>
        </div>
      )}
    </div>
  );
}
