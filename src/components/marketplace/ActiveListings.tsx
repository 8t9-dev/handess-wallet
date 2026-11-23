import type { MarketplaceListing } from '../../types/marketplace';
import { formatHNS } from '../../lib/name-utils';

interface ActiveListingsProps {
  listings: MarketplaceListing[];
  onCancel: (name: string) => void;
}

export function ActiveListings({ listings, onCancel }: ActiveListingsProps) {
  if (listings.length === 0) {
    return <div className="p-4 text-center text-gray-500">No active listings</div>;
  }

  return (
    <div className="space-y-3">
      {listings.map((listing) => (
        <div key={listing.name} className="card flex items-center justify-between">
          <div>
            <div className="font-mono font-medium">{listing.name}</div>
            <div className="text-sm text-gray-500">
              {formatHNS(listing.price)} HNS &middot; {listing.sellerAddr.slice(0, 16)}...
            </div>
          </div>
          <button
            onClick={() => onCancel(listing.name)}
            className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}