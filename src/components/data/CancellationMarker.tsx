'use client';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { StatusChip } from './StatusChip';

export interface CancellationMarkerProps {
  /** The patient's cancellations in the period. */
  count: number;
  /** Amber from this many. */
  warning: number;
  /** Red "Frequent canceller" from this many. */
  threshold: number;
  months: number;
}

/**
 * Staff-only frequent-canceller marker (sprint 16, COMPONENTS.md → CancellationMarker): amber
 * "N cancellations" from the warning count, red "Frequent canceller" from the threshold, with the
 * count and period on hover or focus. Renders nothing below the warning. Never shown to patients
 * and never stops a booking.
 */
export function CancellationMarker({ count, warning, threshold, months }: CancellationMarkerProps) {
  if (count < warning) return null;
  const frequent = count >= threshold;
  const detail = `${count} cancellation${count === 1 ? '' : 's'} in the last ${months} month${months === 1 ? '' : 's'} (staff only)`;
  return (
    <Tooltip title={detail}>
      <Box component="span" tabIndex={0} aria-label={detail} sx={{ display: 'inline-flex', borderRadius: 999 }}>
        <StatusChip
          status={frequent ? 'Frequent canceller' : `${count} cancellations`}
          tone={frequent ? 'error' : 'warning'}
          variant="outlined"
          icon={<WarningAmberOutlined />}
        />
      </Box>
    </Tooltip>
  );
}
