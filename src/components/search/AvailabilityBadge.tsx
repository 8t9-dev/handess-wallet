/**
 * Availability Badge Component
 */

import { getStateLabel, getStateBgColor } from '../../lib/name-utils';
import type { AvailabilityStatus } from '../../types/domain';

interface AvailabilityBadgeProps {
  status: AvailabilityStatus;
}

export function AvailabilityBadge({ status }: AvailabilityBadgeProps) {
  return (
    <span className={`state-badge ${getStateBgColor(status)}`}>
      {getStateLabel(status)}
    </span>
  );
}
