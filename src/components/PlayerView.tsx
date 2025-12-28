import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import TokenCreator from './TokenCreator';
import TokenHeader from './TokenHeader';
import AppHeader from './AppHeader';
import { API_URL } from '../config';
import type { Actor, Token } from '../types';
import './PlayerView.css';

interface GameState {
  tokens: Token[];
  currentActorId?: string | null;
}

export default function PlayerView() {
  // Get campaign and session parameters from route
  const { campaignName, sessionName } = useParams<{ campaignName: string; sessionName: string }>();

  const [gameState, setGameState] = useState<GameState>({
    tokens: [],
    currentActorId: null
  });

  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [showTokenModal, setShowTokenModal] = useState(true);
  const [showTokenCreator, setShowTokenCreator] = useState(false);
  const [editingToken, setEditingToken] = useState<Token | null>(null);
  const [editingField, setEditingField] = useState<{ field: 'initiative' | 'hp' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [sessionEnded, setSessionEnded] = useState(false);

  // Send heartbeat to keep player active
  useEffect(() => {
    console.log('Heartbeat useEffect triggered, selectedTokenId:', selectedTokenId);
    if (!selectedTokenId || !campaignName || !sessionName) return;

    const sendHeartbeat = async () => {
      try {
        console.log('PlayerView sending heartbeat for:', selectedTokenId);
        const response = await fetch(`${API_URL}/api/player-heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokenId: selectedTokenId })
        });
        console.log('PlayerView heartbeat response:', response.ok);
      } catch (error) {
        console.error('Heartbeat failed:', error);
      }
    };

    const interval = setInterval(sendHeartbeat, 3000);
    sendHeartbeat();

    return () => clearInterval(interval);
  }, [selectedTokenId]);

  // Poll for game state updates
  useEffect(() => {
    const updateGameState = async () => {
      try {
        const url = (campaignName && sessionName)
          ? `${API_URL}/api/game-state?campaign=${encodeURIComponent(campaignName)}&session=${encodeURIComponent(sessionName)}`
          : `${API_URL}/api/game-state`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          const { state, sessionActive } = data;
          if (state) {
            setGameState({
              tokens: state.tokens || [],
              currentActorId: state.currentActorId
            });
            
            // Update session ended state based on sessionActive flag
            if (sessionName) {
              if (sessionActive === false) {
                setSessionEnded(true);
              } else if (sessionActive === true) {
                setSessionEnded(false);
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch game state:', error);
      }
    };

    updateGameState();
    const interval = setInterval(updateGameState, 1000);

    return () => clearInterval(interval);
  }, [campaignName, sessionName]);

  const handleCreateToken = async (actor: Actor, imageFile: File | null, color: string, actorUrl?: string) => {
    let imageUrl = actorUrl || '';
    
    if (imageFile) {
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('folder', 'actors');
      formData.append('name', `player-${Date.now()}`);
      
      try {
        const response = await fetch(`${API_URL}/api/upload`, {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        imageUrl = data.url;
      } catch (error) {
        console.error('Failed to upload image:', error);
      }
    }

    const newToken: Token = {
      id: Date.now().toString(),
      radius: 20,
      color,
      actor,
      imageUrl,
      active: false,
    };

    try {
      const response = await fetch(`${API_URL}/api/player-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: newToken })
      });

      if (response.ok) {
        setSelectedTokenId(newToken.id);
        setShowTokenCreator(false);
        setShowTokenModal(false);
      }
    } catch (error) {
      console.error('Failed to create token:', error);
    }
  };

  const handleUpdateToken = async (tokenId: string, actor: Actor, imageFile: File | null, color: string, actorUrl?: string) => {
    let imageUrl = actorUrl;
    
    if (imageFile) {
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('folder', 'actors');
      formData.append('name', `token-${Date.now()}`);

      try {
        const response = await fetch(`${API_URL}/api/upload`, {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        imageUrl = data.url;
      } catch (error) {
        console.error('Failed to upload image:', error);
      }
    }

    const updatedToken = gameState.tokens.find(t => t.id === tokenId);
    if (!updatedToken) return;

    updatedToken.actor = actor;
    updatedToken.color = color;
    if (imageUrl) updatedToken.imageUrl = imageUrl;

    try {
      await fetch(`${API_URL}/api/player-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: updatedToken })
      });
      
      setShowTokenCreator(false);
      setEditingToken(null);
    } catch (error) {
      console.error('Failed to update token:', error);
    }
  };

  const startEditing = (field: 'initiative' | 'hp', currentValue: number) => {
    setEditingField({ field });
    setEditValue(currentValue.toString());
  };

  const saveEdit = async () => {
    if (!editingField || !selectedTokenId) return;

    const newValue = parseInt(editValue);
    if (isNaN(newValue)) {
      setEditingField(null);
      return;
    }

    const token = gameState.tokens.find(t => t.id === selectedTokenId);
    if (!token || !token.actor) return;

    token.actor[editingField.field] = newValue;

    try {
      await fetch(`${API_URL}/api/player-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      
      setEditingField(null);
    } catch (error) {
      console.error('Failed to update token:', error);
    }
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const playerTokens = gameState.tokens.filter(t => t.actor?.player === true);
  const selectedToken = gameState.tokens.find(t => t.id === selectedTokenId);

  return (
    <>
      <AppHeader title={`Player View - ${campaignName} / ${sessionName}`} />
      {showTokenModal && (
        <div className="token-select-modal">
          <div className="token-select-content">
            <h2>Select Your Character</h2>
            {playerTokens.length > 0 ? (
              <div className="token-list">
                {playerTokens.map(token => (
                  <div
                    key={token.id}
                    className="token-option"
                    onClick={() => {
                      setSelectedTokenId(token.id);
                      setShowTokenModal(false);
                    }}
                  >
                    {token.imageUrl && (
                      <img 
                        src={token.imageUrl.startsWith('http') ? token.imageUrl : `${API_URL}${token.imageUrl}`} 
                        alt={token.actor?.name || 'Token'} 
                      />
                    )}
                    <div>{token.actor?.name || 'Unnamed'}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p>No player characters available</p>
            )}
            <button onClick={() => {
              setShowTokenCreator(true);
              setShowTokenModal(false);
            }}>
              Create New Character
            </button>
          </div>
        </div>
      )}

      {showTokenCreator && (
        <TokenCreator
          onCreateToken={handleCreateToken}
          onUpdateToken={editingToken ? handleUpdateToken : undefined}
          editingToken={editingToken}
          onCancel={() => {
            setShowTokenCreator(false);
            setEditingToken(null);
            if (!selectedTokenId) {
              setShowTokenModal(true);
            }
          }}
          defaultPlayerMode={true}
        />
      )}

      {selectedToken && !showTokenModal && !showTokenCreator && (
        <div className="player-view-container">
          {selectedToken.actor && selectedToken.imageUrl && (
            <TokenHeader 
              token={{
                ...selectedToken,
                name: selectedToken.actor.name,
                initiative: selectedToken.actor.initiative,
                currentHP: selectedToken.actor.hp,
                maxHP: selectedToken.actor.hp,
                armorClass: selectedToken.actor.ac,
                imageUrl: selectedToken.imageUrl.startsWith('http') ? selectedToken.imageUrl : `${API_URL}${selectedToken.imageUrl}`
              }}
              isCurrentTurn={selectedToken.id === gameState.currentActorId}
              onInitiativeClick={() => startEditing('initiative', selectedToken.actor!.initiative)}
              onHPClick={() => startEditing('hp', selectedToken.actor!.hp)}
              onEdit={() => {
                setEditingToken(selectedToken);
                setShowTokenCreator(true);
              }}
            />
          )}

          {selectedToken.actor?.characterSheetUrl && (
            <div className="player-sheet-frame">
              <iframe 
                src={selectedToken.actor.characterSheetUrl}
                title="Character Sheet"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </div>
          )}
        </div>
      )}

      {editingField && selectedToken && (
        <div className="edit-modal">
          <div className="edit-modal-content">
            <h3>Edit {editingField.field === 'initiative' ? 'Initiative' : 'HP'}</h3>
            <input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
              autoFocus
            />
            <div className="edit-modal-buttons">
              <button onClick={saveEdit}>Save</button>
              <button onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {!selectedToken && !showTokenModal && !showTokenCreator && (
        <div className="waiting-message">
          <h2>Waiting for GM to load a map...</h2>
        </div>
      )}

      {sessionEnded && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: '#1a1a1a',
            border: '3px solid #f44336',
            borderRadius: '12px',
            padding: '40px',
            textAlign: 'center',
            maxWidth: '500px'
          }}>
            <h1 style={{ color: '#f44336', marginBottom: '20px', fontSize: '32px' }}>
              ⏹ Session Ended
            </h1>
            <p style={{ color: '#fff', fontSize: '18px', marginBottom: '30px' }}>
              The GM has ended this game session.
            </p>
            <button
              onClick={() => window.close()}
              style={{
                padding: '12px 24px',
                backgroundColor: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Close Window
            </button>
          </div>
        </div>
      )}
    </>
  );
}
