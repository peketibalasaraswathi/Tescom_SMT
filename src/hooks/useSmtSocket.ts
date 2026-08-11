import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useSmtStore } from '../store/useSmtStore';
import toast from 'react-hot-toast';
import type { ReplenishmentEvent, SmtComponent } from '../types';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'; 

function playCriticalChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Gracefully handle browser autoplay blocks
  }
}

export const useSmtSocket = () => {
  const socketRef = useRef<Socket | null>(null);
  const previousCriticalSet = useRef<Set<string>>(new Set());

  const updateInventoryBatch = useSmtStore((state) => state.updateInventoryBatch);
  const updateLineStatus = useSmtStore((state) => state.updateLineStatus);
  const updateLinesData = useSmtStore((state) => state.updateLinesData);
  const addReplenishmentEvent = useSmtStore((state) => state.addReplenishmentEvent);
  const setReplenishmentHistory = useSmtStore((state) => state.setReplenishmentHistory);
  const soundAlertEnabled = useSmtStore((state) => state.soundAlertEnabled);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL);

    socketRef.current.on('connect', () => {
      toast.success('Connected to Ingestion Service');
      socketRef.current?.emit('request_replenishment_history');
    });

    socketRef.current.on('disconnect', () => {
      toast.error('Lost connection to backend');
      ['line_1', 'line_2', 'line_3', 'line_4'].forEach(id => updateLineStatus(id, 'offline'));
    });

    // Listen for Component Batch Updates
    socketRef.current.on('inventory_batch_update', (data: SmtComponent[]) => {
      updateInventoryBatch(data);

      // Check for new critical alerts
      const currentCritical = new Set<string>();
      let newlyCriticalCount = 0;
      let lastCriticalFeeder = '';

      data.forEach(comp => {
        if (comp.status === 'critical') {
          const key = `${comp.line_id}-${comp.feeder_position}`;
          currentCritical.add(key);
          if (!previousCriticalSet.current.has(key)) {
            newlyCriticalCount++;
            lastCriticalFeeder = `${comp.feeder_position} (${comp.part_number})`;
          }
        }
      });

      if (newlyCriticalCount > 0) {
        const msg = newlyCriticalCount === 1 
          ? `CRITICAL ALERT: ${lastCriticalFeeder} < 30s remaining!`
          : `CRITICAL ALERT: ${newlyCriticalCount} Feeders < 30s remaining!`;
        
        toast.error(msg, {
          duration: 4000,
          icon: '🚨',
          id: 'critical-summary-toast'
        });

        if (soundAlertEnabled) {
          playCriticalChime();
        }
      }

      previousCriticalSet.current = currentCritical;
    });

    // Listen for ERP / Line Status Updates
    socketRef.current.on('line_data_update', (linesArray: any[]) => {
      updateLinesData(linesArray);
    });

    // Listen for Reel Replenishment Events
    socketRef.current.on('replenishment_event', (event: ReplenishmentEvent) => {
      addReplenishmentEvent(event);
      toast.success(`REEL REPLENISHED: ${event.feeder_position} (${event.part_number}) +${event.replenished_amount.toLocaleString()} parts!`, {
        icon: '⚡',
        duration: 3500,
        id: `replenish-toast-${event.line_id}`
      });
    });

    // Initial replenishment history dump
    socketRef.current.on('replenishment_history', (events: ReplenishmentEvent[]) => {
      setReplenishmentHistory(events);
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [updateInventoryBatch, updateLineStatus, updateLinesData, addReplenishmentEvent, setReplenishmentHistory, soundAlertEnabled]);

  return null;
};