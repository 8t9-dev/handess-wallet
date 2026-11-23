import { useState } from 'react';

interface ListForSaleProps {
  name: string;
  onSubmit: (price: number, sellerAddr: string) => void;
  onCancel: () => void;
}

export function ListForSale({ name, onSubmit, onCancel }: ListForSaleProps) {
  const [price, setPrice] = useState('');
  const [sellerAddr, setSellerAddr] = useState('');

  const handleSubmit = () => {
    const p = parseFloat(price);
    if (p > 0) {
      onSubmit(p, sellerAddr.trim());
    }
  };

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold">List {name} for Sale</h3>
      <div>
        <label className="block text-sm font-medium mb-1">Price (HNS)</label>
        <input
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
          placeholder="100"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Seller Address (optional)</label>
        <input
          type="text"
          value={sellerAddr}
          onChange={(e) => setSellerAddr(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
          placeholder="hs1q... (leave empty for wallet addr)"
        />
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={handleSubmit} className="flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg">
          List for Sale
        </button>
        <button onClick={onCancel} className="flex-1 px-4 py-2 border rounded-lg">
          Cancel
        </button>
      </div>
    </div>
  );
}