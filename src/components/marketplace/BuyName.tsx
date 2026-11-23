import type { MarketplaceListing } from '../../types/marketplace';
import { formatHNS } from '../../lib/name-utils';

interface BuyNameProps {
  listing: MarketplaceListing;
  onPurchase: () => void;
  onCancel: () => void;
}

export function BuyName({ listing, onPurchase, onCancel }: BuyNameProps) {
  return (
    <div className="card space-y-4">
      <h3 className="font-semibold">Buy {listing.name}</h3>
      <div className="text-2xl font-bold">{formatHNS(listing.price)} HNS</div>
      <div className="text-sm text-gray-500">
        Seller: {listing.sellerAddr}
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={onPurchase} className="flex-1 px-4 py-2 bg-hns-600 text-white rounded-lg">
          Purchase
        </button>
        <button onClick={onCancel} className="flex-1 px-4 py-2 border rounded-lg">
          Cancel
        </button>
      </div>
    </div>
  );
}