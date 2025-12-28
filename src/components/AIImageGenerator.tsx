import { useState } from 'react';
import { API_URL } from '../config';
import './AIImageGenerator.css';

interface AIImageGeneratorProps {
  onImageGenerated: (imageUrl: string, imageFile: File) => void;
  onClose: () => void;
  promptTemplate?: string;
  referenceImages?: File[];
  initialPrompt?: string;
  baseImage?: File; // Base image for editing (edits endpoint)
  galleryFolder?: string; // Folder to pick reference images from
}

interface SearchImage {
  url: string;
  thumbnail: string;
  title: string;
  width?: number;
  height?: number;
}

export default function AIImageGenerator({ onImageGenerated, onClose, promptTemplate = 'token', referenceImages: initialReferenceImages = [], initialPrompt = '', baseImage, galleryFolder }: AIImageGeneratorProps) {
  const [prompt, setPrompt] = useState(initialPrompt || '');
  const [referenceImages, setReferenceImages] = useState<File[]>(initialReferenceImages);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [generatedFilename, setGeneratedFilename] = useState<string | null>(null);
  const [generatedTemplate, setGeneratedTemplate] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchImage[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [galleryImages, setGalleryImages] = useState<Array<{filename: string, url: string}>>([]);
  const [showGallery, setShowGallery] = useState(false);

  const loadGalleryImages = async () => {
    if (!galleryFolder) return;

    try {
      const response = await fetch(
        `${API_URL}/api/image-gallery?folder=${encodeURIComponent(galleryFolder)}`,
        { credentials: 'include' }
      );

      if (!response.ok) {
        throw new Error('Failed to load gallery images');
      }

      const data = await response.json();
      setGalleryImages(data.images || []);
    } catch (err) {
      console.error('Error loading gallery images:', err);
    }
  };

  const handleSelectGalleryImage = async (imageUrl: string) => {
    try {
      const response = await fetch(`${API_URL}${imageUrl}`);
      if (!response.ok) {
        throw new Error('Failed to load image');
      }
      const blob = await response.blob();
      const filename = imageUrl.split('/').pop() || `reference-${Date.now()}.png`;
      const file = new File([blob], filename, { type: blob.type });
      
      setReferenceImages(prev => [...prev, file]);
      setShowGallery(false);
    } catch (err) {
      console.error('Failed to load gallery image:', err);
      setError('Failed to load image from gallery');
    }
  };

  const handleReferenceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setReferenceImages(prev => [...prev, ...files]);
    }
  };

  const removeReferenceImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSearchImages = async () => {
    if (!searchQuery.trim()) {
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/search-images?query=${encodeURIComponent(searchQuery)}`);
      
      if (!response.ok) {
        throw new Error('Failed to search images');
      }

      const data = await response.json();
      setSearchResults(data.images || []);
      setShowSearchResults(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search images');
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
  };

  const handleSelectSearchImage = async (imageUrl: string) => {
    try {
      // Download the image through our proxy to avoid CORS issues
      const response = await fetch(`${API_URL}/api/download-image?url=${encodeURIComponent(imageUrl)}`);
      if (!response.ok) {
        throw new Error('Failed to download image');
      }
      const blob = await response.blob();
      const file = new File([blob], `reference-${Date.now()}.jpg`, { type: blob.type });
      
      setReferenceImages(prev => [...prev, file]);
    } catch (err) {
      console.error('Failed to download image:', err);
      setError('Failed to download image');
    }
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
      
      // If there's a base image, send it for editing
      if (baseImage) {
        formData.append('baseImage', baseImage);
      }
      
      // Attach reference images for generation guidance
      referenceImages.forEach((file) => {
        formData.append('referenceImage', file);
      });

      const response = await fetch(`${API_URL}/api/generate-image`, {
        method: 'POST',
        credentials: 'include',
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
        credentials: 'include',
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
            <div className="reference-controls">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleReferenceImageUpload}
                disabled={isGenerating}
              />
              
              {galleryFolder && (
                <button
                  onClick={() => {
                    if (!showGallery) loadGalleryImages();
                    setShowGallery(!showGallery);
                  }}
                  disabled={isGenerating}
                  className="gallery-btn"
                >
                  {showGallery ? 'Close Gallery' : 'Pick from Gallery'}
                </button>
              )}
              
              <div className="image-search-controls">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearchImages()}
                  placeholder="Search for reference images..."
                  disabled={isSearching}
                  className="search-input"
                />
                <button
                  onClick={handleSearchImages}
                  disabled={isSearching || !searchQuery.trim()}
                  className="search-btn"
                >
                  {isSearching ? 'Searching...' : 'Search'}
                </button>
                {(searchQuery || showSearchResults) && (
                  <button
                    onClick={handleClearSearch}
                    disabled={isSearching}
                    className="clear-search-btn"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            
            {showGallery && (
              <div className="gallery-results">
                <div className="gallery-results-header">
                  <h4>Gallery Images ({galleryImages.length} images - click to add as reference):</h4>
                  <button onClick={() => setShowGallery(false)} className="close-search-btn">×</button>
                </div>
                <div className="search-results-grid">
                  {galleryImages.map((img, index) => (
                    <div
                      key={index}
                      className="search-result-item"
                      onClick={() => handleSelectGalleryImage(img.url)}
                      title={img.filename}
                    >
                      <img src={`${API_URL}${img.url}`} alt={img.filename} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {showSearchResults && searchResults.length > 0 && (
              <div className="search-results">
                <div className="search-results-header">
                  <h4>Search Results ({searchResults.length} images - click to add as reference):</h4>
                  <button onClick={() => setShowSearchResults(false)} className="close-search-btn">×</button>
                </div>
                <div className="search-results-grid">
                  {searchResults.map((img, index) => (
                    <div
                      key={index}
                      className="search-result-item"
                      onClick={() => handleSelectSearchImage(img.url)}
                      title={img.title}
                    >
                      <img src={img.thumbnail} alt={img.title} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            
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
