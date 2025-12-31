import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import AppHeader from './AppHeader';
import './ShareKeyLanding.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface Session {
  sessionName: string;
  currentScenario: string;
  lastPlayed: string;
}

interface Campaign {
  campaignName: string;
  sessions: Session[];
}

function ShareKeyLanding() {
  const { shareKey } = useParams<{ shareKey: string }>();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSessions = async () => {
      if (!shareKey) {
        setError('No share key provided');
        setLoading(false);
        return;
      }

      try {
        // Load active sessions for this share key
        const sessionsResponse = await fetch(`${API_URL}/api/sharekey/${shareKey}/sessions`);

        if (!sessionsResponse.ok) {
          throw new Error('Failed to load sessions');
        }

        const data = await sessionsResponse.json();
        setCampaigns(data.campaigns || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    loadSessions();
  }, [shareKey]);

  if (loading) {
    return (
      <>
        <AppHeader title="Share Key Landing" showCampaignLink={true} />
        <div className="sharekey-landing">
          <div className="loading">Loading...</div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <AppHeader title="Share Key Landing" showCampaignLink={true} />
        <div className="sharekey-landing">
          <div className="error">
            <h2>Error</h2>
            <p>{error}</p>
          </div>
        </div>
      </>
    );
  }

  if (campaigns.length === 0) {
    return (
      <>
        <AppHeader title="Share Key Landing" showCampaignLink={true} />
        <div className="sharekey-landing">
          <div className="no-sessions">
            <h2>No Active Sessions</h2>
            <p>The GM hasn't started any sessions yet. Check back later!</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader title="Share Key Landing" showCampaignLink={true} />
      <div className="sharekey-landing">
      <header className="sharekey-header">
        <h1>Active Game Sessions</h1>
        <p className="share-key-display">Share Key: {shareKey}</p>
      </header>

      <div className="sharekey-campaigns-grid">
        {campaigns.map((campaign) => (
          <div key={campaign.campaignName} className="sharekey-campaign-card">
            <h2 className="campaign-name">{campaign.campaignName}</h2>
            
            <div className="sessions-list">
              {campaign.sessions.map((session) => (
                <div key={session.sessionName} className="session-item">
                  <div className="session-info">
                    <h3>{session.sessionName}</h3>
                    <p className="scenario-name">Scenario: {session.currentScenario}</p>
                    <p className="last-played">
                      Last played: {new Date(session.lastPlayed).toLocaleString()}
                    </p>
                  </div>
                  
                  <div className="session-links">
                    <Link
                      to={`/${campaign.campaignName}/${session.sessionName}/observer`}
                      className="view-link observer-link"
                    >
                      Observer View
                    </Link>
                    <Link
                      to={`/${campaign.campaignName}/${session.sessionName}/player`}
                      className="view-link player-link"
                    >
                      Player View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
    </>
  );
}

export default ShareKeyLanding;
