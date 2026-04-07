import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../types';

interface Props {
  messages: ChatMessage[];
  currentAddress: string;
  peerAddress: string;
  onSendMessage: (text: string) => void;
}

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ChatView({ messages, currentAddress, peerAddress, onSendMessage }: Props) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (input.trim()) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-neon-cyan/40 text-xs">@</span>
          <h2 className="text-sm text-neon-cyan glow-cyan font-mono">{shortenAddress(peerAddress)}</h2>
        </div>
        <div className="text-[9px] text-text-muted uppercase tracking-wider">
          x3dh + aes-256-gcm
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <div className="text-[10px] text-text-muted uppercase tracking-wider">
                // e2ee channel initialized — no messages yet
              </div>
            </div>
          )}
          {messages.map((msg) => {
            const isMine = msg.senderAddress === currentAddress;
            return (
              <div key={msg.id} className="group">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-text-muted font-mono w-16 shrink-0">
                    {formatTime(msg.timestamp)}
                  </span>
                  <span className={`text-[11px] font-mono shrink-0 ${
                    isMine ? 'text-neon-magenta' : 'text-neon-green'
                  }`}>
                    {isMine ? 'you' : shortenAddress(msg.senderAddress)}
                  </span>
                  <span className="text-text-muted text-xs">:</span>
                  <span className="text-sm text-text break-words">{msg.content}</span>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="px-6 py-3 border-t border-border">
        <div className="flex items-center gap-3">
          <span className="text-neon-cyan/40">&gt;</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="type message..."
            className="flex-1 bg-transparent text-sm text-text py-1
                       focus:outline-none placeholder:text-text-muted caret-neon-cyan"
          />
          <button
            onClick={handleSend}
            className="text-[10px] uppercase tracking-wider text-neon-cyan/50
                       hover:text-neon-cyan transition-colors"
          >
            [send]
          </button>
        </div>
      </div>
    </div>
  );
}
