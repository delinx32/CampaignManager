import { useState, useEffect } from 'react';
import { API_URL } from '../config';
import './ImagePicker.css';

interface ImagePickerProps {
  label: string;
  imagePreview: string | null;
  selectedUrl: string | null;
  folder: 'portrait' | 'token' | 'props' | 'misc';
  onFileSelect: (file: File) => void;
  onUrlSelect: (url: string) => void;
  onAIGenerate: () => void;
  aiGenerateLabel?: string;
  tags?: string;
  onTagsChange?: (tags: string) => void;
  showTags?: boolean;
}

interface ImageFile {
  filename: string;
  url: string;
}

interface SearchImage {
  url: string;
  thumbnail: string;
  title: string;
}

export default function ImagePicker({
  label,
  imagePreview,
  selectedUrl,
  folder,
  onFileSelect,
  onUrlSelect,
  onAIGenerate,
  aiGenerateLabel = '🎨 Generate with AI',
  tags = '',
  onTagsChange,
  showTags = true
}: ImagePickerProps) {
  const [availableImages, setAvailableImages] = useState<ImageFile[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [showSearchPopup, setShowSearchPopup] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchImage[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Load available images from the specified folder
  useEffect(() => {
    const loadImages = async () => {
      try {
        const response = await fetch(`${API_URL}/api/images?folder=${folder}`, {
          credentials: 'include'
        });
        const data = await response.json();
        // Prepend API_URL to all image URLs
        const images = (data.files || []).map((img: ImageFile) => ({
          ...img,
          url: img.url.startsWith('http') ? img.url : `${API_URL}${img.url}`
        }));
        setAvailableImages(images);
      } catch (error) {
        console.error(`Failed to load ${folder} images:`, error);
      }
    };

    loadImages();
  }, [folder]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const handleDeleteImage = async (imageUrl: string, filename: string) => {
    if (!confirm(`Delete ${filename}? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/images?url=${encodeURIComponent(imageUrl.replace(API_URL, ''))}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        // Refresh the image list
        const refreshResponse = await fetch(`${API_URL}/api/images?folder=${folder}`, {
          credentials: 'include'
        });
        const data = await refreshResponse.json();
        const images = (data.files || []).map((img: ImageFile) => ({
          ...img,
          url: img.url.startsWith('http') ? img.url : `${API_URL}${img.url}`
        }));
        setAvailableImages(images);
      } else {
        alert('Failed to delete image');
      }
    } catch (error) {
      console.error('Error deleting image:', error);
      alert('Failed to delete image');
    }
  };

  const handleSearchImages = async () => {
    if (!searchQuery.trim()) {
      return;
    }

    setIsSearching(true);
    setSearchError('');

    try {
      const response = await fetch(`${API_URL}/api/search-images?query=${encodeURIComponent(searchQuery)}`);
      
      if (!response.ok) {
        throw new Error('Failed to search images');
      }

      const data = await response.json();
      setSearchResults(data.images || []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to search images');
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchImage = async (imageUrl: string) => {
    try {
      setIsSearching(true);
      setSearchError('');

      // Download the image through our proxy to temp folder
      const response = await fetch(`${API_URL}/api/download-image?url=${encodeURIComponent(imageUrl)}`);
      if (!response.ok) {
        throw new Error('Failed to download image');
      }
      const blob = await response.blob();
      
      // Upload to temp folder
      const formData = new FormData();
      const file = new File([blob], `google-${Date.now()}.jpg`, { type: blob.type });
      formData.append('image', file);
      formData.append('type', folder);

      const uploadResponse = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload image');
      }

      const uploadData = await uploadResponse.json();
      
      // Select the uploaded image
      onUrlSelect(`${API_URL}${uploadData.url}`);
      
      // Close the search popup
      setShowSearchPopup(false);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to download image');
      console.error('Failed to download image:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchError('');
  };

  return (
    <div className="image-picker">
      <label className="image-picker-label">{label}</label>
      
      <div className="image-picker-main">
        {/* Image Preview */}
        <div className="image-picker-preview">
          {imagePreview ? (
            <img src={imagePreview} alt="Preview" />
          ) : (
            <div className="image-picker-placeholder">No image</div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="image-picker-actions">
          <label className="btn-icon" title="Choose file from computer">
            📁
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </label>
          
          <button
            type="button"
            onClick={onAIGenerate}
            className="btn-icon"
            title={aiGenerateLabel}
          >
            🎨
          </button>
          
          <button
            type="button"
            onClick={() => setShowSearchPopup(true)}
            className="btn-icon"
            title="Search Google Images"
          >
            🔍
          </button>
          
          {availableImages.length > 0 && (
            <button
              type="button"
              onClick={() => setShowGallery(!showGallery)}
              className="btn-icon"
              title={`${showGallery ? 'Hide' : 'Browse'} existing images (${availableImages.length})`}
            >
              {showGallery ? '📂' : '🖼️'}
            </button>
          )}
        </div>
      </div>

      {/* Tags Input */}
      {showTags && onTagsChange && (
        <div className="image-picker-tags">
          <input
            type="text"
            value={tags}
            onChange={(e) => onTagsChange(e.target.value)}
            placeholder="Tags (comma-separated, e.g., goblin, warrior, hostile)"
            className="tags-input"
          />
        </div>
      )}

      {/* Existing Images Gallery */}
      {showGallery && availableImages.length > 0 && (
        <div className="image-picker-gallery">
          <div className="image-picker-gallery-header">
            <p className="image-picker-gallery-label">Choose from existing images:</p>
            <button
              type="button"
              onClick={() => setShowGallery(false)}
              className="btn-close-gallery"
              title="Close gallery"
            >
              ✕
            </button>
          </div>
          <div className="image-picker-gallery-grid">
            {availableImages.map(img => (
              <div
                key={img.url}
                className={`image-picker-thumbnail ${selectedUrl === img.url ? 'selected' : ''}`}
              >
                <img 
                  src={img.url} 
                  alt={img.filename}
                  onClick={() => {
                    onUrlSelect(img.url);
                    setShowGallery(false);
                  }}
                />
                <button
                  className="btn-delete-image"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteImage(img.url, img.filename);
                  }}
                  title="Delete image"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Google Image Search Popup */}
      {showSearchPopup && (
        <div className="image-search-popup-overlay" onClick={() => setShowSearchPopup(false)}>
          <div className="image-search-popup" onClick={(e) => e.stopPropagation()}>
            <div className="image-search-header">
              <h3>Search Google Images</h3>
              <button onClick={() => setShowSearchPopup(false)} className="btn-close-popup">×</button>
            </div>
            
            <div className="image-search-controls">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearchImages()}
                placeholder="Search for images..."
                disabled={isSearching}
                className="search-input"
              />
              <button
                onClick={handleSearchImages}
                disabled={isSearching || !searchQuery.trim()}
                className="btn-search"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
              {(searchQuery || searchResults.length > 0) && (
                <button
                  onClick={handleClearSearch}
                  disabled={isSearching}
                  className="btn-clear-search"
                >
                  Clear
                </button>
              )}
            </div>

            {searchError && <div className="search-error">{searchError}</div>}

            {searchResults.length > 0 && (
              <div className="image-search-results">
                <p className="results-count">{searchResults.length} images found (click to select):</p>
                <div className="image-search-grid">
                  {searchResults.map((img, index) => (
                    <div
                      key={index}
                      className="search-result-thumb"
                      onClick={() => handleSelectSearchImage(img.url)}
                      title={img.title}
                    >
                      <img src={img.thumbnail} alt={img.title} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
