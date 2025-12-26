# D&D Campaign Manager

A React web application to help Game Masters run Dungeons & Dragons campaigns with interactive map management.

## Features

- **Drag & Drop Image Upload**: Upload battle maps by dragging and dropping image files
- **Interactive Map Controls**: 
  - Pan the map by clicking and dragging
  - Zoom in/out using mouse wheel
  - Rotate the map with control buttons
- **Fog of War System**: Dynamic fog that reveals areas around player tokens
- **Player Tokens**: Double-click on the map to place player tokens that automatically reveal the fog around them
- **AI Image Generation**: Generate custom token images using OpenAI's DALL-E 3
  - Describe your character or creature in natural language
  - Optionally attach reference images for style guidance
  - Automatically saves generated images to your actor library

## Getting Started

### Prerequisites

For AI image generation, you'll need an OpenAI API key:
1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a `.env` file in the `server/` directory
3. Add your key: `OPENAI_API_KEY=your_key_here`

See `server/.env.example` for reference.

### Development

```bash
npm run dev
```

Visit [http://localhost:5173](http://localhost:5173) to view the application.

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## How to Use

1. **Upload a Map**: Drag and drop a battle map image onto the upload area, or click "Browse Files"
2. **Add Player Tokens**: Double-click anywhere on the map to add a player token
3. **Navigate the Map**:
   - Scroll to zoom in/out
   - Click and drag to pan
   - Use the rotate buttons to change the map orientation
4. **Fog of War**: The fog automatically reveals around player tokens as you move them
5. **Clear Tokens**: Use the "Clear Tokens" button to remove all player tokens
6. **Upload New Map**: Click "Upload New Map" to start with a different battle map

## Tech Stack

- React 19
- TypeScript
- Vite
- HTML5 Canvas for rendering

## Project Structure

```
src/
├── components/
│   ├── ImageUploader.tsx    # Drag & drop image upload component
│   ├── ImageUploader.css
│   ├── MapCanvas.tsx         # Main canvas with map controls and fog of war
│   └── MapCanvas.css
├── App.tsx                   # Main application component
├── App.css
└── index.css
```
