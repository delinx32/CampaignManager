import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ObserverView from './ObserverView';
import TokenCard from './TokenCard';
import { API_URL } from '../config';
import type { Token, Prop, RevealZone } from '../types';

interface GameState {
  backgroundImage: string | null;
  tokens: Token[];
  props: Prop[];
  transform: { x: number; y: number; scale: number; rotation: number };
  fogEnabled: 'on' | 'off-all' | 'off-gm';
  fogRevealDistance: number;
  playerFogOpacity: number;
  lightingCondition: 'bright' | 'dim' | 'darkness';
  revealedPath: Array<{ x: number; y: number }>;
  gridColumns: number;
  gridRows: number;
  showGrid: boolean;
  imageDimensions?: { width: number; height: number } | null;
  currentActorId?: string | null;
  showObserverCards?: boolean;
  revealZones?: RevealZone[];
  permanentlyRevealedZones?: string[];
}

export default function ObserverViewPage() {
  const { campaignName, sessionName } = useParams<{ campaignName: string; sessionName: string }>();
  const { user } = useAuth();
  
  const [gameState, setGameState] = useState<GameState>({
    backgroundImage: null,
    tokens: [],
    props: [],
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    fogEnabled: 'off-gm',
    fogRevealDistance: 3,
    playerFogOpacity: 1,
    lightingCondition: 'bright',
    revealedPath: [],
    gridColumns: 100,
    gridRows: 100,
    showGrid: true,
    currentActorId: null,
    showObserverCards: true
  });
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(() => {
    if (!campaignName || !sessionName) return;

    // Poll for game state updates from backend
    const updateGameState = async () => {
      try {
        const url = (campaignName && sessionName)
          ? `${API_URL}/api/game-state?campaign=${encodeURIComponent(campaignName)}&session=${encodeURIComponent(sessionName)}`
          : `${API_URL}/api/game-state`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          const { state, sessionActive } = data;
          console.log('ObserverViewPage: Received state with', state?.tokens?.length || 0, 'tokens and', state?.props?.length || 0, 'props');
          console.log('ObserverViewPage: showObserverCards =', state?.showObserverCards);
          if (state) {
            // Prepend API_URL to backgroundImage if it's a relative path
            if (state.backgroundImage && !state.backgroundImage.startsWith('http')) {
              state.backgroundImage = `${API_URL}${state.backgroundImage}`;
            }
            setGameState(state);
            
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

    // Initial load
    updateGameState();

    // Poll every second for updates
    const interval = setInterval(updateGameState, 1000);

    return () => clearInterval(interval);
  }, [campaignName, sessionName]);

  const activeTokens = gameState.tokens
    .filter(t => t.active)
    .sort((a, b) => (b.actor?.initiative || 0) - (a.actor?.initiative || 0));

  const toggleShowCards = async () => {
    const newValue = !gameState.showObserverCards;
    
    // Update local state immediately for responsiveness
    setGameState(prev => ({ ...prev, showObserverCards: newValue }));
    
    // Persist to backend
    try {
      await fetch(`${API_URL}/api/game-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          state: { 
            ...gameState, 
            showObserverCards: newValue 
          } 
        })
      });
    } catch (error) {
      console.error('Failed to update showObserverCards:', error);
    }
  };

  return (
    <>
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
      
      
      {/* Top cards - toggleable */}
      {activeTokens.length > 0 && gameState.currentActorId && gameState.showObserverCards && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          backgroundColor: '#1a1a1a',
          borderBottom: '2px solid #333',
          padding: '12px',
          paddingRight: '60px',
          zIndex: 100,
          overflow: 'hidden',
          display: 'flex',
          flexWrap: 'nowrap',
          gap: '12px',
          transform: 'rotate(180deg)'
        }}>
          <button
            onClick={toggleShowCards}
            style={{
              position: 'absolute',
              right: '12px',
              top: '12px',
              padding: '8px 16px',
              backgroundColor: '#333',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
              zIndex: 101
            }}
          >
            ▼ Hide
          </button>
          {activeTokens.map(token => (
            <div key={`top-${token.id}`} style={{ minWidth: '280px' }}>
              <TokenCard
                token={token}
                currentActorId={gameState.currentActorId}
                isGMView={false}
              />
            </div>
          ))}
        </div>
      )}
      
      {/* Bottom cards - always visible during encounter */}
      {activeTokens.length > 0 && gameState.currentActorId && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#1a1a1a',
          borderTop: '2px solid #333',
          padding: '12px',
          zIndex: 100,
          overflow: 'hidden',
          display: 'flex',
          flexWrap: 'nowrap',
          gap: '12px'
        }}>
          {activeTokens.map(token => (
            <div key={`bottom-${token.id}`} style={{ minWidth: '280px' }}>
              <TokenCard
                token={token}
                currentActorId={gameState.currentActorId}
                isGMView={false}
              />
            </div>
          ))}
        </div>
      )}
      
      {/* Show button when cards are hidden */}
      {activeTokens.length > 0 && gameState.currentActorId && !gameState.showObserverCards && (
        <button
          onClick={toggleShowCards}
          style={{
            position: 'fixed',
            top: '12px',
            right: '12px',
            padding: '8px 16px',
            backgroundColor: '#333',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            zIndex: 101,
            transform: 'rotate(180deg)'
          }}
        >
          ▶ Show
        </button>
      )}
      
      <div style={{ 
        marginTop: activeTokens.length > 0 && gameState.currentActorId && gameState.showObserverCards ? '120px' : '0',
        marginBottom: activeTokens.length > 0 && gameState.currentActorId ? '120px' : '0'
      }}>
        <ObserverView
          backgroundImage={gameState.backgroundImage}
          tokens={gameState.tokens}
          props={gameState.props}
          transform={gameState.transform}
          fogEnabled={gameState.fogEnabled}
          fogRevealDistance={gameState.fogRevealDistance}
          playerFogOpacity={gameState.playerFogOpacity}
          lightingCondition={gameState.lightingCondition}
          revealedPath={gameState.revealedPath}
          gridColumns={gameState.gridColumns}
          gridRows={gameState.gridRows}
          showGrid={gameState.showGrid}
          currentActorId={gameState.currentActorId}
          revealZones={gameState.revealZones || []}
          permanentlyRevealedZones={new Set(gameState.permanentlyRevealedZones || [])}
          userRole={user?.role as 'gm' | 'player' | undefined}
          campaignName={campaignName}
          sessionName={sessionName}
        />
      </div>
    </>
  );
}