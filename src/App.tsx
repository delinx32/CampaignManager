import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth, AuthProvider } from './contexts/AuthContext'
import GMView from './components/GMView'
import ObserverViewPage from './components/ObserverViewPage'
import PlayerView from './components/PlayerView'
import CampaignSelection from './components/CampaignSelection'
import ScenarioSelection from './components/ScenarioSelection'
import Settings from './components/Settings'
import Login from './components/Login'
import ImageGalleryManager from './components/ImageGalleryManager'
import ShareKeyLanding from './components/ShareKeyLanding'
import { API_URL } from './config'
import './App.css'

// Protected route component for GM access
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Owner-only route - check if user owns the current share key
function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Loading...</div>;
  }

  // Check if user owns the current share key
  const isOwnerOfCurrentShareKey = user?.currentShareKey && user?.accessibleShareKeys?.some(
    sk => sk.shareKey === user.currentShareKey && sk.isOwner
  );

  if (!isOwnerOfCurrentShareKey) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// Player-only route - check if user is a valid player for the campaign
interface PlayerRouteProps {
  children: React.ReactNode;
  shareKey?: string;
}

function PlayerRoute({ children, shareKey }: PlayerRouteProps) {
  const { user, loading } = useAuth();
  const [playerVerified, setPlayerVerified] = useState<boolean | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    const verifyPlayer = async () => {
      if (!user) {
        setPlayerVerified(false);
        setVerifyError('Not authenticated');
        return;
      }

      if (!shareKey) {
        setPlayerVerified(false);
        setVerifyError('Missing share key information');
        return;
      }

      try {
        const response = await fetch(`${API_URL}/api/verify-player/${encodeURIComponent(shareKey)}`, {
          credentials: 'include'
        });
        const data = await response.json();
        
        if (data.isValidPlayer) {
          setPlayerVerified(true);
        } else {
          setPlayerVerified(false);
          setVerifyError('You are not authorized to access this player view');
        }
      } catch (err) {
        setPlayerVerified(false);
        setVerifyError('Error verifying player access');
      }
    };

    if (!loading) {
      verifyPlayer();
    }
  }, [user, loading, shareKey]);

  if (loading || playerVerified === null) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Loading...</div>;
  }

  if (!user) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '1rem' }}>
      <p>Authentication required. Please access this page through a share key link.</p>
    </div>;
  }

  if (!playerVerified) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '1rem' }}>
      <p>{verifyError || 'You are not authorized to access this player view'}</p>
    </div>;
  }

  return <>{children}</>;
}

function AppRoutes() {
  // Component wrapper for player view that extracts shareKey from params
  const PlayerViewWithAuth = () => {
    const { campaignName } = useParams<{ campaignName: string }>();
    return (
      <PlayerRoute shareKey={campaignName}>
        <PlayerView />
      </PlayerRoute>
    );
  };

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      {/* GM routes - require authentication */}
      <Route path="/" element={<ProtectedRoute><CampaignSelection /></ProtectedRoute>} />
      <Route path="/settings" element={<OwnerRoute><Settings /></OwnerRoute>} />
      <Route path="/image-gallery" element={<ProtectedRoute><ImageGalleryManager /></ProtectedRoute>} />
      <Route path="/campaign/:campaignName" element={<ProtectedRoute><ScenarioSelection /></ProtectedRoute>} />
      <Route path="/campaign/:campaignName/:scenarioName/gm" element={<ProtectedRoute><GMView /></ProtectedRoute>} />
      
      {/* Observer view - public, no authentication required */}
      <Route path="/:campaignName/:sessionName/observer" element={<ObserverViewPage />} />
      
      {/* Player view - requires authentication and player verification */}
      <Route path="/:campaignName/:sessionName/player" element={<PlayerViewWithAuth />} />
      
      {/* Share key landing page - must be last to avoid conflicts */}
      <Route path="/:shareKey" element={<ShareKeyLanding />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
