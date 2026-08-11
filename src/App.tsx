import { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { LayoutList, BarChart3, Radio } from 'lucide-react';
import { useSmtSocket } from './hooks/useSmtSocket';
import { useSmtStore } from './store/useSmtStore';
import { LineOverview } from './components/dashboard/LineOverview';
import { KpiSummary } from './components/dashboard/KpiSummary';
import { FilterBar } from './components/inventory/FilterBar';
import { ComponentTable } from './components/inventory/ComponentTable';
import { ComponentChart } from './components/inventory/ComponentChart';
import { ReplenishmentLogModal } from './components/dashboard/ReplenishmentLogModal';
import { CsvInspectorModal } from './components/dashboard/CsvInspectorModal';
import clsx from 'clsx';

function App() {
  useSmtSocket();
  
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');

  const activeLineId = useSmtStore(state => state.activeLineId);
  const activeLine = useSmtStore(state => state.lines[activeLineId]);
  const erpData = activeLine?.erp_data;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 sm:p-6 lg:p-8 font-sans">
      <Toaster position="top-right" toastOptions={{ className: 'text-sm font-sans' }} />
      
      {/* Top Header */}
      <header className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">SMT Floor Dashboard</h1>
            <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full">
              <Radio className="w-3 h-3 text-green-600 animate-pulse" /> Live IIoT
            </span>
          </div>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">
            Real-time event-driven inventory monitoring &amp; predictive replenishment engine
          </p>
        </div>

        <div>
          <LineOverview />
        </div>
      </header>

      <main className="space-y-6">
        
        {/* Executive KPI Summary Banner */}
        <section>
          <KpiSummary />
        </section>

        {/* ERP Order Banner */}
        {erpData && (
          <section className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div><span className="text-gray-500 mr-2">Active Customer:</span> <span className="font-bold text-gray-900">{erpData.customer}</span></div>
              <div>
                <span className="text-gray-500 mr-2">Batch Progress:</span> 
                <span className="font-bold text-blue-600">{erpData.completed_pcbs.toLocaleString()} / {erpData.ordered_pcbs.toLocaleString()} PCBs</span>
              </div>
              <div><span className="text-gray-500 mr-2">Deadline:</span> <span className="font-medium text-gray-800">{erpData.deadline}</span></div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Target Finish:</span> 
                <span className="font-medium text-gray-900">{erpData.expected_finish}</span>
                <span className={clsx(
                  "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
                  erpData.schedule_status === 'ahead of schedule' ? 'bg-green-100 text-green-700' :
                  erpData.schedule_status === 'behind schedule' ? 'bg-red-100 text-red-700' :
                  'bg-blue-100 text-blue-700'
                )}>
                  {erpData.schedule_status}
                </span>
              </div>
            </div>
            <div className="text-[11px] text-gray-400 italic md:ml-auto bg-gray-50 px-2.5 py-1 rounded-md border border-gray-100">
              Integrated ERP Sync
            </div>
          </section>
        )}

        {/* Inventory View Controls */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold text-gray-800 tracking-tight">Live Feeder Inventory</h2>
            
            <div className="flex bg-gray-200/80 p-1 rounded-xl self-start sm:self-auto">
              <button
                onClick={() => setViewMode('table')}
                className={clsx(
                  "flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-200",
                  viewMode === 'table' ? "bg-white text-blue-600 shadow-sm" : "text-gray-600 hover:text-gray-900"
                )}
              >
                <LayoutList className="w-4 h-4" /> Table View
              </button>
              <button
                onClick={() => setViewMode('chart')}
                className={clsx(
                  "flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-200",
                  viewMode === 'chart' ? "bg-white text-blue-600 shadow-sm" : "text-gray-600 hover:text-gray-900"
                )}
              >
                <BarChart3 className="w-4 h-4" /> Bar Chart View
              </button>
            </div>
          </div>

          {/* Search & Status Filter Bar */}
          <FilterBar />

          {/* Table or Chart Component */}
          {viewMode === 'table' ? <ComponentTable /> : <ComponentChart />}

        </section>

      </main>

      {/* Slide-over & Modal Windows */}
      <ReplenishmentLogModal />
      <CsvInspectorModal />

    </div>
  );
}

export default App;