import { useState, useEffect, useRef } from 'react';
import { API_URL } from '../config';
import type { Actor, Token, ImageState } from '../types';
import AIImageGenerator from './AIImageGenerator';
import ImagePicker from './ImagePicker';

interface TokenCreatorProps {
  onCreateToken: (actor: Actor, imageFile: File | null, color: string, actorUrl?: string, portraitFile?: File | null, portraitUrl?: string, states?: ImageState[], gridWidth?: number, gridHeight?: number, tags?: string) => void;
  onUpdateToken?: (tokenId: string, actor: Actor, imageFile: File | null, color: string, actorUrl?: string, portraitFile?: File | null, portraitUrl?: string, states?: ImageState[], gridWidth?: number, gridHeight?: number, tags?: string) => void;
  editingToken?: Token | null;
  onCancel: () => void;
  defaultPlayerMode?: boolean;
}

export default function TokenCreator({ onCreateToken, onUpdateToken, editingToken, onCancel, defaultPlayerMode = false }: TokenCreatorProps) {
  // Generate random vibrant color
  const generateRandomColor = () => {
    const hue = Math.floor(Math.random() * 360);
    const saturation = 70 + Math.floor(Math.random() * 30);
    const lightness = 45 + Math.floor(Math.random() * 20);
    
    const h = hue / 360;
    const s = saturation / 100;
    const l = lightness / 100;
    
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    
    const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  const [color, setColor] = useState(editingToken?.color || generateRandomColor());
  const [name, setName] = useState(editingToken?.actor?.name || '');
  const [ac, setAc] = useState(editingToken?.actor?.ac?.toString() || '');
  const [hp, setHp] = useState(editingToken?.actor?.hp?.toString() || '');
  const [initiative, setInitiative] = useState(editingToken?.actor?.initiative?.toString() || '');
  const [description, setDescription] = useState(editingToken?.actor?.description || '');
  const [characterSheetUrl, setCharacterSheetUrl] = useState(editingToken?.actor?.characterSheetUrl || '');
  const [isPlayer, setIsPlayer] = useState(editingToken?.actor?.player || defaultPlayerMode);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [flippingImage, setFlippingImage] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(
    editingToken?.imageUrl 
      ? (editingToken.imageUrl.startsWith('http') ? editingToken.imageUrl : `${API_URL}${editingToken.imageUrl}`)
      : null
  );
  const [selectedActorUrl, setSelectedActorUrl] = useState<string | null>(
    editingToken?.imageUrl 
      ? (editingToken.imageUrl.startsWith('http') ? editingToken.imageUrl : `${API_URL}${editingToken.imageUrl}`)
      : null
  );

  // Portrait state
  const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const [portraitPreview, setPortraitPreview] = useState<string | null>(
    editingToken?.portraitUrl 
      ? (editingToken.portraitUrl.startsWith('http') ? editingToken.portraitUrl : `${API_URL}${editingToken.portraitUrl}`)
      : null
  );
  const [selectedPortraitUrl, setSelectedPortraitUrl] = useState<string | null>(
    editingToken?.portraitUrl 
      ? (editingToken.portraitUrl.startsWith('http') ? editingToken.portraitUrl : `${API_URL}${editingToken.portraitUrl}`)
      : null
  );
  const [importingPortrait, setImportingPortrait] = useState(false);
  const [states, setStates] = useState<ImageState[]>(editingToken?.states || []);
  const [editingStateName, setEditingStateName] = useState<string>('');
  const [generatingStateFor, setGeneratingStateFor] = useState<string | null>(null);
  const [showStateImagePicker, setShowStateImagePicker] = useState<string | null>(null);
  const [gridWidth, setGridWidth] = useState(editingToken?.gridWidth || 1);
  const [gridHeight, setGridHeight] = useState(editingToken?.gridHeight || 1);
  const [tags, setTags] = useState(editingToken?.tags || '');
  const [editingStateTags, setEditingStateTags] = useState<string>('');
    // Portrait image upload handler
    const handlePortraitChange = (file: File) => {
      setPortraitFile(file);
      setSelectedPortraitUrl(null);
      const reader = new FileReader();
      reader.onload = (e) => {
        setPortraitPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    };

    // Portrait gallery select handler (reuse availableActors for now)
    const handlePortraitSelect = (url: string) => {
      setSelectedPortraitUrl(url);
      setPortraitPreview(url);
    };
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [aiReferenceImages, setAIReferenceImages] = useState<File[]>([]);
  const [aiPromptTemplate, setAIPromptTemplate] = useState<string>('token');
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Import portrait from character sheet URL using backend Puppeteer endpoint
  const importPortraitFromUrl = async (url: string) => {
    if (!url) return;

    try {
      setImportingPortrait(true);
      
      // Call backend endpoint to import portrait using Puppeteer
      const resp = await fetch(`${API_URL}/api/import-portrait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const fullUrl = `${API_URL}${data.url}`;
      setSelectedPortraitUrl(fullUrl);
      setPortraitPreview(fullUrl);
      
      // If name is blank and character name was found, populate it
      if (!name && data.characterName) {
        setName(data.characterName);
      }
      
      // Handle description: preserve user content before terminator, replace after
      if (data.notes) {
        const terminator = '~~~do not remove~~~';
        let userContent = '';
        
        // Check if current description has the terminator
        if (description && description.includes(terminator)) {
          const parts = description.split(terminator);
          if (parts.length > 0) {
            userContent = parts[0]; // Preserve everything before first terminator
          }
        }
        
        // Set new description with preserved user content + imported content
        const newDescription = userContent 
          ? `${userContent}${data.notes}`
          : data.notes;
        setDescription(newDescription);
      }
      
      console.log('Portrait imported successfully:', fullUrl);
    } catch (err) {
      console.error('Failed to import portrait:', err);
    } finally {
      setImportingPortrait(false);
    }
  };

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.arc(50, 50, 45, 0, Math.PI * 2);
    ctx.fillStyle = color || 'rgba(0, 100, 255, 0.5)';
    ctx.fill();
    ctx.strokeStyle = color ? color.replace('0.5', '0.8') : 'rgba(0, 50, 200, 0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (imagePreview) {
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(50, 50, 43, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, 7, 7, 86, 86);
        ctx.restore();
      };
      img.onerror = (e) => {
        console.error('Failed to load image for preview:', imagePreview, e);
      };
      img.src = imagePreview;
    }
  }, [color, imagePreview]);

  const handleImageChange = (file: File) => {
    setImageFile(file);
    setSelectedActorUrl(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleActorSelect = (url: string) => {
    setSelectedActorUrl(url);
    setImageFile(null);
    setImagePreview(url);
  };

  const handleFlipImage = async () => {
    const imageUrl = selectedActorUrl || imagePreview;
    if (!imageUrl || !imageUrl.includes('/images/')) {
      alert('Please select an image from the gallery to flip');
      return;
    }

    setFlippingImage(true);
    try {
      const response = await fetch(`${API_URL}/api/images/flip-horizontal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ imageUrl: imageUrl.replace(API_URL, '') })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to flip image');
      }

      // Force image reload by adding cache buster
      const cacheBuster = Date.now();
      const urlWithCache = `${imageUrl.split('?')[0]}?t=${cacheBuster}`;
      setImagePreview(urlWithCache);
      if (selectedActorUrl) {
        setSelectedActorUrl(urlWithCache);
      }
      alert('Image flipped successfully!');
    } catch (err: any) {
      console.error('Error flipping image:', err);
      alert(err.message || 'Failed to flip image');
    } finally {
      setFlippingImage(false);
    }
  };

  const handleAIImageGenerated = (imageUrl: string, imageFile: File) => {
    if (generatingStateFor) {
      // Adding state image via AI generation
      setStates(prev => [...prev, { name: generatingStateFor, imageUrl, tags: editingStateTags }]);
      setGeneratingStateFor(null);
      setEditingStateName('');
      setEditingStateTags('');
      setShowStateImagePicker(null);
    } else if (showAIGenerator && portraitPreview !== null) {
      // If AI generator is for portrait, update portrait preview
      setPortraitFile(imageFile);
      setPortraitPreview(`${API_URL}/images/portrait/${imageUrl}`);
      setSelectedPortraitUrl(`${API_URL}/images/portrait/${imageUrl}`);
    } else {
      // Map/token image
      setImageFile(imageFile);
      setSelectedActorUrl(null);
      setImagePreview(`${API_URL}/images/token/${imageUrl}`);
    }
    setShowAIGenerator(false);
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
    const tags = editingStateTags.trim();
    setStates(prev => [...prev, { name: stateName, imageUrl: relativeUrl, tags }]);
    setEditingStateName('');
    setEditingStateTags('');
    setShowStateImagePicker(null);
  };

  const handleStateFileSelect = async (stateName: string, file: File) => {
    // Upload the file immediately to the server
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch(`${API_URL}/api/upload?folder=token`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error('Upload failed');
      
      const data = await response.json();
      const tags = editingStateTags.trim();
      setStates(prev => [...prev, { name: stateName, imageUrl: data.path, tags }]);
      setEditingStateName('');
      setEditingStateTags('');
      setShowStateImagePicker(null);
    } catch (error) {
      console.error('Error uploading state image:', error);
      alert('Failed to upload state image');
    }
  };

  const handleRemoveState = (stateName: string) => {
    setStates(prev => prev.filter(s => s.name !== stateName));
  };

  const handleUpdateStateImage = (stateName: string, url: string) => {
    const relativeUrl = url.replace(API_URL, '');
    setStates(prev => prev.map(s => s.name === stateName ? { ...s, imageUrl: relativeUrl } : s));
  };

  const handleUpdateStateImageFile = async (stateName: string, file: File) => {
    // Upload the file immediately to the server
    const formData = new FormData();
    formData.append('image', file);
    formData.append('type', 'token');
    
    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        credentials: 'include',
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

  const handleUpdateStateName = (oldName: string, newName: string) => {
    if (newName.trim() && newName !== oldName) {
      setStates(prev => prev.map(s => s.name === oldName ? { ...s, name: newName } : s));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const actor: Actor = {
      name: name || 'Unnamed',
      ac: parseInt(ac) || 10,
      hp: parseInt(hp) || 10,
      description: description || '',
      player: isPlayer,
      initiative: parseInt(initiative) || 0,
      characterSheetUrl: characterSheetUrl || undefined
    };

    // Compose image file and url, stripping API_URL to store relative path
    const imageFileToSend: File | null = imageFile || null;
    const imageUrlToSend: string | undefined = !imageFile && selectedActorUrl ? selectedActorUrl.replace(API_URL, '') : undefined;
    // Compose portrait file and url, stripping API_URL to store relative path
    const portraitFileToSend: File | null = portraitFile || null;
    const portraitUrlToSend: string | undefined = !portraitFile && selectedPortraitUrl ? selectedPortraitUrl.replace(API_URL, '') : undefined;

    if (editingToken && onUpdateToken) {
      onUpdateToken(
        editingToken.id,
        actor,
        imageFileToSend,
        color,
        imageUrlToSend,
        portraitFileToSend,
        portraitUrlToSend,
        states.length > 0 ? states : undefined,
        gridWidth,
        gridHeight,
        tags || undefined
      );
    } else {
      onCreateToken(
        actor,
        imageFileToSend,
        color,
        imageUrlToSend,
        portraitFileToSend,
        portraitUrlToSend,
        states.length > 0 ? states : undefined,
        gridWidth,
        gridHeight,
        tags || undefined
      );
    }
  };

  return (
    <div className="token-creator-overlay">
      <div className="token-creator-dialog">
        <button className="close-button" onClick={onCancel} type="button">×</button>
        <h2>{editingToken ? 'Edit Token' : 'Create Token'}</h2>
        <form onSubmit={handleSubmit}>
                      <div className="form-group">
            <label>Actor Name (optional):</label>
            <input 
              type="text" 
              value={name} 
              onChange={(e) => setName(e.target.value)}
              placeholder="Character name"
            />
          </div>

          <div className="form-group">
            <label>Character Sheet URL (optional):</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input 
                type="url" 
                value={characterSheetUrl} 
                onChange={(e) => setCharacterSheetUrl(e.target.value)}
                placeholder="https://example.com/character-sheet"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => {
                  if (characterSheetUrl) {
                    importPortraitFromUrl(characterSheetUrl);
                  }
                }}
                className="btn-secondary"
                disabled={!characterSheetUrl || importingPortrait}
              >
                {importingPortrait ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>Token Color:</label>
            <input 
              type="color" 
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Token Size (grid squares):</label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <label style={{ margin: 0, fontSize: '14px' }}>Width:</label>
                <input 
                  type="number" 
                  value={gridWidth}
                  onChange={(e) => setGridWidth(Math.max(1, Math.min(3, parseInt(e.target.value) || 1)))}
                  min="1"
                  max="3"
                  style={{ width: '60px' }}
                />
              </div>
              <span>×</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <label style={{ margin: 0, fontSize: '14px' }}>Height:</label>
                <input 
                  type="number" 
                  value={gridHeight}
                  onChange={(e) => setGridHeight(Math.max(1, Math.min(3, parseInt(e.target.value) || 1)))}
                  min="1"
                  max="3"
                  style={{ width: '60px' }}
                />
              </div>
            </div>
          </div>

          <ImagePicker
            label="Portrait Image (Card/Header, optional):"
            imagePreview={portraitPreview}
            selectedUrl={selectedPortraitUrl}
            folder="portrait"
            onFileSelect={handlePortraitChange}
            onUrlSelect={handlePortraitSelect}
            onAIGenerate={() => {
              // If a token image is selected, add it as a reference image for portrait generation
              if (selectedActorUrl) {
                fetch(selectedActorUrl)
                  .then(res => res.blob())
                  .then(blob => {
                    const file = new File([blob], selectedActorUrl.split('/').pop() || 'token-image.png', { type: blob.type });
                    setAIReferenceImages([file]);
                    setAIPromptTemplate('portrait');
                    setShowAIGenerator(true);
                  });
              } else {
                setAIReferenceImages([]);
                setAIPromptTemplate('portrait');
                setShowAIGenerator(true);
              }
            }}
            aiGenerateLabel="Generate Portrait"
          />

          <ImagePicker
            label="Token Image (Map, optional):"
            imagePreview={imagePreview}
            selectedUrl={selectedActorUrl}
            folder="token"
            onFileSelect={handleImageChange}
            onUrlSelect={handleActorSelect}
            tags={tags}
            onTagsChange={setTags}
            onAIGenerate={() => {
              // Use portrait as reference for generating a token image
              if (selectedPortraitUrl) {
                fetch(selectedPortraitUrl)
                  .then(res => res.blob())
                  .then(blob => {
                    const file = new File([blob], selectedPortraitUrl.split('/').pop() || 'portrait-ref.png', { type: blob.type });
                    setAIReferenceImages([file]);
                    setAIPromptTemplate('token');
                    setShowAIGenerator(true);
                  })
                  .catch(err => {
                    console.error('Failed to fetch portrait for AI reference:', err);
                    setAIReferenceImages([]);
                    setAIPromptTemplate('token');
                    setShowAIGenerator(true);
                  });
              } else if (portraitPreview && portraitPreview.startsWith('data:')) {
                fetch(portraitPreview)
                  .then(res => res.blob())
                  .then(blob => {
                    const file = new File([blob], 'portrait-ref.png', { type: blob.type });
                    setAIReferenceImages([file]);
                    setAIPromptTemplate('portrait');
                    setShowAIGenerator(true);
                  })
                  .catch(err => {
                    console.error('Failed to use portrait preview as reference:', err);
                    setAIReferenceImages([]);
                    setAIPromptTemplate('portrait');
                    setShowAIGenerator(true);
                  });
              } else {
                setAIReferenceImages([]);
                setAIPromptTemplate('portrait');
                setShowAIGenerator(true);
              }
            }}
            aiGenerateLabel="Generate Token"
          />
          {imagePreview && imagePreview.includes('/images/') && (
            <div style={{ marginTop: '-12px', marginBottom: '12px' }}>
              <button
                type="button"
                onClick={handleFlipImage}
                disabled={flippingImage}
                style={{
                  padding: '6px 12px',
                  background: '#2196F3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: flippingImage ? 'not-allowed' : 'pointer',
                  opacity: flippingImage ? 0.5 : 1,
                  fontSize: '12px'
                }}
              >
                {flippingImage ? 'Flipping...' : '🔄 Flip Image Horizontally'}
              </button>
              <p style={{ fontSize: '11px', color: '#888', marginTop: '4px', marginBottom: 0 }}>
                This will permanently flip the selected gallery image on disk
              </p>
            </div>
          )}
          {(imagePreview || color) && (
            <div className="image-preview-container">
              <p className="preview-label">Preview:</p>
              <canvas 
                ref={previewCanvasRef} 
                width={100} 
                height={100}
                className="token-preview-canvas"
              />
            </div>
          )}


          <div className="form-group">
            <label className="checkbox-label">
              <input 
                type="checkbox" 
                checked={isPlayer} 
                onChange={(e) => setIsPlayer(e.target.checked)}
              />              <span>Player Character (reveals fog of war)</span>
            </label>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>AC:</label>
              <input 
                type="number" 
                value={ac} 
                onChange={(e) => setAc(e.target.value)}
                placeholder="10"
              />
            </div>

            <div className="form-group">
              <label>HP:</label>
              <input 
                type="number" 
                value={hp} 
                onChange={(e) => setHp(e.target.value)}
                placeholder="10"
              />
            </div>

            <div className="form-group">
              <label>Initiative:</label>
              <input 
                type="number" 
                value={initiative} 
                onChange={(e) => setInitiative(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Description (optional):</label>
            <textarea 
              value={description} 
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Character description"
              rows={3}
            />
          </div>

          {imagePreview && (
            <div className="form-group">
              <label>Token Image States:</label>
              <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>
                Add different states for this token (e.g., active/inactive, healthy/injured)
              </p>
              {states.map(state => (
                <div key={state.name} style={{ 
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
                      <label style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px',
                        fontSize: '12px',
                        color: '#aaa',
                        marginTop: '4px',
                        cursor: 'pointer'
                      }}>
                        <input
                          type="checkbox"
                          checked={state.playerInteractible || false}
                          onChange={(e) => {
                            setStates(prev => prev.map(s => 
                              s.name === state.name ? { ...s, playerInteractible: e.target.checked } : s
                            ));
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                        Player Interactible
                      </label>
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
                    folder="token"
                    onFileSelect={(file) => handleUpdateStateImageFile(state.name, file)}
                    onUrlSelect={(url) => handleUpdateStateImage(state.name, url)}
                    onAIGenerate={() => {
                      setGeneratingStateFor(state.name);
                      setAIPromptTemplate('token');
                      setAIReferenceImages(imageFile ? [imageFile] : []);
                      setShowAIGenerator(true);
                    }}
                    aiGenerateLabel="Generate State Image"
                    showTags={false}
                  />
                </div>
              ))}
              {showStateImagePicker ? (
                <div style={{ 
                  marginBottom: '12px',
                  padding: '12px',
                  background: '#2a2a2a',
                  borderRadius: '4px',
                  border: '1px solid #4CAF50'
                }}>
                  <h4 style={{ marginBottom: '8px', color: '#4CAF50' }}>
                    Adding State: {showStateImagePicker}
                  </h4>
                  <ImagePicker
                    label="State Image"
                    imagePreview={null}
                    selectedUrl={null}
                    folder="token"
                    onFileSelect={(file) => handleStateFileSelect(showStateImagePicker, file)}
                    onUrlSelect={(url) => handleStateImageSelect(showStateImagePicker, url)}
                    onAIGenerate={() => {
                      setGeneratingStateFor(showStateImagePicker);
                      setAIPromptTemplate('token');
                      setAIReferenceImages(imageFile ? [imageFile] : []);
                      setShowAIGenerator(true);
                    }}
                    aiGenerateLabel="Generate State Image"
                    showTags={false}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowStateImagePicker(null);
                      setEditingStateName('');
                      setEditingStateTags('');
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
                <div style={{ marginTop: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="State name (e.g., 'lit', 'unlit')"
                      value={editingStateName}
                      onChange={(e) => setEditingStateName(e.target.value)}
                      style={{ flex: 1 }}
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
                        cursor: editingStateName.trim() ? 'pointer' : 'not-allowed',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Add State
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="btn-primary">{editingToken ? 'Update Token' : 'Create Token'}</button>
            <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          </div>
        </form>

        {showAIGenerator && (
          <AIImageGenerator
            onImageGenerated={handleAIImageGenerated}
            onClose={() => {
              setShowAIGenerator(false);
              setGeneratingStateFor(null);
              setAIReferenceImages([]);
            }}
            promptTemplate={aiPromptTemplate}
            referenceImages={aiReferenceImages}
            initialPrompt={description}
          />
        )}
      </div>
    </div>
  );
}
