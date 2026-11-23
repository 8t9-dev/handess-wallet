/**
 * Auction List Component
 */

interface AuctionListProps {
  auctions: unknown[];
  isLoading: boolean;
}

export function AuctionList({ auctions, isLoading }: AuctionListProps) {
  if (isLoading) return <div className="p-4 text-center text-gray-500">Loading...</div>;
  if (auctions.length === 0) return <div className="p-4 text-center text-gray-500">No auctions</div>;
  return <div className="p-4">Auction list placeholder</div>;
}
