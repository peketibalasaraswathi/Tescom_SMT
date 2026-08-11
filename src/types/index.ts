export type ComponentStatus = 'ok' | 'warning' | 'critical';
export type StatusFilterType = 'all' | 'critical' | 'warning' | 'ok';

export interface SmtComponent {
  part_number: string;
  feeder_position: string;
  description: string;
  current_quantity: number;
  quantity_threshold: number;
  status: ComponentStatus;
  line_id: string;
  parts_per_second?: number | null; 
  time_left_seconds?: number | null; 
}

export interface ErpOrderData {
  customer: string;
  ordered_pcbs: number;
  completed_pcbs: number;
  expected_finish: string;
  schedule_status: 'ahead of schedule' | 'behind schedule' | 'on schedule';
  deadline: string;
}

export interface SmtLine {
  id: string;
  name: string;
  connection_status: 'online' | 'offline' | 'stale';
  last_updated: number;
  erp_data?: ErpOrderData;
}

export interface ReplenishmentEvent {
  id: string;
  timestamp: number;
  line_id: string;
  feeder_position: string;
  part_number: string;
  previous_qty: number;
  new_qty: number;
  replenished_amount: number;
}

export interface KpiMetrics {
  totalFeeders: number;
  criticalCount: number;
  warningCount: number;
  okCount: number;
  totalConsumptionRate: number;
}