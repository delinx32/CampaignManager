import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { API_URL } from '../config';
import AppHeader from './AppHeader';
import './ScenarioSelection.css';

interface Scenario {
  name: string;
  mapCount: number;
  description?: string;
  mapImageUrl?: string;
}

interface ArchivedScenario {
  folderName: string;
  originalName: string;
  archivedAt: string;
}

function ScenarioSelection() {
  const navigate = useNavigate();
  const { campaignName } = useParams<{ campaignName: string }>();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [archivedScenarios, setArchivedScenarios] = useState<ArchivedScenario[]>([]);
  const [campaignBackgroundImage, setCampaignBackgroundImage] = useState<string | undefined>(undefined);
  const [newScenarioName, setNewScenarioName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingScenario, setEditingScenario] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [renamingScenario, setRenamingScenario] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [scenarioToDelete, setScenarioToDelete] = useState<string | null>(null);
  const [archivedToDelete, setArchivedToDelete] = useState<string | null>(null);

  useEffect(() => {
    if (campaignName) {
      loadScenarios();
      loadArchivedScenarios();
    }
  }, [campaignName]);

  const loadScenarios = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/campaigns/${encodeURIComponent(campaignName!)}/scenarios`, {
        credentials: 'include'
      });
      const data = await response.json();
      setScenarios(data.scenarios || []);
      setCampaignBackgroundImage(data.campaignBackgroundImage);
      setError(null);
    } catch (err) {
      setError('Failed to load scenarios');
      console.error('Error loading scenarios:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadArchivedScenarios = async () =>
  {
    try
    {
      const response = await fetch(`${API_URL}/api/campaigns/${encodeURIComponent(campaignName!)}/archived-scenarios`, {
        credentials: 'include'
      });
      const data = await response.json();
      setArchivedScenarios(data.archived || []);
    } catch (err)
    {
      console.error('Error loading archived scenarios:', err);
    }
  };

  const handleCreateScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newScenarioName.trim()) {
      setError('Scenario name cannot be empty');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/campaigns/${encodeURIComponent(campaignName!)}/scenarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newScenarioName.trim() })
      });

      if (response.ok) {
        setNewScenarioName('');
        setShowCreateForm(false);
        loadScenarios();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to create scenario');
      }
    } catch (err) {
      setError('Failed to create scenario');
      console.error('Error creating scenario:', err);
    }
  };

  const handleSelectScenario = async (scenarioName: string) => {
    try {
      // Set the backend context
      const response = await fetch(`${API_URL}/api/set-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          campaign: campaignName, 
          scenario: scenarioName 
        })
      });

      if (response.ok) {
        navigate(`/campaign/${encodeURIComponent(campaignName!)}/${encodeURIComponent(scenarioName)}/gm`);
      } else {
        const errorData = await response.json();
        setError(`Failed to set context: ${errorData.error || response.statusText}`);
      }
    } catch (err) {
      setError(`Failed to set context: ${err instanceof Error ? err.message : 'Network error'}`);
      console.error('Error setting context:', err);
    }
  };

  const handleBack = () => {
    navigate('/');
  };

  const handleEdit = (e: React.MouseEvent, scenario: Scenario) => {
    e.stopPropagation();
    setEditingScenario(scenario.name);
    setEditDescription(scenario.description || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch(
        `${API_URL}/api/campaigns/${encodeURIComponent(campaignName!)}/scenarios/${encodeURIComponent(editingScenario!)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ description: editDescription })
        }
      );

      if (response.ok) {
        setEditingScenario(null);
        setEditDescription('');
        loadScenarios();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to update scenario');
      }
    } catch (err) {
      setError('Failed to update scenario');
      console.error('Error updating scenario:', err);
    }
  };

  const handleRename = (e: React.MouseEvent, scenario: Scenario) => {
    e.stopPropagation();
    setRenamingScenario(scenario.name);
    setNewName(scenario.name);
  };

  const confirmRename = async () => {
    if (!newName.trim() || newName === renamingScenario) {
      setRenamingScenario(null);
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/campaigns/${encodeURIComponent(campaignName!)}/scenarios/${encodeURIComponent(renamingScenario!)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ newName: newName.trim() })
        }
      );

      if (response.ok) {
        setRenamingScenario(null);
        setNewName('');
        loadScenarios();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to rename scenario');
      }
    } catch (err) {
      setError('Failed to rename scenario');
      console.error('Error renaming scenario:', err);
    }
  };

  const handleDeleteScenario = (scenarioName: string, e: React.MouseEvent) =>
  {
    e.stopPropagation();
    setScenarioToDelete(scenarioName);
  };

  const confirmDelete = async () =>
  {
    if (!scenarioToDelete) return;

    try
    {
      const response = await fetch(`${API_URL}/api/campaigns/${encodeURIComponent(campaignName!)}/scenarios/${encodeURIComponent(scenarioToDelete)}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok)
      {
        setScenarioToDelete(null);
        loadScenarios();
        loadArchivedScenarios();
      } else
      {
        const data = await response.json();
        setError(data.error || 'Failed to archive scenario');
        setScenarioToDelete(null);
      }
    } catch (err)
    {
      setError('Failed to archive scenario');
      console.error('Error archiving scenario:', err);
      setScenarioToDelete(null);
    }
  };

  const handleRestore = async (folderName: string) =>
  {
    try
    {
      const response = await fetch(`${API_URL}/api/campaigns/${encodeURIComponent(campaignName!)}/archived-scenarios/${encodeURIComponent(folderName)}/restore`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok)
      {
        loadScenarios();
        loadArchivedScenarios();
      } else
      {
        const data = await response.json();
        setError(data.error || 'Failed to restore scenario');
      }
    } catch (err)
    {
      setError('Failed to restore scenario');
      console.error('Error restoring scenario:', err);
    }
  };

  const handlePermanentDelete = (folderName: string) =>
  {
    setArchivedToDelete(folderName);
  };

  const confirmPermanentDelete = async () =>
  {
    if (!archivedToDelete) return;

    try
    {
      const response = await fetch(`${API_URL}/api/campaigns/${encodeURIComponent(campaignName!)}/archived-scenarios/${encodeURIComponent(archivedToDelete)}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok)
      {
        setArchivedToDelete(null);
        loadArchivedScenarios();
      } else
      {
        const data = await response.json();
        setError(data.error || 'Failed to delete scenario');
        setArchivedToDelete(null);
      }
    } catch (err)
    {
      setError('Failed to delete scenario');
      console.error('Error deleting scenario:', err);
      setArchivedToDelete(null);
    }
  };

  if (loading) {
    return (
      <div className="scenario-selection">
        <div className="loading">Loading scenarios...</div>
      </div>
    );
  }

  return (
    <div className="scenario-selection">
      <AppHeader 
        title={campaignName || 'Campaign'} 
        campaignImage={campaignBackgroundImage}
        subtitle="Select a scenario to manage" 
      />
      <div className="scenario-content">
        <button className="back-button" onClick={handleBack}>
          ← Back to Campaigns
        </button>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="scenarios-grid">
        {scenarios.map((scenario) => (
          <div
            key={scenario.name}
            className="scenario-card"
            style={{
              backgroundImage: scenario.mapImageUrl 
                ? `url(${scenario.mapImageUrl.startsWith('http') ? scenario.mapImageUrl : `${API_URL}${scenario.mapImageUrl}`})` 
                : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
            onClick={() => editingScenario !== scenario.name && handleSelectScenario(scenario.name)}
          >
            {editingScenario === scenario.name ? (
              <form className="edit-form" onSubmit={handleSaveEdit} onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  value={scenario.name}
                  readOnly
                  className="edit-input readonly"
                />
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Add a description..."
                  rows={3}
                  className="edit-textarea"
                  autoFocus
                />
                <div className="edit-buttons">
                  <button type="submit" className="save-button">Save</button>
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingScenario(null);
                      setEditDescription('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="scenario-card-buttons">
                  <button
                    className="rename-button"
                    onClick={(e) => handleRename(e, scenario)}
                    title="Rename scenario"
                  >
                    ✎
                  </button>
                  <button
                    className="edit-button"
                    onClick={(e) => handleEdit(e, scenario)}
                    title="Edit description"
                  >
                    📝
                  </button>
                  <button
                    className="delete-button"
                    onClick={(e) => handleDeleteScenario(scenario.name, e)}
                    title="Archive scenario"
                  >
                    🗑️
                  </button>
                </div>
                <h3>{scenario.name}</h3>
                {scenario.description && (
                  <p className="description">{scenario.description}</p>
                )}
                <p className="map-count">
                  {scenario.mapCount} map{scenario.mapCount !== 1 ? 's' : ''}
                </p>
              </>
            )}
          </div>
        ))}

        {!showCreateForm && (
          <div
            className="scenario-card create-new"
            onClick={() => setShowCreateForm(true)}
          >
            <div className="plus-icon">+</div>
            <h3>Create New Scenario</h3>
          </div>
        )}
      </div>

      {showCreateForm && (
        <div className="create-form">
          <form onSubmit={handleCreateScenario}>
            <h3>Create New Scenario</h3>
            <input
              type="text"
              value={newScenarioName}
              onChange={(e) => setNewScenarioName(e.target.value)}
              placeholder="Scenario name..."
              autoFocus
            />
            <div className="form-actions">
              <button type="submit">Create</button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewScenarioName('');
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {renamingScenario && (
        <div className="modal-overlay" onClick={() => setRenamingScenario(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Rename Scenario</h3>
            <p>Enter a new name for "{renamingScenario}"</p>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New scenario name..."
              className="rename-input"
              autoFocus
            />
            <div className="modal-buttons">
              <button onClick={confirmRename}>Rename</button>
              <button onClick={() => setRenamingScenario(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {scenarioToDelete && (
        <div className="modal-overlay" onClick={() => setScenarioToDelete(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Archive Scenario</h3>
            <p>Are you sure you want to archive "{scenarioToDelete}"?</p>
            <p className="confirmation-note">The scenario will be moved to archived-scenarios folder and can be restored later.</p>
            <div className="modal-buttons">
              <button onClick={confirmDelete} className="delete-confirm">Archive</button>
              <button onClick={() => setScenarioToDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {archivedScenarios.length > 0 && (
        <div className="archived-section">
          <h2>Archived Scenarios</h2>
          <div className="archived-list">
            {archivedScenarios.map((archived) => (
              <div key={archived.folderName} className="archived-item">
                <div className="archived-info">
                  <strong>{archived.originalName}</strong>
                  <span className="archived-date">
                    Archived: {new Date(archived.archivedAt).toLocaleString()}
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
                  >
                    Permanently Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {archivedToDelete && (
        <div className="modal-overlay" onClick={() => setArchivedToDelete(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Permanently Delete Scenario</h3>
            <p>Are you sure you want to permanently delete this archived scenario?</p>
            <p className="warning-note">This action cannot be undone!</p>
            <div className="modal-buttons">
              <button onClick={confirmPermanentDelete} className="delete-confirm">Delete Forever</button>
              <button onClick={() => setArchivedToDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default ScenarioSelection;
