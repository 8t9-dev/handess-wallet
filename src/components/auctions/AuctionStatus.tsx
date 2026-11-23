/**
 * Auction Status Component
 */

interface AuctionStatusProps {
  name: string;
  state: string;
  bidEndBlock: number;
  revealEndBlock: number;
}

export function AuctionStatus({ name, state, bidEndBlock, revealEndBlock }: AuctionStatusProps) {
  const getStatusColor = () => {
    switch (state) {
      case 'BIDDING': return 'text-amber-600 bg-amber-50';
      case 'REVEAL': return 'text-orange-600 bg-orange-50';
      case 'CLOSED': return 'text-green-600 bg-green-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <div className={`p-3 rounded-lg ${getStatusColor()}`}>
      <div className="font-medium">{name}</div>
      <div className="text-sm">State: {state}</div>
      <div className="text-xs mt-1">
        Bidding ends: Block {bidEndBlock.toLocaleString()}
      </div>
      <div className="text-xs">
        Reveal ends: Block {revealEndBlock.toLocaleString()}
      </div>
    </div>
  );
}
