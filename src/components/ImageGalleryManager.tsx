import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';
import AppHeader from './AppHeader';
import ImagePicker from './ImagePicker';
import AIImageGenerator from './AIImageGenerator';
import './ImageGalleryManager.css';

interface ImageFile {
  filename: string;
  url: string;
  inUse: boolean;
  usedBy: string[];
}

export default function ImageGalleryManager() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedFolder, setSelectedFolder] = useState<string>('token');
  const [images, setImages] = useState<ImageFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageToDelete, setImageToDelete] = useState<string | null>(null);
  const [usageDetails, setUsageDetails] = useState<string[]>([]);
  const [processingImage, setProcessingImage] = useState<string | null>(null);
  const [flippingImage, setFlippingImage] = useState<string | null>(null);
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(Date.now());

  const folders = ['portrait', 'token', 'props', 'misc', 'temp'];

  useEffect(() => {
    loadImages();
  }, [selectedFolder]);

  const loadImages = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_URL}/api/image-gallery?folder=${encodeURIComponent(selectedFolder)}`,
        { credentials: 'include' }
      );

      if (!response.ok) {
        throw new Error('Failed to load images');
      }

      const data = await response.json();
      setImages(data.images || []);
    } catch (err) {
      console.error('Error loading images:', err);
      setError('Failed to load images');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteImage = async (imageUrl: string) => {
    const image = images.find(img => img.url === imageUrl);
    if (!image) return;

    setImageToDelete(imageUrl);
    setUsageDetails(image.usedBy);
  };

  const confirmDelete = async () => {
    if (!imageToDelete) return;

    try {
      const response = await fetch(
        `${API_URL}/api/images?url=${encodeURIComponent(imageToDelete)}`,
        {
          method: 'DELETE',
          credentials: 'include'
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete image');
      }

      // Reload images after deletion
      await loadImages();
      setImageToDelete(null);
      setUsageDetails([]);
    } catch (err: any) {
      console.error('Error deleting image:', err);
      setError(err.message || 'Failed to delete image');
      setImageToDelete(null);
      setUsageDetails([]);
    }
  };

  const cancelDelete = () => {
    setImageToDelete(null);
    setUsageDetails([]);
  };

  const handleRemoveBackground = async (imageUrl: string) => {
    setProcessingImage(imageUrl);
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}/api/images/remove-background`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ imageUrl })
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to remove background');
      }

      // Reload images to show the updated version
      await loadImages();
      setCacheBuster(Date.now()); // Force browser to reload images
      setProcessingImage(null);
    } catch (err: any) {
      console.error('Error removing background:', err);
      setError(err.message || 'Failed to remove background');
      setProcessingImage(null);
    }
  };

  const handleFlipImage = async (imageUrl: string) => {
    setFlippingImage(imageUrl);
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}/api/images/flip-horizontal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ imageUrl })
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to flip image');
      }

      // Reload images to show the updated version
      await loadImages();
      setCacheBuster(Date.now()); // Force browser to reload images
      setFlippingImage(null);
    } catch (err: any) {
      console.error('Error flipping image:', err);
      setError(err.message || 'Failed to flip image');
      setFlippingImage(null);
    }
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setSelectedUrl(null);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleUrlSelect = (url: string) => {
    setSelectedUrl(url);
    setSelectedFile(null);
    setImagePreview(url);
  };

  const handleAIGenerate = () => {
    setShowAIGenerator(true);
  };

  const handleAIImageGenerated = async () => {
    // Image is already saved by AIImageGenerator, just reload the gallery
    setShowAIGenerator(false);
    setShowUploadSection(false);
    await loadImages();
  };

  const handleUploadImage = async () => {
    if (!selectedFile && !selectedUrl) {
      setError('Please select or generate an image first');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('type', selectedFolder);

      if (selectedFile) {
        formData.append('image', selectedFile);
      } else if (selectedUrl) {
        // For URL-based images, we need to fetch and convert to blob
        const response = await fetch(selectedUrl);
        const blob = await response.blob();
        formData.append('image', blob, 'generated-image.png');
      }

      const uploadResponse = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload image');
      }

      // Reset upload state and reload images
      setSelectedFile(null);
      setSelectedUrl(null);
      setImagePreview(null);
      setShowUploadSection(false);
      await loadImages();
    } catch (err: any) {
      console.error('Error uploading image:', err);
      setError(err.message || 'Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="image-gallery-manager">
      <AppHeader 
        title="Image Gallery Manager" 
        subtitle="Manage your campaign images" 
      />
      <div className="gallery-content">
        <button onClick={() => navigate('/')} className="back-button">
          ← Back to Campaigns
        </button>

      <div className="folder-selector">
        <label>Select Folder:</label>
        <div className="folder-buttons">
          {folders.map(folder => (
            <button
              key={folder}
              className={`folder-button ${selectedFolder === folder ? 'active' : ''}`}
              onClick={() => setSelectedFolder(folder)}
            >
              {folder.charAt(0).toUpperCase() + folder.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {user?.role === 'gm' && (
        <div className="upload-section">
          <button 
            onClick={() => setShowUploadSection(!showUploadSection)}
            className="toggle-upload-button"
          >
            {showUploadSection ? '✕ Close Upload' : '+ Add New Image'}
          </button>

          {showUploadSection && (
            <div className="upload-container">
              <ImagePicker
                label={`Add image to ${selectedFolder}`}
                imagePreview={imagePreview}
                selectedUrl={selectedUrl}
                folder={selectedFolder as 'portrait' | 'token' | 'props' | 'misc'}
                onFileSelect={handleFileSelect}
                onUrlSelect={handleUrlSelect}
                onAIGenerate={handleAIGenerate}
              />
              {(selectedFile || selectedUrl) && (
                <button 
                  onClick={handleUploadImage}
                  disabled={uploading}
                  className="upload-button"
                >
                  {uploading ? 'Uploading...' : 'Upload Image'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError(null)} className="close-error">✕</button>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading images...</div>
      ) : (
        <div className="gallery-grid">
          {images.length === 0 ? (
            <div className="no-images">No images in this folder</div>
          ) : (
            images.map(image => (
              <div
                key={image.url}
                className={`image-card ${image.inUse ? 'in-use' : ''}`}
                title={image.inUse ? `Used by:\n${image.usedBy.join('\n')}` : 'Not currently in use'}
              >
                <div className="image-container">
                  <img
                    src={`${API_URL}${image.url}?t=${cacheBuster}`}
                    alt={image.filename}
                    loading="lazy"
                  />
                  {image.inUse && (
                    <div className="in-use-badge" title={`Used by:\n${image.usedBy.join('\n')}`}>
                      IN USE
                    </div>
                  )}
                </div>
                <div className="image-info">
                  <div className="image-filename" title={image.filename}>
                    {image.filename}
                  </div>
                  {user?.role === 'gm' && (
                    <div className="image-actions">
                      <button
                        onClick={() => handleRemoveBackground(image.url)}
                        className="remove-bg-button"
                        disabled={processingImage === image.url}
                        title="Remove background color"
                      >
                        {processingImage === image.url ? '⏳ Processing...' : '🎨 Remove BG'}
                      </button>
                      <button
                        onClick={() => handleFlipImage(image.url)}
                        className="flip-image-button"
                        disabled={flippingImage === image.url}
                        title="Flip image horizontally"
                      >
                        {flippingImage === image.url ? '⏳ Flipping...' : '🔄 Flip'}
                      </button>
                      <button
                        onClick={() => handleDeleteImage(image.url)}
                        className="delete-image-button"
                        title={image.inUse ? 'Delete (currently in use)' : 'Delete image'}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {showAIGenerator && (
        <AIImageGenerator
          onImageGenerated={handleAIImageGenerated}
          onClose={() => setShowAIGenerator(false)}
          promptTemplate={selectedFolder}
          galleryFolder={selectedFolder}
        />
      )}

      {imageToDelete && (
        <div className="confirmation-overlay" onClick={cancelDelete}>
          <div className="confirmation-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Image?</h3>
            {usageDetails.length > 0 ? (
              <>
                <p className="warning">⚠️ This image is currently in use by:</p>
                <ul className="usage-list">
                  {usageDetails.map((usage, index) => (
                    <li key={index}>{usage}</li>
                  ))}
                </ul>
                <p className="warning">Deleting it may cause broken image references.</p>
              </>
            ) : (
              <p>This image is not currently in use. Are you sure you want to delete it?</p>
            )}
            <div className="confirmation-actions">
              <button onClick={confirmDelete} className="confirm-delete-button">
                Delete Image
              </button>
              <button onClick={cancelDelete} className="cancel-button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
