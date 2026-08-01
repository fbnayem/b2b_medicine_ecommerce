import { useState } from 'react';
import { ReportGranularity } from '@medsupply/shared-types';
import { apiClient } from '../api/client';

export interface AppliedRange extends Record<string, unknown> {
  from: string;
  to: string;
  granularity: ReportGranularity;
}

export interface ReportRange {
  from: string;
  to: string;
  granularity: ReportGranularity;
  applied: AppliedRange;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  setGranularity: (value: ReportGranularity) => void;
  apply: () => void;
}

function today() {
  // Asia/Dhaka, so a report opened late at night still defaults to "today".
  return new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
}

export function useReportRange(): ReportRange {
  const to = today();
  const from = `${to.slice(0, 8)}01`;
  const [fromValue, setFrom] = useState(from);
  const [toValue, setTo] = useState(to);
  const [granularity, setGranularity] = useState<ReportGranularity>(ReportGranularity.DAY);
  const [applied, setApplied] = useState<AppliedRange>({
    from,
    to,
    granularity: ReportGranularity.DAY,
  });
  return {
    from: fromValue,
    to: toValue,
    granularity,
    applied,
    setFrom,
    setTo,
    setGranularity,
    apply: () => setApplied({ from: fromValue, to: toValue, granularity }),
  };
}

/**
 * Downloads a CSV through the authenticated client rather than a bare link, so
 * the export carries the access token instead of relying on a cookie.
 */
export async function downloadCsv(path: string, params: Record<string, unknown>, filename: string) {
  const response = await apiClient.get(path, {
    params: { ...params, format: 'csv' },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
