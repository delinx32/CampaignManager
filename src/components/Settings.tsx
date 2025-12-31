import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';
import AppHeader from './AppHeader';
import './Settings.css';

function Settings() {
  const { user, checkAuth } = useAuth();
  const [shareKey, setShareKey] = useState('');
  
  const [openaiKey, setOpenaiKey] = useState('');
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  
  const [gms, setGms] = useState<string[]>([]);
  const [newGmEmail, setNewGmEmail] = useState('');
  
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      
      // Load current share key from user object
      if (user?.currentShareKey) {
        setShareKey(user.currentShareKey);
      }
      
      // Load OpenAI key status
      const openaiResponse = await fetch(`${API_URL}/api/user/openai-key`, {
        credentials: 'include'
      });
      
      if (openaiResponse.ok) {
        const data = await openaiResponse.json();
        setHasOpenaiKey(data.hasKey);
        setOpenaiKey(data.maskedKey || '');
      }
      
      // Load GM list
      const gmsResponse = await fetch(`${API_URL}/api/user/gms`, {
        credentials: 'include'
      });
      
      if (gmsResponse.ok) {
        const data = await gmsResponse.json();
        setGms(data.gms || []);
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveShareKey = async () => {
    if (!shareKey.trim()) {
      setMessage({ type: 'error', text: 'Share key cannot be empty' });
      setTimeout(() => setMessage(null), 5000);
      return;
    }

    if (!user?.currentShareKey) {
      setMessage({ type: 'error', text: 'No current share key' });
      setTimeout(() => setMessage(null), 5000);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/share-keys/${encodeURIComponent(user.currentShareKey)}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newKey: shareKey })
      });

      const data = await response.json();

      if (response.ok) {
        setShareKey(data.newKey);
        setMessage({ type: 'success', text: 'Share key updated successfully!' });
        // Refresh auth to update user object
        await checkAuth();
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update share key' });
        setTimeout(() => setMessage(null), 5000);
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to update share key' });
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const handleSaveOpenaiKey = async () => {
    if (!openaiKey.trim()) {
      setMessage({ type: 'error', text: 'OpenAI API key cannot be empty' });
      setTimeout(() => setMessage(null), 5000);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/user/openai-key`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ openaiApiKey: openaiKey })
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'OpenAI API key updated successfully!' });
        await loadSettings(); // Reload to get masked key
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update OpenAI API key' });
        setTimeout(() => setMessage(null), 5000);
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to update OpenAI API key' });
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const handleAddGM = async () => {
    if (!newGmEmail.trim()) {
      setMessage({ type: 'error', text: 'Email cannot be empty' });
      setTimeout(() => setMessage(null), 5000);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/user/gms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: newGmEmail })
      });

      const data = await response.json();

      if (response.ok) {
        setGms(data.gms);
        setNewGmEmail('');
        setMessage({ type: 'success', text: 'GM added successfully!' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to add GM' });
        setTimeout(() => setMessage(null), 5000);
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to add GM' });
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const handleRemoveGM = async (email: string) => {
    try {
      const response = await fetch(`${API_URL}/api/user/gms`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (response.ok) {
        setGms(data.gms);
        setMessage({ type: 'success', text: 'GM removed successfully!' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to remove GM' });
        setTimeout(() => setMessage(null), 5000);
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to remove GM' });
      setTimeout(() => setMessage(null), 5000);
    }
  };

  if (loading) {
    return <div className="settings-loading">Loading settings...</div>;
  }

  return (
    <div className="settings-container">
      <AppHeader 
        title="Settings" 
        subtitle="Manage your account and preferences" 
      />
      <div className="settings-content">

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="message-close">✕</button>
        </div>
      )}

      <div className="settings-content">
        <div className="settings-section">
          <h2>Share Key</h2>
          <p className="settings-description">
            Your share key is used in URLs for observer and player views. Players use links like:
            <br />
            <code>localhost:5173/{shareKey}/session-name/player</code>
          </p>
          
          <div className="edit-field">
            <label>Share Key:</label>
            <input
              type="text"
              value={shareKey}
              onChange={(e) => setShareKey(e.target.value)}
              placeholder="Enter share key (alphanumeric only)"
            />
            <div className="edit-actions">
              <button onClick={handleSaveShareKey} className="save-button">Save Changes</button>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h2>OpenAI API Key</h2>
          <p className="settings-description">
            Your OpenAI API key is used for AI image generation features. Get your API key from the{' '}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
              OpenAI dashboard
            </a>.
          </p>
          
          <div className="edit-field">
            <label>OpenAI API Key:</label>
            <input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder={hasOpenaiKey ? "Enter new key to update..." : "sk-proj-..."}
            />
            <div className="edit-actions">
              <button onClick={handleSaveOpenaiKey} className="save-button">Save Changes</button>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h2>Campaign GMs</h2>
          <p className="settings-description">
            Add other users who can manage your campaigns. They will have full GM access to your campaign data.
          </p>
          
          <div className="edit-field">
            <label>Add GM by Email:</label>
            <div className="gm-input-row">
              <input
                type="email"
                value={newGmEmail}
                onChange={(e) => setNewGmEmail(e.target.value)}
                placeholder="email@example.com"
                onKeyDown={(e) => e.key === 'Enter' && handleAddGM()}
              />
              <button onClick={handleAddGM} className="save-button">Add GM</button>
            </div>
          </div>

          {gms.length > 0 && (
            <div className="gm-list">
              <label>Current GMs:</label>
              {gms.map((email) => (
                <div key={email} className="gm-item">
                  <span>{email}</span>
                  <button onClick={() => handleRemoveGM(email)} className="remove-gm-button">Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

export default Settings;
