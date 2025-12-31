import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ImageUploader from './ImageUploader'
import MapCanvas from './MapCanvas'
import AppHeader from './AppHeader'
import { API_URL } from '../config'
import '../App.css'

interface MapFile {
  filename: string;
  url: string;
}

export default function GMView() {
  const { campaignName, scenarioName } = useParams<{ campaignName: string; scenarioName: string }>();
  const navigate = useNavigate();
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null)
  const [campaignBackgroundImage, setCampaignBackgroundImage] = useState<string | undefined>(undefined);
  const [availableMaps, setAvailableMaps] = useState<MapFile[]>([])
  const [isCheckingExistingMap, setIsCheckingExistingMap] = useState(true);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [currentSessionName, setCurrentSessionName] = useState<string | null>(null);
  const [availableSessions, setAvailableSessions] = useState<string[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>('new');
  const [isTogglingSession, setIsTogglingSession] = useState(false);

  // Load available sessions on mount
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const [sessionsResponse, metadataResponse] = await Promise.all([
          fetch(`${API_URL}/api/sessions`, { credentials: 'include' }),
          fetch(`${API_URL}/api/scenario-metadata`, { credentials: 'include' })
        ]);
        
        if (sessionsResponse.ok) {
          const data = await sessionsResponse.json();
          setAvailableSessions(data.sessions || []);
          
          // Set last played session as default
          if (metadataResponse.ok) {
            const metadata = await metadataResponse.json();
            if (metadata.lastSessionPlayed && data.sessions.includes(metadata.lastSessionPlayed)) {
              setSelectedSession(metadata.lastSessionPlayed);
            }
          }
        }
      } catch (error) {
        console.error('Failed to load sessions:', error);
      }
    };
    loadSessions();
  }, []);

  // Load campaign background image
  useEffect(() => {
    const loadCampaignImage = async () => {
      if (!campaignName) return;
      try {
        const response = await fetch(`${API_URL}/api/campaigns/${encodeURIComponent(campaignName)}/scenarios`, {
          credentials: 'include'
        });
        const data = await response.json();
        setCampaignBackgroundImage(data.campaignBackgroundImage);
      } catch (error) {
        console.error('Failed to load campaign image:', error);
      }
    };
    loadCampaignImage();
  }, [campaignName]);

  // Check session status on mount
  useEffect(() => {
    const checkSessionStatus = async () => {
      try {
        const response = await fetch(`${API_URL}/api/session/status`, {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setIsSessionActive(data.isSessionActive);
          setCurrentSessionName(data.sessionName);
        }
      } catch (error) {
        console.error('Failed to check session status:', error);
      }
    };
    checkSessionStatus();
  }, []);

  const handleStartSession = async () => {
    let sessionName: string | null = selectedSession;
    
    // If "new" is selected, prompt for session name
    if (selectedSession === 'new') {
      sessionName = prompt('Enter a name for the new session:');
      if (!sessionName || sessionName.trim() === '') {
        return; // User cancelled or entered empty name
      }
      sessionName = sessionName.trim();
    }
    
    setIsTogglingSession(true);
    try {
      const response = await fetch(`${API_URL}/api/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionName })
      });
      
      if (response.ok) {
        const data = await response.json();
        setIsSessionActive(data.isSessionActive);
        setCurrentSessionName(data.sessionName);
        // Refresh sessions list to include the new session
        const sessionsResponse = await fetch(`${API_URL}/api/sessions`, { credentials: 'include' });
        if (sessionsResponse.ok) {
          const sessionsData = await sessionsResponse.json();
          setAvailableSessions(sessionsData.sessions || []);
        }
      } else {
        const error = await response.json();
        alert(`Failed to start session: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to start session:', error);
      alert('Failed to start session');
    } finally {
      setIsTogglingSession(false);
    }
  };

  const handleEndSession = async () => {
    if (!confirm(`End session "${currentSessionName}"? The session will be saved and you can resume it later.`)) {
      return;
    }
    
    setIsTogglingSession(true);
    try {
      const response = await fetch(`${API_URL}/api/session/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setIsSessionActive(data.isSessionActive);
        setCurrentSessionName(null);
      } else {
        const error = await response.json();
        alert(`Failed to end session: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to end session:', error);
      alert('Failed to end session');
    } finally {
      setIsTogglingSession(false);
    }
  };

  // Set backend context when component mounts
  useEffect(() => {
    const setContext = async () => {
      if (!campaignName || !scenarioName) return;
      
      try {
        const response = await fetch(`${API_URL}/api/set-context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ 
            campaign: campaignName, 
            scenario: scenarioName 
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('Failed to set context:', errorData.error);
        }
      } catch (err) {
        console.error('Failed to set context:', err);
      }
    };
    setContext();
  }, [campaignName, scenarioName]);

  // Check for existing game state on mount
  useEffect(() => {
    const checkExistingMap = async () => {
      if (!campaignName || !scenarioName) return;
      
      try {
        const response = await fetch(`${API_URL}/api/scenario-maps`, {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          
          if (data.hasExistingMap && data.backgroundImage) {
            // Auto-load the existing map
            console.log('Found existing map, auto-loading:', data.backgroundImage);
            setBackgroundImage(`${API_URL}${data.backgroundImage}`);
          }
        }
      } catch (error) {
        console.error('Failed to check existing maps:', error);
      } finally {
        setIsCheckingExistingMap(false);
      }
    };

    // Wait a bit for context to be set
    const timer = setTimeout(checkExistingMap, 100);
    return () => clearTimeout(timer);
  }, [campaignName, scenarioName]);

  const fetchAvailableMaps = async () => {
    try {
      const response = await fetch(`${API_URL}/api/maps`, {
        credentials: 'include'
      });
      const data = await response.json();
      setAvailableMaps(data.maps);
    } catch (error) {
      console.error('Failed to fetch maps:', error);
    }
  };

  // Fetch available maps on component mount
  useEffect(() => {
    fetchAvailableMaps();
  }, []);

  const handleImageUpload = (imageUrl: string, filename: string) => {
    console.log('GMView received image URL:', imageUrl);
    console.log('Filename:', filename);
    // Prepend API_URL since images are now served from backend
    setBackgroundImage(`${API_URL}${imageUrl}`);
    // Refresh the list of available maps
    fetchAvailableMaps();
  };

  const handleSelectExistingMap = (mapUrl: string) => {
    setBackgroundImage(`${API_URL}${mapUrl}`);
  };

  return (
    <div className="app">
      <AppHeader 
        title={`${campaignName} (GM)`}
        campaignImage={campaignBackgroundImage}
        subtitle={scenarioName}
        campaignName={campaignName}
        scenarioName={scenarioName}
      />
      <header className="gm-controls">
        <div style={{ marginTop: '10px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {isSessionActive ? (
            <>
              <div style={{ 
                padding: '8px 16px',
                backgroundColor: 'rgba(244, 67, 54, 0.1)',
                color: '#f44336',
                border: '2px solid #f44336',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: 'bold'
              }}>
                🎮 Session: {currentSessionName}
              </div>
              <button
                onClick={handleEndSession}
                disabled={isTogglingSession}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: isTogglingSession ? 'not-allowed' : 'pointer',
                  opacity: isTogglingSession ? 0.6 : 1
                }}
              >
                {isTogglingSession ? 'Ending Session...' : '⏹ End Game Session'}
              </button>
            </>
          ) : (
            <>
              <select
                value={selectedSession}
                onChange={(e) => setSelectedSession(e.target.value)}
                disabled={isTogglingSession}
                style={{
                  padding: '10px',
                  fontSize: '16px',
                  borderRadius: '4px',
                  border: '2px solid #4CAF50',
                  backgroundColor: '#1a1a1a',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                <option value="new">New Session...</option>
                {availableSessions.map(session => (
                  <option key={session} value={session}>{session}</option>
                ))}
              </select>
              <button
                onClick={handleStartSession}
                disabled={isTogglingSession}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: isTogglingSession ? 'not-allowed' : 'pointer',
                  opacity: isTogglingSession ? 0.6 : 1
                }}
              >
                {isTogglingSession ? 'Starting...' : '▶ Start Session'}
              </button>
              <div style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                color: '#4CAF50',
                border: '1px solid rgba(76, 175, 80, 0.3)',
                borderRadius: '4px',
                fontSize: '14px'
              }}>
                📝 Edit Mode
              </div>
            </>
          )}
          
          {isSessionActive && (
            <>
              <a 
                href={`/${encodeURIComponent(campaignName || '')}/${encodeURIComponent(currentSessionName || '')}/observer`}
                target="_blank" 
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '8px 16px',
                  backgroundColor: '#2196F3',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              >
                👁️ Observer View
              </a>
              <a 
                href={`/${encodeURIComponent(campaignName || '')}/${encodeURIComponent(currentSessionName || '')}/player`}
                target="_blank" 
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '8px 16px',
                  backgroundColor: '#FF9800',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              >
                🎲 Player View
              </a>
            </>
          )}
        </div>
      </header>
      
      <main 
        className="app-main"
        onDrop={(e) => {
          e.preventDefault();
          console.log('Drop event triggered');
          const mapUrl = e.dataTransfer.getData('mapUrl');
          console.log('Map URL from drag:', mapUrl);
          if (mapUrl) {
            setBackgroundImage(mapUrl);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
      >
        {isCheckingExistingMap ? (
          <div className="loading-state" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#fff'
          }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Loading scenario...</div>
          </div>
        ) : !backgroundImage ? (
          <>
            <ImageUploader onImageUpload={handleImageUpload} />
            {availableMaps.length > 0 && (
              <div className="existing-maps">
                <h3>Or click/drag a previously uploaded map:</h3>
                <div className="map-grid">
                  {availableMaps.map((map) => (
                    <div 
                      key={map.filename} 
                      className="map-thumbnail"
                      draggable
                      onClick={() => handleSelectExistingMap(map.url)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('mapUrl', `${API_URL}${map.url}`);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                    >
                      <img 
                        src={`${API_URL}${map.url}`} 
                        alt={map.filename}
                        draggable={false}
                      />
                      <span className="map-filename">{map.filename}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <MapCanvas backgroundImage={backgroundImage} campaign={campaignName || ''} session={currentSessionName || ''} />
        )}
      </main>
      {backgroundImage && (
        <button className="reset-map" onClick={() => setBackgroundImage(null)}>
          Upload New Map
        </button>
      )}
    </div>
  )
}
