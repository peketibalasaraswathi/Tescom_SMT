/**
 * useInventoryApi — React hook for the SMT Inventory REST API (port 3002)
 *
 * Provides:
 *  - Fetch master config, full inventory, single category
 *  - Submit a QR scan string
 *  - Update a reel's remaining quantity
 *  - Delete a reel
 *
 * All routing is driven by MASTER.json on the backend — this hook
 * contains zero component-type-specific logic.
 */

import { useCallback, useEffect } from 'react';
import { useSmtStore } from '../store/useSmtStore';
import type { ScanResult, MasterConfig, CategoryInventory, ReelRecord } from '../types';
import toast from 'react-hot-toast';

const INVENTORY_API = import.meta.env.VITE_INVENTORY_API_URL || 'http://localhost:3002';

// ─── GENERIC FETCH HELPER ────────────────────────────────────────────────────
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${INVENTORY_API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `HTTP ${res.status}`);
  }
  return data as T;
}

// ─── HOOK ────────────────────────────────────────────────────────────────────
export function useInventoryApi() {
  const setMasterConfig          = useSmtStore(s => s.setMasterConfig);
  const setReelInventory         = useSmtStore(s => s.setReelInventory);
  const setIsReelInventoryLoading = useSmtStore(s => s.setIsReelInventoryLoading);
  const updateReelCategory       = useSmtStore(s => s.updateReelCategory);

  // ── Load master config on mount ─────────────────────────────────
  const fetchMasterConfig = useCallback(async () => {
    try {
      const master = await apiFetch<MasterConfig>('/api/config/master');
      setMasterConfig(master);
      return master;
    } catch (err: any) {
      console.error('[useInventoryApi] Failed to load master config:', err.message);
      return null;
    }
  }, [setMasterConfig]);

  // ── Fetch complete inventory (all categories) ────────────────────
  const fetchAllInventory = useCallback(async () => {
    setIsReelInventoryLoading(true);
    try {
      const data = await apiFetch<Record<string, CategoryInventory>>('/api/inventory');
      setReelInventory(data);
    } catch (err: any) {
      console.error('[useInventoryApi] Failed to fetch inventory:', err.message);
      toast.error('Could not load reel inventory from server');
    } finally {
      setIsReelInventoryLoading(false);
    }
  }, [setReelInventory, setIsReelInventoryLoading]);

  // ── Fetch all historical records from Excel archives ───────────
  const fetchAllHistory = useCallback(async (): Promise<Record<string, ReelRecord[]>> => {
    try {
      return await apiFetch<Record<string, ReelRecord[]>>('/api/inventory/history/all');
    } catch (err: any) {
      console.error('[useInventoryApi] Failed to fetch all history:', err.message);
      return {};
    }
  }, []);

  // ── Fetch single category historical records from Excel ────────
  const fetchCategoryHistory = useCallback(async (componentType: string): Promise<ReelRecord[]> => {
    try {
      const res = await apiFetch<{ componentType: string; totalReels: number; reels: ReelRecord[] }>(`/api/inventory/${encodeURIComponent(componentType)}/history`);
      return res.reels || [];
    } catch (err: any) {
      console.error(`[useInventoryApi] Failed to fetch history for ${componentType}:`, err.message);
      return [];
    }
  }, []);

  // ── Fetch a single category ──────────────────────────────────────
  const fetchCategory = useCallback(async (componentType: string) => {
    try {
      const data = await apiFetch<CategoryInventory>(`/api/inventory/${componentType}`);
      updateReelCategory(data);
      return data;
    } catch (err: any) {
      console.error(`[useInventoryApi] Failed to fetch category ${componentType}:`, err.message);
      return null;
    }
  }, [updateReelCategory]);

  // ── Submit a QR scan string ──────────────────────────────────────
  const submitScan = useCallback(async (rawQr: string): Promise<ScanResult | null> => {
    if (!rawQr.trim()) return null;
    try {
      const result = await apiFetch<ScanResult>('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ rawQr }),
      });

      if (result.success) {
        if (result.action === 'created') {
          toast.success(
            `✅ New reel ${result.reelId} → ${result.componentType} (${result.partNumber})`,
            { duration: 4000 }
          );
        } else {
          // already_registered
          toast(
            `🔄 Reel ${result.reelId} already registered — scan recorded`,
            { icon: 'ℹ️', duration: 3000 }
          );
        }
        // Refresh that specific category
        await fetchCategory(result.componentType);
      }

      return result;
    } catch (err: any) {
      let userMessage = err.message;
      if (err.message.includes('UNKNOWN_PART')) {
        userMessage = `Unknown part number. Add it to MASTER.json → partMappings.`;
      } else if (err.message.includes('INVALID_QR')) {
        userMessage = `Invalid QR format. Expected: PART_NUMBER$PARTS_ID$LOT_ID$QTY`;
      }
      toast.error(`Scan failed: ${userMessage}`, { duration: 5000 });
      return null;
    }
  }, [fetchCategory]);

  // ── Update remaining quantity ────────────────────────────────────
  const updateReelQuantity = useCallback(async (
    reelId: string,
    remainingQuantity: number,
    componentType?: string
  ) => {
    try {
      await apiFetch(`/api/reel/${reelId}/quantity`, {
        method: 'PUT',
        body: JSON.stringify({ remainingQuantity, componentType }),
      });
      // Refresh inventory after update
      if (componentType) {
        await fetchCategory(componentType);
      } else {
        await fetchAllInventory();
      }
    } catch (err: any) {
      toast.error(`Failed to update quantity: ${err.message}`);
    }
  }, [fetchCategory, fetchAllInventory]);

  // ── Delete a reel ────────────────────────────────────────────────
  const deleteReel = useCallback(async (reelId: string, componentType?: string) => {
    try {
      await apiFetch(`/api/reel/${reelId}${componentType ? `?componentType=${componentType}` : ''}`, {
        method: 'DELETE',
      });
      toast.success(`Reel ${reelId} removed`);
      if (componentType) {
        await fetchCategory(componentType);
      } else {
        await fetchAllInventory();
      }
    } catch (err: any) {
      toast.error(`Failed to delete reel: ${err.message}`);
    }
  }, [fetchCategory, fetchAllInventory]);

  // ── Download Category Excel ─────────────────────────────────────
  const downloadCategoryExcel = useCallback((componentType: string) => {
    try {
      const url = `${INVENTORY_API}/api/inventory/${encodeURIComponent(componentType)}/excel`;
      const a = document.createElement('a');
      a.href = url;
      a.download = `${componentType}_Reel_Inventory.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(`Downloading ${componentType}.xlsx...`, { icon: '📊' });
    } catch (err: any) {
      toast.error(`Download failed: ${err.message}`);
    }
  }, []);

  // ── Download All Categories Master Excel ─────────────────────────
  const downloadAllExcel = useCallback(() => {
    try {
      const url = `${INVENTORY_API}/api/inventory/export/all-excel`;
      const a = document.createElement('a');
      a.href = url;
      a.download = `SMT_All_Categories_Inventory.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success('Downloading Master Excel Workbook...', { icon: '📊' });
    } catch (err: any) {
      toast.error(`Download failed: ${err.message}`);
    }
  }, []);

  // ── Auto-load on mount ───────────────────────────────────────────
  useEffect(() => {
    fetchMasterConfig();
    fetchAllInventory();
  }, [fetchMasterConfig, fetchAllInventory]);

  return {
    fetchMasterConfig,
    fetchAllInventory,
    fetchCategory,
    fetchAllHistory,
    fetchCategoryHistory,
    submitScan,
    updateReelQuantity,
    deleteReel,
    downloadCategoryExcel,
    downloadAllExcel
  };
}
