/**
 * Connection Status Component
 */

import { useConnection } from '../../hooks/useConnection';
import { Wifi, WifiOff, Loader } from 'lucide-react';

export function ConnectionStatus() {
  const { connectionState } = useConnection();

  if (connectionState === 'connected') {
    return (
      <div className="flex items-center gap-2 text-green-600">
        <Wifi className="w-4 h-4" />
        <span className="text-sm">Connected</span>
      </div>
    );
  }

  if (connectionState === 'connecting') {
    return (
      <div className="flex items-center gap-2 text-amber-600">
        <Loader className="w-4 h-4 animate-spin" />
        <span className="text-sm">Connecting...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-red-600">
      <WifiOff className="w-4 h-4" />
      <span className="text-sm">Disconnected</span>
    </div>
  );
}
