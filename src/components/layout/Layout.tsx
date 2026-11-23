/**
 * Layout Component
 *
 * Main app layout with sidebar navigation and header.
 * Wraps all page content.
 */

import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useNotificationSubscription } from '../../hooks/useNotificationSubscription';
import { useBatchProgressSubscription } from '../../hooks/useBatchProgressSubscription';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  // Bridges the main-process notification events into the renderer store
  // so the bell dropdown stays in sync for the lifetime of the app.
  useNotificationSubscription();
  useBatchProgressSubscription();

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
