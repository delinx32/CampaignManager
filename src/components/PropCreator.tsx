import { useState } from 'react';
import type { Prop } from '../types';
import AIImageGenerator from './AIImageGenerator';

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
  const [imagePreview, setImagePreview] = useState<string | null>(editingProp?.imageUrl || null);
  const [color, setColor] = useState(editingProp?.color || generateRandomColor());
  const [showAIGenerator, setShowAIGenerator] = useState(false);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setImagePreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const propData: Omit<Prop, 'id'> = {
      name,
      description,
      imageUrl: imagePreview || undefined,
      color,
      x: 0, // Will be set by MapCanvas
      y: 0, // Will be set by MapCanvas  
      radius: 0 // Will be set by MapCanvas
    };

    if (editingProp && onUpdateProp) {
      onUpdateProp(editingProp.id, propData, imageFile);
    } else {
      onCreateProp(propData, imageFile);
    }
  };

  const handleImageGenerated = (url: string, file: File) => {
    setImagePreview(url);
    setImageFile(file);
    setShowAIGenerator(false);
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
              onClose={() => setShowAIGenerator(false)}
              promptTemplate="props"
              initialPrompt={description}
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

            <div className="form-group">
              <label>Image:</label>
              {imagePreview && (
                <div style={{ marginBottom: '8px' }}>
                  <img src={imagePreview} alt="Preview" style={{ maxWidth: '200px', maxHeight: '200px', display: 'block' }} />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
              />
              <button
                type="button"
                onClick={() => setShowAIGenerator(true)}
                className="btn-ai-generate"
              >
                🎨 Generate with AI
              </button>
            </div>

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