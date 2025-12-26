import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config';
import './CampaignSelection.css';

interface Campaign {
  name: string;
  scenarioCount: number;
  description?: string;
}

interface ArchivedCampaign {
  folderName: string;
  originalName: string;
  archivedAt: string;
}

function CampaignSelection() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [archivedCampaigns, setArchivedCampaigns] = useState<ArchivedCampaign[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaignToDelete, setCampaignToDelete] = useState<string | null>(null);
  const [archivedToDelete, setArchivedToDelete] = useState<string | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [renamingCampaign, setRenamingCampaign] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    loadCampaigns();
    loadArchivedCampaigns();
  }, []);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/campaigns`);
      const data = await response.json();
      console.log('Campaigns data:', data);
      setCampaigns(data.campaigns || []);
      setError(null);
    } catch (err) {
      setError('Failed to load campaigns');
      console.error('Error loading campaigns:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadArchivedCampaigns = async () => {
    try {
      const response = await fetch(`${API_URL}/api/archived-campaigns`);
      const data = await response.json();
      setArchivedCampaigns(data.archived || []);
    } catch (err) {
      console.error('Error loading archived campaigns:', err);
    }
  };

  const handleRestore = async (folderName: string) => {
    try {
      const response = await fetch(`${API_URL}/api/archived-campaigns/${encodeURIComponent(folderName)}/restore`, {
        method: 'POST'
      });
      
      if (response.ok) {
        loadCampaigns();
        loadArchivedCampaigns();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to restore campaign');
      }
    } catch (err) {
      setError('Failed to restore campaign');
      console.error('Error restoring campaign:', err);
    }
  };

  const handlePermanentDelete = (folderName: string) => {
    setArchivedToDelete(folderName);
  };

  const confirmPermanentDelete = async () => {
    if (!archivedToDelete) return;
    
    try {
      const response = await fetch(`${API_URL}/api/archived-campaigns/${encodeURIComponent(archivedToDelete)}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        setArchivedToDelete(null);
        loadArchivedCampaigns();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to delete campaign');
        setArchivedToDelete(null);
      }
    } catch (err) {
      setError('Failed to delete campaign');
      console.error('Error deleting campaign:', err);
      setArchivedToDelete(null);
    }
  };

  const handleEdit = (campaign: Campaign, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCampaign(campaign.name);
    setEditName(campaign.name);
    setEditDescription(campaign.description || '');
  };

  const handleSaveEdit = async (originalName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    try {
      const response = await fetch(`${API_URL}/api/campaigns/${encodeURIComponent(originalName)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          description: editDescription.trim()
        })
      });
      
      if (response.ok) {
        setEditingCampaign(null);
        loadCampaigns();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to update campaign');
      }
    } catch (err) {
      setError('Failed to update campaign');
      console.error('Error updating campaign:', err);
    }
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCampaign(null);
    setEditName('');
    setEditDescription('');
  };

  const handleRename = (campaignName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingCampaign(campaignName);
    setNewName(campaignName);
  };

  const confirmRename = async () => {
    if (!renamingCampaign || !newName.trim()) return;
    
    if (newName.trim() === renamingCampaign) {
      setRenamingCampaign(null);
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/api/campaigns/${encodeURIComponent(renamingCampaign)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      });
      
      if (response.ok) {
        setRenamingCampaign(null);
        setNewName('');
        loadCampaigns();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to rename campaign');
        setRenamingCampaign(null);
      }
    } catch (err) {
      setError('Failed to rename campaign');
      console.error('Error renaming campaign:', err);
      setRenamingCampaign(null);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newCampaignName.trim()) {
      setError('Campaign name cannot be empty');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCampaignName.trim() })
      });

      if (response.ok) {
        setNewCampaignName('');
        setShowCreateForm(false);
        loadCampaigns();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to create campaign');
      }
    } catch (err) {
      setError('Failed to create campaign');
      console.error('Error creating campaign:', err);
    }
  };

  const handleSelectCampaign = (campaignName: string) => {
    navigate(`/campaign/${encodeURIComponent(campaignName)}`);
  };

  const handleDeleteCampaign = (campaignName: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click
    setCampaignToDelete(campaignName);
  };

  const confirmDelete = async () => {
    if (!campaignToDelete) return;
    
    try {
      const response = await fetch(`${API_URL}/api/campaigns/${encodeURIComponent(campaignToDelete)}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        setCampaignToDelete(null);
        loadCampaigns();
        loadArchivedCampaigns(); // Reload archived list
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to archive campaign');
        setCampaignToDelete(null);
      }
    } catch (err) {
      setError('Failed to archive campaign');
      console.error('Error archiving campaign:', err);
      setCampaignToDelete(null);
    }
  };

  if (loading) {
    return (
      <div className="campaign-selection">
        <div className="loading">Loading campaigns...</div>
      </div>
    );
  }

  return (
    <div className="campaign-selection">
      <div className="header">
        <h1>Campaign Manager</h1>
        <p className="subtitle">Select a campaign to continue</p>
      </div>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="campaigns-grid">
        {campaigns.map((campaign) => (
          <div
            key={campaign.name}
            className="campaign-card"
            onClick={() => editingCampaign !== campaign.name && handleSelectCampaign(campaign.name)}
          >
            {editingCampaign === campaign.name ? (
              <>
                <div className="edit-form" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={campaign.name}
                    readOnly
                    className="edit-input readonly"
                    title="Use the rename button to change the campaign name"
                  />
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Description..."
                    className="edit-textarea"
                    rows={3}
                  />
                  <div className="edit-actions">
                    <button onClick={(e) => handleSaveEdit(campaign.name, e)} className="save-button">Save</button>
                    <button onClick={handleCancelEdit} className="cancel-edit-button">Cancel</button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <button 
                  className="delete-button"
                  onClick={(e) => handleDeleteCampaign(campaign.name, e)}
                  title="Archive campaign"
                >
                  ✕
                </button>
                <button 
                  className="rename-button"
                  onClick={(e) => handleRename(campaign.name, e)}
                  title="Rename campaign"
                >
                  ✎
                </button>
                <button 
                  className="edit-button"
                  onClick={(e) => handleEdit(campaign, e)}
                  title="Edit campaign"
                >
                  📝
                </button>
                <h3>{campaign.name}</h3>
                {campaign.description && (
                  <p className="campaign-description">{campaign.description}</p>
                )}
                <p className="scenario-count">
                  {campaign.scenarioCount} scenario{campaign.scenarioCount !== 1 ? 's' : ''}
                </p>
                <p className="campaign-action">View scenarios</p>
              </>
            )}
          </div>
        ))}

        {!showCreateForm && (
          <div
            className="campaign-card create-new"
            onClick={() => setShowCreateForm(true)}
          >
            <div className="plus-icon">+</div>
            <h3>Create New Campaign</h3>
          </div>
        )}
      </div>

      {showCreateForm && (
        <div className="create-form">
          <form onSubmit={handleCreateCampaign}>
            <h3>Create New Campaign</h3>
            <input
              type="text"
              value={newCampaignName}
              onChange={(e) => setNewCampaignName(e.target.value)}
              placeholder="Campaign name..."
              autoFocus
            />
            <div className="form-actions">
              <button type="submit">Create</button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewCampaignName('');
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {archivedCampaigns.length > 0 && (
        <div className="archived-section">
          <button 
            className="archived-toggle"
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? '▼' : '▶'} Archived Campaigns ({archivedCampaigns.length})
          </button>
          
          {showArchived && (
            <div className="archived-list">
              {archivedCampaigns.map((archived) => (
                <div key={archived.folderName} className="archived-item">
                  <div className="archived-info">
                    <span className="archived-name">{archived.originalName}</span>
                    <span className="archived-date">
                      Archived: {new Date(archived.archivedAt.replace(/-/g, ':')).toLocaleString()}
                    </span>
                  </div>
                  <div className="archived-actions">
                    <button
                      className="restore-button"
                      onClick={() => handleRestore(archived.folderName)}
                    >
                      Restore
                    </button>
                    <button
                      className="permanent-delete-button"
                      onClick={() => handlePermanentDelete(archived.folderName)}
                      title="Permanently delete"
                    >
                      Delete Forever
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {campaignToDelete && (
        <div className="confirmation-overlay" onClick={() => setCampaignToDelete(null)}>
          <div className="confirmation-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Archive Campaign</h3>
            <p>Are you sure you want to archive "{campaignToDelete}"?</p>
            <p className="confirmation-note">The campaign will be moved to archived-campaigns folder and can be restored manually if needed.</p>
            <div className="confirmation-actions">
              <button onClick={confirmDelete} className="confirm-button">Archive</button>
              <button onClick={() => setCampaignToDelete(null)} className="cancel-button">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {archivedToDelete && (
        <div className="confirmation-overlay" onClick={() => setArchivedToDelete(null)}>
          <div className="confirmation-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Permanently Delete Campaign</h3>
            <p>Are you sure you want to permanently delete this archived campaign?</p>
            <p className="confirmation-note warning">⚠️ This action cannot be undone! All data will be lost forever.</p>
            <div className="confirmation-actions">
              <button onClick={confirmPermanentDelete} className="confirm-button danger">Delete Forever</button>
              <button onClick={() => setArchivedToDelete(null)} className="cancel-button">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {renamingCampaign && (
        <div className="confirmation-overlay" onClick={() => setRenamingCampaign(null)}>
          <div className="confirmation-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Rename Campaign</h3>
            <p>Enter a new name for "{renamingCampaign}":</p>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New campaign name..."
              className="rename-input"
              autoFocus
            />
            <div className="confirmation-actions">
              <button 
                onClick={confirmRename} 
                className="confirm-button"
              >
                Rename
              </button>
              <button onClick={() => setRenamingCampaign(null)} className="cancel-button">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CampaignSelection;
