import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { API_URL } from '../config';
import './ScenarioSelection.css';

interface Scenario {
  name: string;
  mapCount: number;
  description?: string;
}

function ScenarioSelection() {
  const navigate = useNavigate();
  const { campaignName } = useParams<{ campaignName: string }>();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [newScenarioName, setNewScenarioName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingScenario, setEditingScenario] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [renamingScenario, setRenamingScenario] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (campaignName) {
      loadScenarios();
    }
  }, [campaignName]);

  const loadScenarios = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/campaigns/${encodeURIComponent(campaignName!)}/scenarios`);
      const data = await response.json();
      setScenarios(data.scenarios || []);
      setError(null);
    } catch (err) {
      setError('Failed to load scenarios');
      console.error('Error loading scenarios:', err);
    } finally {
      setLoading(false);
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

  if (loading) {
    return (
      <div className="scenario-selection">
        <div className="loading">Loading scenarios...</div>
      </div>
    );
  }

  return (
    <div className="scenario-selection">
      <div className="header">
        <button className="back-button" onClick={handleBack}>
          ← Back to Campaigns
        </button>
        <h1>{campaignName}</h1>
        <p className="subtitle">Select a scenario to manage</p>
      </div>

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
    </div>
  );
}

export default ScenarioSelection;
