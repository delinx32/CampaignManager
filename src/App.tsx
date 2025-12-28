import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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

// Protected route for observer/player views (requires any authentication, including guest)
function ViewerRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '1rem' }}>
      <p>Authentication required. Please access this page through a share key link.</p>
    </div>;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      {/* GM routes - require authentication */}
      <Route path="/" element={<ProtectedRoute><CampaignSelection /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/image-gallery" element={<ProtectedRoute><ImageGalleryManager /></ProtectedRoute>} />
      <Route path="/campaign/:campaignName" element={<ProtectedRoute><ScenarioSelection /></ProtectedRoute>} />
      <Route path="/campaign/:campaignName/:scenarioName/gm" element={<ProtectedRoute><GMView /></ProtectedRoute>} />
      
      {/* Observer view - public, no authentication required */}
      <Route path="/:campaignName/:sessionName/observer" element={<ObserverViewPage />} />
      
      {/* Player view - requires authentication */}
      <Route path="/:campaignName/:sessionName/player" element={<ViewerRoute><PlayerView /></ViewerRoute>} />
      
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
