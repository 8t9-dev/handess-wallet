/**
 * Bid Form Component
 */

import { useState } from 'react';

interface BidFormProps {
  name: string;
  onSubmit: (bid: number, lockup: number) => void;
  onCancel: () => void;
  balance: number;
}

export function BidForm({ name, onSubmit, onCancel, balance: _balance }: BidFormProps) {
  const [bid, setBid] = useState('');
  const [lockup, setLockup] = useState('');

  const handleSubmit = () => {
    const bidNum = parseFloat(bid);
    const lockupNum = parseFloat(lockup);
    if (bidNum > 0 && lockupNum >= bidNum) {
      onSubmit(bidNum, lockupNum);
    }
  };

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold">Place Bid on {name}</h3>
      <div>
        <label className="block text-sm font-medium mb-1">Bid Amount (HNS)</label>
        <input
          type="number"
          step="0.01"
          value={bid}
          onChange={(e) => setBid(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
          placeholder="0.00"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Lockup (HNS)</label>
        <input
          type="number"
          step="0.01"
          value={lockup}
          onChange={(e) => setLockup(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
          placeholder="0.00"
        />
        <p className="text-xs text-gray-500 mt-1">Recommended: 2x your bid</p>
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={handleSubmit} className="flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg">
          Place Bid
        </button>
        <button onClick={onCancel} className="flex-1 px-4 py-2 border rounded-lg">
          Cancel
        </button>
      </div>
    </div>
  );
}
