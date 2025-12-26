import { useCallback } from 'react';
import { API_URL } from '../config';
import './ImageUploader.css';

interface ImageUploaderProps {
  onImageUpload: (imageUrl: string, filename: string) => void;
}

export default function ImageUploader({ onImageUpload }: ImageUploaderProps) {
  const uploadToServer = async (file: File) => {
    // Prompt user for a friendly name
    const defaultName = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
    const customName = prompt('Enter a name for this map:', defaultName);
    
    // If user cancels, don't upload
    if (customName === null) return;
    
    // Use custom name or fallback to original
    const finalName = customName.trim() || defaultName;
    
    const formData = new FormData();
    formData.append('image', file);
    formData.append('customName', finalName);

    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      console.log('Upload response:', data);
      
      // Return the server URL for the image
      const fullUrl = `${API_URL}${data.url}`;
      onImageUpload(fullUrl, data.filename);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload image. Make sure the server is running.');
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    
    // Check if this is a map URL drag (from existing maps)
    const mapUrl = e.dataTransfer.getData('mapUrl');
    if (mapUrl) {
      // Don't stop propagation - let parent handle it
      return;
    }
    
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        uploadToServer(file);
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Don't stop propagation to allow parent handlers to work
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        uploadToServer(file);
      }
    }
  }, []);

  return (
    <div
      className="image-uploader"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="upload-content">
        <svg
          className="upload-icon"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="upload-text">Drag & drop a map image here</p>
        <p className="upload-subtext">or</p>
        <label className="upload-button">
          Browse Files
          <input
            type="file"
            accept="image/*"
            onChange={handleFileInput}
            style={{ display: 'none' }}
          />
        </label>
      </div>
    </div>
  );
}
