import type { Contact } from '../types';

interface Props {
  address: string;
  contacts: Contact[];
  currentContact: string | null;
  wakuReady: boolean;
  onSelectContact: (address: string) => void;
  newAddress: string;
  onNewAddressChange: (value: string) => void;
  onAddContact: () => void;
  addingContact: boolean;
  addError: string;
}

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

export function Sidebar({
  address,
  contacts,
  currentContact,
  wakuReady,
  onSelectContact,
  newAddress,
  onNewAddressChange,
  onAddContact,
  addingContact,
  addError,
}: Props) {
  return (
    <div className="w-60 bg-surface border-r border-border flex flex-col h-full">
      {/* Identity */}
      <div className="px-4 py-4 border-b border-border">
        <div className="text-[9px] uppercase tracking-[0.3em] text-neon-cyan/30 mb-1">node</div>
        <div className="text-xs font-mono text-neon-cyan/70 glow-cyan">{shortenAddress(address)}</div>
        <div className="mt-2 flex items-center gap-1.5">
          <div
            className={`w-1.5 h-1.5 rounded-full ${wakuReady ? 'bg-neon-green' : 'bg-neon-yellow animate-pulse'}`}
          />
          <span className={`text-[9px] uppercase tracking-wider ${wakuReady ? 'text-neon-green/50' : 'text-neon-yellow/50'}`}>
            {wakuReady ? 'waku connected' : 'connecting...'}
          </span>
        </div>
      </div>

      {/* Add Contact */}
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[9px] uppercase tracking-[0.3em] text-text-dim mb-2">add contact</div>
        <div className="flex gap-1">
          <input
            value={newAddress}
            onChange={(e) => onNewAddressChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAddContact()}
            placeholder="0x..."
            disabled={!wakuReady || addingContact}
            className="flex-1 bg-bg text-[10px] text-text-muted px-2 py-1.5
                       border border-border font-mono
                       focus:outline-none focus:border-neon-cyan/30
                       placeholder:text-text-dim disabled:opacity-30
                       caret-neon-cyan"
          />
          <button
            onClick={onAddContact}
            disabled={!wakuReady || addingContact || !newAddress.trim()}
            className="text-[9px] text-neon-cyan/70 hover:text-neon-cyan
                       disabled:opacity-30 transition-colors px-1"
          >
            {addingContact ? '...' : '[add]'}
          </button>
        </div>
        {addError && (
          <div className="text-[9px] text-neon-magenta/70 mt-1">{addError}</div>
        )}
      </div>

      {/* Contacts */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="text-[9px] uppercase tracking-[0.3em] text-text-dim mb-3">
          contacts [{contacts.length}]
        </div>
        <div className="space-y-0.5">
          {contacts.map((contact) => (
            <button
              key={contact.address}
              onClick={() => onSelectContact(contact.address)}
              className={`w-full text-left px-3 py-2 text-xs font-mono transition-colors ${
                currentContact === contact.address
                  ? 'bg-neon-cyan/10 text-neon-cyan border-l-2 border-neon-cyan'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text border-l-2 border-transparent'
              }`}
            >
              {shortenAddress(contact.address)}
            </button>
          ))}
          {contacts.length === 0 && (
            <div className="text-[10px] text-text-dim italic">no contacts yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
