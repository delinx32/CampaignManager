import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './ShareKeySelector.css';

function ShareKeySelector() {
  const navigate = useNavigate();
  const { user, setCurrentShareKey, createShareKey } = useAuth();
  const [showCreatePopup, setShowCreatePopup] = useState(false);
  
  // Calculate default share key from email
  const getDefaultShareKey = () => {
    if (!user?.email) return '';
    const emailUsername = user.email.split('@')[0];
    return emailUsername.toLowerCase().replace(/[^a-z0-9]/g, '');
  };
  
  const [newShareKey, setNewShareKey] = useState(getDefaultShareKey());
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [hasCheckedInitialState, setHasCheckedInitialState] = useState(false);

  useEffect(() => {
    // Only run once on initial load when user data is available
    if (user && !hasCheckedInitialState) {
      setHasCheckedInitialState(true);
      
      // Show create popup only if user has no accessible share keys
      if (!user.accessibleShareKeys || user.accessibleShareKeys.length === 0) {
        setShowCreatePopup(true);
        setNewShareKey(getDefaultShareKey());
      } else {
        setShowCreatePopup(false);
      }
    }
  }, [user, hasCheckedInitialState]);

  const handleCreateShareKey = async () => {
    if (!newShareKey.trim()) {
      setError('Share key cannot be empty');
      return;
    }

    setCreating(true);
    setError('');

    const result = await createShareKey(newShareKey);

    if (result.success) {
      setShowCreatePopup(false);
      setNewShareKey('');
    } else {
      setError(result.error || 'Failed to create share key');
    }

    setCreating(false);
  };

  const handleShareKeyChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const shareKey = event.target.value;
    await setCurrentShareKey(shareKey);
  };

  if (!user) return null;

  // Show creation popup if showCreatePopup is true
  if (showCreatePopup) {
    const hasExistingKeys = user.accessibleShareKeys && user.accessibleShareKeys.length > 0;
    
    return (
      <div className="share-key-popup-overlay">
        <div className="share-key-popup">
          <h2>Create Share Key</h2>
          <p>You need a share key to manage campaigns. This key will be used in URLs for sharing with players.</p>
          
          <div className="share-key-input-group">
            <label>Share Key:</label>
            <input
              type="text"
              value={newShareKey}
              onChange={(e) => setNewShareKey(e.target.value)}
              placeholder="e.g., mygroup, dndparty"
              disabled={creating}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateShareKey()}
            />
            <small>Only letters and numbers allowed. Will be converted to lowercase.</small>
          </div>

          {error && <div className="share-key-error">{error}</div>}

          <div className="share-key-buttons">
            <button 
              onClick={handleCreateShareKey} 
              disabled={creating}
              className="create-share-key-button"
            >
              {creating ? 'Creating...' : 'Create Share Key'}
            </button>
            {hasExistingKeys && (
              <button 
                onClick={() => setShowCreatePopup(false)} 
                disabled={creating}
                className="cancel-share-key-button"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // If user has multiple share keys, show dropdown
  if (user.accessibleShareKeys && user.accessibleShareKeys.length > 1) {
    return (
      <div className="share-key-selector">
        <label>Share Key:</label>
        <select 
          value={user.currentShareKey || ''} 
          onChange={handleShareKeyChange}
          className="share-key-dropdown"
        >
          {user.accessibleShareKeys.map((sk) => (
            <option key={sk.shareKey} value={sk.shareKey}>
              {sk.shareKey} {sk.isOwner ? '(Owner)' : '(GM)'}
            </option>
          ))}
        </select>
        <button 
          onClick={() => user.currentShareKey && navigate(`/${user.currentShareKey}`)}
          className="share-key-link-button"
          title="Go to share key landing page"
        >
          🔗
        </button>
        <button 
          onClick={() => setShowCreatePopup(true)}
          className="add-share-key-button"
          title="Create new share key"
        >
          +
        </button>
      </div>
    );
  }

  // If user has exactly one share key, show it as text
  return (
    <div className="share-key-selector">
      <label>Share Key:</label>
      <span className="current-share-key">{user.currentShareKey}</span>
      <button 
        onClick={() => user.currentShareKey && navigate(`/${user.currentShareKey}`)}
        className="share-key-link-button"
        title="Go to share key landing page"
      >
        🔗
      </button>
      <button 
        onClick={() => setShowCreatePopup(true)}
        className="add-share-key-button"
        title="Create new share key"
      >
        +
      </button>
    </div>
  );
}

export default ShareKeySelector;
