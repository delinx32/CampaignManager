import { useState } from 'react';
import { API_URL } from '../config';
import './AIImageGenerator.css';

interface AIImageGeneratorProps {
  onImageGenerated: (imageUrl: string, imageFile: File) => void;
  onClose: () => void;
  promptTemplate?: string;
  referenceImages?: File[];
  initialPrompt?: string;
}

export default function AIImageGenerator({ onImageGenerated, onClose, promptTemplate = 'token', referenceImages: initialReferenceImages = [], initialPrompt = '' }: AIImageGeneratorProps) {
  const [prompt, setPrompt] = useState(initialPrompt || '');
  const [referenceImages, setReferenceImages] = useState<File[]>(initialReferenceImages);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [generatedFilename, setGeneratedFilename] = useState<string | null>(null);
  const [generatedTemplate, setGeneratedTemplate] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReferenceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setReferenceImages(prev => [...prev, ...files]);
    }
  };

  const removeReferenceImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedImageUrl(null);

    try {
      const formData = new FormData();
      formData.append('prompt', prompt);
      formData.append('template', promptTemplate);
      
      // Attach reference images (use the same field name so multer's upload.array accepts them)
      referenceImages.forEach((file) => {
        formData.append('referenceImage', file);
      });

      const response = await fetch(`${API_URL}/api/generate-image`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate image');
      }

      const data = await response.json();
      setGeneratedImageUrl(data.imageUrl);
      setGeneratedFilename(data.filename);
      setGeneratedTemplate(data.template);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate image');
      console.error('Generation error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveImage = async () => {
    if (!generatedImageUrl || !generatedFilename || !generatedTemplate) return;

    try {
      // Call backend to move image from temp to final folder
      const response = await fetch(`${API_URL}/api/confirm-ai-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          filename: generatedFilename, 
          template: generatedTemplate 
        })
      });

      if (!response.ok) {
        throw new Error('Failed to confirm AI image');
      }

      const data = await response.json();
      
      // Download the final image
      const imageResponse = await fetch(`${API_URL}${data.imageUrl}`);
      const blob = await imageResponse.blob();
      const file = new File([blob], generatedFilename, { type: 'image/png' });
      
      onImageGenerated(data.imageUrl, file);
      onClose();
    } catch (err) {
      setError('Failed to save image');
      console.error('Save error:', err);
    }
  };

  return (
    <div className="ai-image-generator-overlay">
      <div className="ai-image-generator">
        <div className="ai-generator-header">
          <h2>AI Image Generator</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <div className="ai-generator-content">
          <div className="prompt-section">
            <label htmlFor="prompt">Describe the image you want to generate:</label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., A fierce red dragon breathing fire, fantasy art style, detailed scales"
              rows={4}
              disabled={isGenerating}
            />
          </div>

          <div className="reference-images-section">
            <label>Reference Images (optional):</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleReferenceImageUpload}
              disabled={isGenerating}
            />
            
            {referenceImages.length > 0 && (
              <div className="reference-images-preview">
                {referenceImages.map((file, index) => (
                  <div key={index} className="reference-image-item">
                    <img 
                      src={URL.createObjectURL(file)} 
                      alt={`Reference ${index + 1}`}
                    />
                    <button 
                      onClick={() => removeReferenceImage(index)}
                      disabled={isGenerating}
                      className="remove-ref-btn"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {generatedImageUrl && (
            <div className="generated-image-section">
              <h3>Generated Image:</h3>
              <img src={`${API_URL}${generatedImageUrl}`} alt="Generated" />
            </div>
          )}

          <div className="ai-generator-actions">
            <button 
              onClick={handleGenerate} 
              disabled={isGenerating || !prompt.trim()}
              className="generate-btn"
            >
              {isGenerating ? 'Generating...' : 'Generate Image'}
            </button>
            
            {generatedImageUrl && (
              <button 
                onClick={handleSaveImage}
                className="save-btn"
              >
                Use This Image
              </button>
            )}
            
            <button onClick={onClose} className="cancel-btn">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
