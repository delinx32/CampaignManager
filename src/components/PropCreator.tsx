import { useState, useEffect } from 'react';
import { API_URL } from '../config';
import type { Prop, ImageState } from '../types';
import AIImageGenerator from './AIImageGenerator';
import ImagePicker from './ImagePicker';

interface PropCreatorProps {
  onCreateProp: (prop: Omit<Prop, 'id'>, imageFile: File | null) => void;
  onUpdateProp?: (propId: string, prop: Omit<Prop, 'id'>, imageFile: File | null) => void;
  editingProp?: Prop | null;
  onCancel: () => void;
}

export default function PropCreator({ onCreateProp, onUpdateProp, editingProp, onCancel }: PropCreatorProps) {
  // Convert HSL to Hex
  const hslToHex = (h: number, s: number, l: number) => {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };

  // Generate random vibrant color
  const generateRandomColor = () => {
    const hue = Math.floor(Math.random() * 360);
    const saturation = 70 + Math.floor(Math.random() * 30);
    const lightness = 45 + Math.floor(Math.random() * 20);
    return hslToHex(hue, saturation, lightness);
  };

  const [name, setName] = useState(editingProp?.name || '');
  const [description, setDescription] = useState(editingProp?.description || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(
    editingProp?.imageUrl 
      ? (editingProp.imageUrl.startsWith('http') ? editingProp.imageUrl : `${API_URL}${editingProp.imageUrl}`)
      : null
  );
  const [color, setColor] = useState(editingProp?.color || generateRandomColor());
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [selectedPropUrl, setSelectedPropUrl] = useState<string | null>(
    editingProp?.imageUrl 
      ? (editingProp.imageUrl.startsWith('http') ? editingProp.imageUrl : `${API_URL}${editingProp.imageUrl}`)
      : null
  );
  const [states, setStates] = useState<ImageState[]>(editingProp?.states || []);
  const [editingStateName, setEditingStateName] = useState<string>('');
  const [generatingStateFor, setGeneratingStateFor] = useState<string | null>(null);
  const [showStateImagePicker, setShowStateImagePicker] = useState<string | null>(null);
  const [baseImageReferenceFile, setBaseImageReferenceFile] = useState<File | null>(null);
  const [tags, setTags] = useState(editingProp?.tags || '');
  const [editingStateTags, setEditingStateTags] = useState<string>('');

  // Fetch base image as File when editing an existing prop
  useEffect(() => {
    if (editingProp?.imageUrl && !baseImageReferenceFile) {
      const imageUrl = editingProp.imageUrl.startsWith('http') 
        ? editingProp.imageUrl 
        : `${API_URL}${editingProp.imageUrl}`;
      
      fetch(imageUrl)
        .then(res => res.blob())
        .then(blob => {
          const file = new File([blob], imageUrl.split('/').pop() || 'base-image.png', { type: blob.type });
          setBaseImageReferenceFile(file);
        })
        .catch(err => console.error('Failed to fetch base image for editing:', err));
    }
  }, [editingProp]);

  const handlePropSelect = (url: string) => {
    setSelectedPropUrl(url);
    setImagePreview(url);
    setImageFile(null);
    // Fetch the image and convert to File for use as reference
    fetch(url)
      .then(res => res.blob())
      .then(blob => {
        const file = new File([blob], url.split('/').pop() || 'base-image.png', { type: blob.type });
        setBaseImageReferenceFile(file);
      })
      .catch(err => console.error('Failed to fetch base image:', err));
  };

  const handleImageChange = (file: File) => {
    setImageFile(file);
    setBaseImageReferenceFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      setImagePreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Strip API_URL from imagePreview to store relative path
    const relativeImageUrl = imagePreview ? imagePreview.replace(API_URL, '') : undefined;
    
    const propData: Omit<Prop, 'id'> = {
      name,
      description,
      imageUrl: relativeImageUrl,
      tags: tags || undefined,
      color,
      x: 0, // Will be set by MapCanvas
      y: 0, // Will be set by MapCanvas  
      radius: 0, // Will be set by MapCanvas
      states: states.length > 0 ? states : undefined,
      activeState: undefined
    };

    if (editingProp && onUpdateProp) {
      onUpdateProp(editingProp.id, propData, imageFile);
    } else {
      onCreateProp(propData, imageFile);
    }
  };

  const handleImageGenerated = (url: string, file: File) => {
    if (generatingStateFor) {
      // Adding state image via AI generation
      handleStateImageGenerated(generatingStateFor, url, file);
    } else {
      // Setting primary image
      setImagePreview(url);
      setImageFile(file);
      setShowAIGenerator(false);
    }
  };

  const handleAddState = async () => {
    if (!editingStateName.trim()) return;
    if (states.some(s => s.name === editingStateName.trim())) {
      alert('A state with this name already exists');
      return;
    }
    
    // Show the image picker for this state
    setShowStateImagePicker(editingStateName.trim());
  };

  const handleStateImageSelect = (stateName: string, url: string) => {
    // Strip API_URL to store relative path
    const relativeUrl = url.replace(API_URL, '');
    setStates(prev => [...prev, { name: stateName, imageUrl: relativeUrl }]);
    setEditingStateName('');
    setShowStateImagePicker(null);
  };

  const handleStateFileSelect = async (stateName: string, file: File) => {
    // Upload the file immediately to the server
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch(`${API_URL}/api/upload/props`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('Upload failed');
      }
      
      const data = await response.json();
      const uploadedUrl = data.url; // This will be relative like /images/props/...
      
      setStates(prev => [...prev, { name: stateName, imageUrl: uploadedUrl, tags: editingStateTags }]);
      setEditingStateName('');
      setEditingStateTags('');
      setShowStateImagePicker(null);
    } catch (error) {
      console.error('Failed to upload state image:', error);
      alert('Failed to upload state image. Please try again.');
    }
  };

  const handleStateImageGenerated = (stateName: string, url: string, _file: File) => {
    // Strip API_URL to store relative path
    const relativeUrl = url.replace(API_URL, '');
    
    // Check if state already exists (editing) or is new (adding)
    const existingState = states.find(s => s.name === stateName);
    if (existingState) {
      // Update existing state
      setStates(prev => prev.map(s => s.name === stateName ? { ...s, imageUrl: relativeUrl, tags: editingStateTags } : s));
    } else {
      // Add new state
      setStates(prev => [...prev, { name: stateName, imageUrl: relativeUrl, tags: editingStateTags }]);
    }
    
    setEditingStateName('');
    setEditingStateTags('');
    setGeneratingStateFor(null);
    setShowAIGenerator(false);
    setShowStateImagePicker(null);
  };

  const handleUpdateStateName = (oldName: string, newName: string) => {
    if (!newName.trim()) return;
    if (oldName === newName.trim()) return;
    if (states.some(s => s.name === newName.trim() && s.name !== oldName)) {
      alert('A state with this name already exists');
      return;
    }
    setStates(prev => prev.map(s => s.name === oldName ? { ...s, name: newName.trim() } : s));
  };

  const handleUpdateStateImage = (stateName: string, url: string) => {
    const relativeUrl = url.replace(API_URL, '');
    setStates(prev => prev.map(s => s.name === stateName ? { ...s, imageUrl: relativeUrl } : s));
  };

  const handleUpdateStateImageFile = async (stateName: string, file: File) => {
    // Upload the file immediately to the server
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch(`${API_URL}/api/upload/props`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('Upload failed');
      }
      
      const data = await response.json();
      const uploadedUrl = data.url;
      
      setStates(prev => prev.map(s => s.name === stateName ? { ...s, imageUrl: uploadedUrl } : s));
    } catch (error) {
      console.error('Failed to upload state image:', error);
      alert('Failed to upload state image. Please try again.');
    }
  };

  const handleRemoveState = (stateName: string) => {
    setStates(prev => prev.filter(s => s.name !== stateName));
  };

  return (
    <div className="token-creator-overlay">
      <div className="token-creator-dialog">
        <button className="close-button" onClick={onCancel} type="button"></button>
        <h2>{editingProp ? 'Edit Prop' : 'Create Prop'}</h2>
        
        {showAIGenerator ? (
          <div>
            <AIImageGenerator
              onImageGenerated={handleImageGenerated}
              onClose={() => {
                setShowAIGenerator(false);
                setGeneratingStateFor(null);
              }}
              promptTemplate="props"
              initialPrompt={generatingStateFor ? `${description} - ${generatingStateFor} state` : description}
              referenceImages={generatingStateFor && baseImageReferenceFile ? [baseImageReferenceFile] : []}
            />
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Name:</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Description:</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>

            <ImagePicker
              label="Image:"
              imagePreview={imagePreview}
              selectedUrl={selectedPropUrl}
              folder="props"
              onFileSelect={handleImageChange}
              onUrlSelect={handlePropSelect}
              onAIGenerate={() => setShowAIGenerator(true)}
              aiGenerateLabel="Generate Prop Image"
              tags={tags}
              onTagsChange={setTags}
            />

            {imagePreview && (
              <div className="form-group">
                <label>Image States:</label>
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>
                  Add different states for this prop (e.g., lit/unlit, open/closed)
                </p>
                {states.map((state, index) => (
                  <div key={index} style={{ 
                    marginBottom: '12px',
                    padding: '12px',
                    background: '#2a2a2a',
                    borderRadius: '4px',
                    border: '1px solid #444'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <input
                          type="text"
                          value={state.name}
                          onChange={(e) => handleUpdateStateName(state.name, e.target.value)}
                          placeholder="State name"
                          style={{ 
                            width: '100%',
                            padding: '6px',
                            background: '#1a1a1a',
                            border: '1px solid #555',
                            borderRadius: '4px',
                            color: '#fff',
                            marginBottom: '4px'
                          }}
                        />
                        <input
                          type="text"
                          value={state.tags || ''}
                          onChange={(e) => {
                            setStates(prev => prev.map(s => 
                              s.name === state.name ? { ...s, tags: e.target.value } : s
                            ));
                          }}
                          placeholder="Tags (comma-separated)"
                          style={{ 
                            width: '100%',
                            padding: '6px',
                            background: '#1a1a1a',
                            border: '1px solid #555',
                            borderRadius: '4px',
                            color: '#fff',
                            fontSize: '11px'
                          }}
                        />
                      </div>
                      <button 
                        type="button" 
                        onClick={() => handleRemoveState(state.name)}
                        style={{ 
                          background: '#d32f2f', 
                          color: 'white', 
                          border: 'none', 
                          padding: '6px 12px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    <ImagePicker
                      label=""
                      imagePreview={state.imageUrl.startsWith('http') ? state.imageUrl : `${API_URL}${state.imageUrl}`}
                      selectedUrl={state.imageUrl.startsWith('http') ? state.imageUrl : `${API_URL}${state.imageUrl}`}
                      folder="props"
                      onFileSelect={(file) => handleUpdateStateImageFile(state.name, file)}
                      onUrlSelect={(url) => handleUpdateStateImage(state.name, url)}
                      onAIGenerate={() => {
                        setGeneratingStateFor(state.name);
                        setShowAIGenerator(true);
                      }}
                      aiGenerateLabel="Generate State Image"
                    />
                  </div>
                ))}
                
                {showStateImagePicker ? (
                  <div style={{ 
                    marginTop: '12px', 
                    padding: '12px', 
                    background: '#2a2a2a', 
                    borderRadius: '4px',
                    border: '2px solid #4CAF50'
                  }}>
                    <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
                      Select image for state: {showStateImagePicker}
                    </div>
                    <ImagePicker
                      label=""
                      imagePreview={states.find(s => s.name === showStateImagePicker)?.imageUrl ? (states.find(s => s.name === showStateImagePicker)!.imageUrl.startsWith('http') ? states.find(s => s.name === showStateImagePicker)!.imageUrl : `${API_URL}${states.find(s => s.name === showStateImagePicker)!.imageUrl}`) : null}
                      selectedUrl={states.find(s => s.name === showStateImagePicker)?.imageUrl ? (states.find(s => s.name === showStateImagePicker)!.imageUrl.startsWith('http') ? states.find(s => s.name === showStateImagePicker)!.imageUrl : `${API_URL}${states.find(s => s.name === showStateImagePicker)!.imageUrl}`) : null}
                      folder="props"
                      onFileSelect={(file) => handleStateFileSelect(showStateImagePicker, file)}
                      onUrlSelect={(url) => handleStateImageSelect(showStateImagePicker, url)}
                      onAIGenerate={() => {
                        setGeneratingStateFor(showStateImagePicker);
                        setShowAIGenerator(true);
                      }}
                      aiGenerateLabel="Generate State Image"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setShowStateImagePicker(null);
                        setEditingStateName('');
                      }}
                      style={{
                        marginTop: '8px',
                        background: '#666',
                        color: 'white',
                        border: 'none',
                        padding: '6px 12px',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                    <input
                      type="text"
                      placeholder="State name (e.g., 'lit', 'unlit')"
                      value={editingStateName}
                      onChange={(e) => setEditingStateName(e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Tags for this state (comma-separated)"
                      value={editingStateTags}
                      onChange={(e) => setEditingStateTags(e.target.value)}
                    />
                    <button 
                      type="button"
                      onClick={handleAddState}
                      disabled={!editingStateName.trim()}
                      style={{
                        background: editingStateName.trim() ? '#4CAF50' : '#666',
                        color: 'white',
                        border: 'none',
                        padding: '8px 16px',
                        borderRadius: '4px',
                        cursor: editingStateName.trim() ? 'pointer' : 'not-allowed'
                      }}
                    >
                      Add State
                    </button>
                  </div>
                )}
              </div>
            )}

            {!imagePreview && !imageFile && (
              <div className="form-group">
                <label>Color (for map marker):</label>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {editingProp ? 'Update Prop' : 'Create Prop'}
              </button>
              <button type="button" onClick={onCancel} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}