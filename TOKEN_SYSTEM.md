# Token Image System - Implementation Guide

## Overview
The token system now supports custom images and Actor metadata for character tracking. Tokens maintain their colored circle appearance but can display uploaded images inside them.

## Features Implemented

### Token Creator Dialog
When you double-click on the map canvas, a dialog opens with:

1. **Token Color Picker**: Choose a custom color for the token's border and background
2. **Image Upload** (optional): Upload an image to display inside the token circle
3. **Actor Data** (optional):
   - **Name**: Character name
   - **AC**: Armor Class
   - **HP**: Hit Points  
   - **Description**: Character notes/description

### Data Structure

```typescript
interface Actor {
  name: string;
  ac: number;
  hp: number;
  description: string;
}

interface Token {
  id: string;
  x: number;
  y: number;
  radius: number;
  color?: string;        // Hex color (e.g., "#ff0000")
  imageUrl?: string;     // Server path to uploaded image
  actor?: Actor;         // Character metadata
}
```

### Visual Rendering

Tokens are rendered as:
1. **Colored Circle Border**: Uses the selected color (or default blue)
2. **Circular Clipping**: Image is clipped to fit inside the circle
3. **Image Inside**: Uploaded image scaled to fill the circle (if provided)

The image is rendered with a 2px inset to leave room for the colored border.

### Image Upload Process

1. User selects an image file in the token creator dialog
2. Image preview shown in the dialog
3. On submit, image uploaded to server via `/api/upload` endpoint
4. Server saves image as `token-{tokenId}-{filename}.png` in `public/images/maps/`
5. Token created with `imageUrl` pointing to uploaded image
6. Image loaded and cached in `tokenImagesRef` Map for performance
7. Token data (including image URL) synced to Player View via localStorage

### Player View Support

The Player View automatically:
- Receives token data including `imageUrl` and `actor` from localStorage sync
- Loads and caches token images in its own `tokenImagesRef` Map
- Renders tokens identically to GM view (colored circle with optional image)
- Updates every 1 second with latest token state

## Usage Instructions

### Creating a Token with Image

1. Navigate to `/gm` route
2. Load a map
3. Double-click anywhere on the canvas
4. In the dialog:
   - Pick a token color (optional - defaults to blue)
   - Upload an image (optional - click "Choose File")
   - Fill in actor data (optional):
     - Enter character name
     - Enter AC (number)
     - Enter HP (number)
     - Add description
5. Click "Create Token"
6. Token appears on map with colored border and image inside

### Creating a Simple Token

You can create tokens without images or actor data:
1. Double-click canvas
2. Just pick a color
3. Click "Create Token"
4. Token appears as a colored circle

### Moving Tokens

Same as before:
- Click and drag tokens to move them
- Fog clears along the drag path
- All token data (image, actor info) persists during movement

### Viewing on Player Screen

1. Navigate to `/player` route
2. Tokens automatically appear with same colors and images
3. Player view updates every 1 second
4. Actor data is available but not currently displayed (could be added in future enhancement)

## Technical Details

### Image Caching

- `tokenImagesRef` is a `useRef<Map<string, HTMLImageElement>>`
- Prevents re-loading images on every render
- Separate cache for GM view and Player view
- Images loaded via `useEffect` when tokens change

### Canvas Rendering

```typescript
// Draw circle border
ctx.arc(token.x, token.y, token.radius, 0, Math.PI * 2);
ctx.fillStyle = token.color || 'rgba(0, 100, 255, 0.5)';
ctx.fill();

// Draw image if available
if (token.imageUrl && tokenImg) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(token.x, token.y, token.radius - 2, 0, Math.PI * 2);
  ctx.clip(); // Clip to circle
  
  const imgSize = (token.radius - 2) * 2;
  ctx.drawImage(tokenImg, x, y, imgSize, imgSize);
  ctx.restore();
}
```

### State Synchronization

Token data synced to localStorage on every change:
```typescript
{
  backgroundImage: string,
  tokens: Token[], // Includes color, imageUrl, actor
  transform: { x, y, scale, rotation },
  fogEnabled: 'on' | 'off-all' | 'off-gm',
  // ... other state
}
```

## Future Enhancements

Potential additions:
- Display actor name/HP/AC on token hover
- Edit token dialog (right-click existing token)
- Delete individual tokens
- Token initiative tracker using actor data
- Damage tracking (update HP)
- Status effects/conditions
- Token size variants (small, medium, large, huge)
- Different token shapes (square for objects, etc.)

## Files Modified

- `src/components/MapCanvas.tsx`: Added token creator, image rendering
- `src/components/MapCanvas.css`: Added dialog styles
- `src/components/PlayerView.tsx`: Added image rendering support
- `DESIGN.md`: Updated documentation
- `TOKEN_SYSTEM.md`: This file

## Testing

Test the feature:
1. Start dev server: `npm run dev`
2. Navigate to http://localhost:5173/gm
3. Load a map
4. Double-click to create a token
5. Upload a portrait image
6. Fill in actor data
7. Create token
8. Verify image appears in circle
9. Navigate to http://localhost:5173/player
10. Verify token appears identically

All changes are live-reloaded via Vite HMR.
