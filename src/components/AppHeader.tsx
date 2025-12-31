import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';
import ShareKeySelector from './ShareKeySelector';
import './AppHeader.css';

interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  campaignImage?: string;
  campaignName?: string;
  scenarioName?: string;
  showCampaignLink?: boolean;
}

export default function AppHeader({ title = 'Campaign Manager', subtitle, campaignImage, campaignName, scenarioName, showCampaignLink = false }: AppHeaderProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <div className="app-header-component">
      <div className="app-header-content">
        <div className="app-header-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {campaignImage && (
              <img 
                src={campaignImage.startsWith('http') ? campaignImage : `${API_URL}${campaignImage}`}
                alt="Campaign"
                className="campaign-header-image"
                onClick={() => navigate('/')}
                style={{ cursor: 'pointer' }}
                title="Go to campaigns"
              />
            )}
            <div>
              <h1>{title}</h1>
              {subtitle && (
                <p className="subtitle">
                  {campaignName && scenarioName ? (
                    <>
                      <span 
                        onClick={() => navigate('/')}
                        style={{ cursor: 'pointer', textDecoration: 'underline' }}
                        title="Go to campaigns"
                      >
                        {campaignName}
                      </span>
                      {' / '}
                      <span 
                        onClick={() => navigate(`/campaign/${encodeURIComponent(campaignName)}`)}
                        style={{ cursor: 'pointer', textDecoration: 'underline' }}
                        title="Go to scenarios"
                      >
                        {scenarioName}
                      </span>
                    </>
                  ) : (
                    subtitle
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
        {user && (
          <div className="app-header-right">
            <div className="user-name">{user.name}</div>
            <ShareKeySelector />
            <div className="header-buttons">
              {showCampaignLink && user.role === 'gm' && (
                <button onClick={() => navigate('/')} className="header-button">
                  Campaign Management
                </button>
              )}
              <button onClick={() => navigate('/')} className="header-button">
                Campaigns
              </button>
              <button onClick={() => navigate('/image-gallery')} className="header-button">
                Image Gallery
              </button>
              {user.role === 'owner' && (
                <button onClick={() => navigate('/settings')} className="header-button">
                  Settings
                </button>
              )}
              <button onClick={logout} className="header-button">
                Logout
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
