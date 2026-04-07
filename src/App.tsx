import { useState } from 'react';
import { WalletConnect } from './components/WalletConnect';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { useChat } from './hooks/useChat';

interface Identity {
  address: string;
  keyPair: CryptoKeyPair;
  publicKeyJwk: JsonWebKey;
  signature: string;
}

function ChatApp({ identity }: { identity: Identity }) {
  const {
    contacts,
    currentContact,
    setCurrentContact,
    messages,
    wakuReady,
    addContact,
    sendMessage,
  } = useChat(identity);

  const [addingContact, setAddingContact] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [addError, setAddError] = useState('');

  const handleAddContact = async () => {
    if (!newAddress.trim()) return;
    setAddingContact(true);
    setAddError('');
    const ok = await addContact(newAddress.trim());
    if (!ok) {
      setAddError('pre-key bundle not found');
    }
    setAddingContact(false);
    if (ok) setNewAddress('');
  };

  return (
    <div className="flex h-screen bg-bg text-text">
      <Sidebar
        address={identity.address}
        contacts={contacts}
        currentContact={currentContact}
        wakuReady={wakuReady}
        onSelectContact={setCurrentContact}
        newAddress={newAddress}
        onNewAddressChange={setNewAddress}
        onAddContact={handleAddContact}
        addingContact={addingContact}
        addError={addError}
      />

      <div className="flex-1 flex flex-col">
        {currentContact ? (
          <ChatView
            messages={messages}
            currentAddress={identity.address}
            peerAddress={currentContact}
            onSendMessage={sendMessage}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <p className="text-sm text-text-muted">no conversation selected</p>
              <p className="text-xs text-text-muted/70">add a contact by wallet address to start chatting</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);

  if (!identity) {
    return <WalletConnect onConnected={setIdentity} />;
  }

  return <ChatApp identity={identity} />;
}

export default App;
