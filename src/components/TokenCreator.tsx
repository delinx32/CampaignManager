import { useState, useEffect, useRef } from 'react';
import { API_URL } from '../config';
import type { Actor, Token } from '../types';
import AIImageGenerator from './AIImageGenerator';

interface TokenCreatorProps {
  onCreateToken: (actor: Actor, imageFile: File | null, color: string, actorUrl?: string) => void;
  onUpdateToken?: (tokenId: string, actor: Actor, imageFile: File | null, color: string, actorUrl?: string) => void;
  editingToken?: Token | null;
  onCancel: () => void;
  defaultPlayerMode?: boolean;
}

interface ActorFile {
  filename: string;
  url: string;
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
  const [imagePreview, setImagePreview] = useState<string | null>(editingToken?.imageUrl || null);
  const [availablePortraits, setAvailablePortraits] = useState<ActorFile[]>([]);
  const [availableTokens, setAvailableTokens] = useState<ActorFile[]>([]);
  const [selectedActorUrl, setSelectedActorUrl] = useState<string | null>(editingToken?.imageUrl || null);

  // Portrait state
  // const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const [portraitPreview, setPortraitPreview] = useState<string | null>(editingToken?.portraitUrl || null);
  const [selectedPortraitUrl, setSelectedPortraitUrl] = useState<string | null>(editingToken?.portraitUrl || null);
  const [importingPortrait, setImportingPortrait] = useState(false);
    // Portrait image upload handler
    const handlePortraitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setSelectedPortraitUrl(null);
        const reader = new FileReader();
        reader.onload = (e) => {
          setPortraitPreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);
      }
    };

    // Portrait gallery select handler (reuse availableActors for now)
    const handlePortraitSelect = (url: string) => {
      // Always treat as portrait image
      let portraitUrl = url;
      if (!url.includes('/images/actors/portrait/')) {
        portraitUrl = url.replace('/images/actors/', '/images/actors/portrait/');
      }
      setSelectedPortraitUrl(portraitUrl);
      setPortraitPreview(portraitUrl);
    };
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [aiReferenceImages, setAIReferenceImages] = useState<File[]>([]);
  const [aiPromptTemplate, setAIPromptTemplate] = useState<string>('token');
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Function to reload available actors (image gallery)
  const reloadActors = () => {
    fetch(`${API_URL}/api/actors`)
      .then(res => res.json())
      .then(data => {
        const portraits = data.actors
          .filter((a: ActorFile) => a.url.includes('/images/actors/portrait/'))
          .map((actor: ActorFile) => ({ ...actor, url: `${API_URL}${actor.url}` }));

        const tokens = data.actors
          .filter((a: ActorFile) => a.url.includes('/images/actors/token/'))
          .map((actor: ActorFile) => ({ ...actor, url: `${API_URL}${actor.url}` }));

        setAvailablePortraits(portraits);
        setAvailableTokens(tokens);
      })
      .catch(err => console.error('Failed to fetch actors:', err));
  };

  useEffect(() => {
    reloadActors();
  }, []);

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
      
      reloadActors();
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
      img.src = imagePreview;
    }
  }, [color, imagePreview]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setSelectedActorUrl(null);
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleActorSelect = (url: string) => {
    // Always treat as token image
    let tokenUrl = url;
    if (!url.includes('/images/actors/token/')) {
      tokenUrl = url.replace('/images/actors/', '/images/actors/token/');
    }
    setSelectedActorUrl(tokenUrl);
    setImageFile(null);
    setImagePreview(tokenUrl);
  };

  const handleAIImageGenerated = (imageUrl: string, imageFile: File) => {
    // If AI generator is for portrait, update portrait preview, else map image
    if (showAIGenerator && portraitPreview !== null) {
      setPortraitPreview(`${API_URL}/images/actors/portrait/${imageUrl}`);
      setSelectedPortraitUrl(`${API_URL}/images/actors/portrait/${imageUrl}`);
    } else {
      setImageFile(imageFile);
      setSelectedActorUrl(null);
      setImagePreview(`${API_URL}/images/actors/token/${imageUrl}`);
    }
    setShowAIGenerator(false);
    // Refresh the gallery after AI image is generated
    reloadActors();
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

    // Compose image file and url
    const imageFileToSend: File | null = imageFile || null;
    const imageUrlToSend: string | undefined = !imageFile && selectedActorUrl ? selectedActorUrl : undefined;
    // Compose portrait file and url
    // (portraitFileToSend and portraitUrlToSend removed; not used yet)

    if (editingToken && onUpdateToken) {
      // For now, pass portraitUrl as 5th arg (actorUrl), and imageFile as 3rd arg, imageUrl as 5th if no portraitUrl
      // You will need to update the parent handler to support portraitUrl
      onUpdateToken(
        editingToken.id,
        actor,
        imageFileToSend,
        color,
        imageUrlToSend
      );
      // TODO: Add portrait support to parent handler
    } else {
      onCreateToken(
        actor,
        imageFileToSend,
        color,
        imageUrlToSend
      );
      // TODO: Add portrait support to parent handler
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
            <label>Portrait Image (Card/Header, optional):</label>
            <div className="image-upload-options">
              <input 
                type="file" 
                accept="image/*"
                onChange={handlePortraitChange}
              />
              <button 
                type="button" 
                onClick={() => {
                  // If a token image is selected, add it as a reference image for portrait generation
                  if (selectedActorUrl) {
                    // Fetch the image as a blob and create a File object
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
                className="btn-ai-generate"
              >
                🎨 Generate with AI
              </button>
            </div>
            {availablePortraits.length > 0 && (
              <div className="actor-gallery">
                <p className="actor-gallery-label">Or choose from existing:</p>
                <div className="actor-gallery-grid">
                  {availablePortraits.map(actor => (
                    <div 
                      key={actor.url}
                      className={`actor-thumbnail ${selectedPortraitUrl === actor.url ? 'selected' : ''}`}
                      onClick={() => handlePortraitSelect(actor.url)}
                    >
                      <img src={actor.url} alt={actor.filename} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {portraitPreview && (
              <div className="image-preview-container">
                <p className="preview-label">Portrait Preview:</p>
                <img src={portraitPreview} alt="Portrait Preview" style={{ width: 80, height: 80, borderRadius: '50%' }} />
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Token Image (Map, optional):</label>
            <div className="image-upload-options">
              <input 
                type="file" 
                accept="image/*"
                onChange={handleImageChange}
              />
                <button 
                  type="button" 
                  onClick={() => {
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
                      // If portraitPreview is an inline data URL (uploaded file), convert to blob
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
                  className="btn-ai-generate"
                >
                  🎨 Generate with AI
                </button>
            </div>
            {availableTokens.length > 0 && (
              <div className="actor-gallery">
                <p className="actor-gallery-label">Or choose from existing:</p>
                <div className="actor-gallery-grid">
                  {availableTokens.map(actor => (
                    <div 
                      key={actor.url}
                      className={`actor-thumbnail ${selectedActorUrl === actor.url ? 'selected' : ''}`}
                      onClick={() => handleActorSelect(actor.url)}
                    >
                      <img src={actor.url} alt={actor.filename} />
                    </div>
                  ))}
                </div>
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
          </div>


          <div className="form-group">
            <label className="checkbox-label">
              <input 
                type="checkbox" 
                checked={isPlayer} 
                onChange={(e) => setIsPlayer(e.target.checked)}
              />
              <span>Player Character (reveals fog of war)</span>
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

          

          <div className="form-actions">
            <button type="submit" className="btn-primary">{editingToken ? 'Update Token' : 'Create Token'}</button>
            <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          </div>
        </form>

        {showAIGenerator && (
          <AIImageGenerator
            onImageGenerated={handleAIImageGenerated}
            onClose={() => setShowAIGenerator(false)}
            promptTemplate={aiPromptTemplate}
            referenceImages={aiReferenceImages}
            initialPrompt={description}
          />
        )}
      </div>
    </div>
  );
}
