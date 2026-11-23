import { useState } from 'react';
import { X, Plus, Loader2, Bell } from 'lucide-react';

const NOTIFY_OPTIONS = [
  { value: 'none', label: 'No notification' },
  { value: 'bidding', label: 'Notify when bidding starts' },
  { value: 'available', label: 'Notify when domain is Available' },
] as const;

interface AddWatchlistModalProps {
  onAdd: (name: string, notes?: string, notifyOn?: 'none' | 'bidding' | 'available') => Promise<void>;
  onClose: () => void;
}

export function AddWatchlistModal({ onAdd, onClose }: AddWatchlistModalProps) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [notifyOn, setNotifyOn] = useState('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
      setError('Enter a name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd(trimmed, notes.trim() || undefined, notifyOn as 'none' | 'bidding' | 'available');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Plus className="w-5 h-5 text-hns-600" />
            Add to Watchlist
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Domain Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
            placeholder="example"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5" />
            Notify when
          </label>
          <select
            value={notifyOn}
            onChange={e => setNotifyOn(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
          >
            {NOTIFY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Notes <span className="text-gray-400 font-normal">optional</span></label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 resize-none"
            placeholder="Why are you watching this name?"
            rows={2}
          />
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm">{error}</div>
        )}

        <button
          onClick={handleSubmit}
          disabled={busy || !name.trim()}
          className="w-full py-2.5 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? 'Adding...' : 'Add to Watchlist'}
        </button>
      </div>
    </div>
  );
}
