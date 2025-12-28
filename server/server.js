
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { passport, sessionMiddleware, requireAuth, requireGM, isOAuthConfigured } from './auth.js';

// Load environment variables from .env file in parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Load settings.json for API keys
let googleSearchApiKey = null;
let googleSearchEngineId = null;
try
{
  const settingsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'settings.json');
  if (fs.existsSync(settingsPath))
  {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    googleSearchApiKey = settings.googleSearchApiKey || null;
    googleSearchEngineId = settings.googleSearchEngineId || null;
  }
} catch (err)
{
  console.warn('Could not load settings.json:', err);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for the Vite dev server (development only)
if (process.env.NODE_ENV !== 'production')
{
  app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
  }));
}

// Parse JSON bodies
app.use(express.json());

// Session and passport middleware
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

// Middleware to provide current share key in requests
const provideShareKey = (req, res, next) => {
  if (req.user && req.user.currentShareKey) {
    req.shareKey = req.user.currentShareKey;
  }
  next();
};

app.use(provideShareKey);

const usersDir = path.join(__dirname, 'users');

// Ensure users directory exists
if (!fs.existsSync(usersDir))
{
  fs.mkdirSync(usersDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) =>
  {
    // Use user-specific temp folder
    const shareKey = req.shareKey;
    if (!shareKey) {
      return cb(new Error('No share key available'));
    }
    const userTempDir = path.join(usersDir, shareKey, 'images', 'temp');
    if (!fs.existsSync(userTempDir)) {
      fs.mkdirSync(userTempDir, { recursive: true });
    }
    cb(null, userTempDir);
  },
  filename: (req, file, cb) =>
  {
    // Get custom name from request body, or use original filename
    const customName = req.body.customName || file.originalname.replace(/\.[^/.]+$/, '');
    // Sanitize the custom name (remove special characters)
    const safeName = customName.replace(/[^a-zA-Z0-9-_\s]/g, '').replace(/\s+/g, '-');
    // Get file extension
    const ext = path.extname(file.originalname);
    // Create unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${safeName}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) =>
  {
    if (file.mimetype.startsWith('image/'))
    {
      cb(null, true);
    } else
    {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// ===========================
// Authentication Routes
// ===========================

if (isOAuthConfigured) {
  // Google OAuth login
  app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  // Google OAuth callback
  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: 'http://localhost:5173/login?error=auth_failed' }),
    (req, res) => {
      // Successful authentication, redirect to GM view
      res.redirect('http://localhost:5173/');
    }
  );
} else {
  // OAuth not configured - return helpful error
  app.get('/auth/google', (req, res) => {
    res.status(503).send('OAuth not configured. Please add Google OAuth credentials to settings.json');
  });
  
  app.get('/auth/google/callback', (req, res) => {
    res.status(503).send('OAuth not configured. Please add Google OAuth credentials to settings.json');
  });
}

// Logout
app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// Check authentication status
app.get('/auth/status', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        picture: req.user.picture,
        role: req.user.role,
        accessibleShareKeys: req.user.accessibleShareKeys || [],
        currentShareKey: req.user.currentShareKey || null
      }
    });
  } else {
    res.json({ authenticated: false, oauthConfigured: isOAuthConfigured });
  }
});

// Get active sessions for a share key (public endpoint, no auth required)
// Only returns sessions that are currently active (GM has started session)
app.get('/api/sharekey/:shareKey/sessions', (req, res) => {
  const { shareKey } = req.params;

  try {
    const shareKeyPath = path.join(__dirname, 'users', shareKey);
    if (!fs.existsSync(shareKeyPath)) {
      return res.status(404).json({ error: 'Share key not found', campaigns: [] });
    }

    // Check if there's a currently active session for this share key
    // Active session is tracked by currentShareKey, currentCampaign, currentSessionName, and isSessionActive
    if (!isSessionActive || currentShareKey !== shareKey || !currentCampaign || !currentSessionName) {
      return res.json({ campaigns: [] });
    }

    // Return only the currently active session
    const campaignPath = path.join(shareKeyPath, 'campaigns', currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName);
    const metadataPath = path.join(sessionPath, '.session-metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return res.json({ campaigns: [] });
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    
    const campaigns = [{
      campaignName: currentCampaign,
      sessions: [{
        sessionName: currentSessionName,
        currentScenario: metadata.currentScenario || currentScenario,
        lastPlayed: metadata.lastPlayed || metadata.createdAt
      }]
    }];

    res.json({ campaigns });
  } catch (err) {
    console.error('Error loading active sessions:', err);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// ===========================
// End Authentication Routes
// ===========================

// Upload endpoint
app.post('/api/upload', requireGM, upload.single('image'), (req, res) =>
{
  if (!req.file)
  {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!req.shareKey)
  {
    return res.status(401).json({ error: 'No share key available' });
  }

  // Determine folder: portrait, token, props, misc, or maps
  let folder = 'maps';
  if (req.body.type === 'portrait') folder = 'portrait';
  else if (req.body.type === 'token') folder = 'token';
  else if (req.body.type === 'props') folder = 'props';
  else if (req.body.type === 'misc') folder = 'misc';

  // Save to user's share key folder: /users/{shareKey}/images/{type}/
  const userImagesDir = path.join(usersDir, req.shareKey, 'images', folder);
  
  // Ensure the directory exists
  if (!fs.existsSync(userImagesDir))
  {
    fs.mkdirSync(userImagesDir, { recursive: true });
  }
  
  const userTempDir = path.join(usersDir, req.shareKey, 'images', 'temp');
  const oldPath = path.join(userTempDir, req.file.filename);
  const newPath = path.join(userImagesDir, req.file.filename);
  
  // Move from temp to final destination
  try
  {
    fs.renameSync(oldPath, newPath);
    console.log(`File moved from temp to ${folder} for share key ${req.shareKey}:`, req.file.filename);
  } catch (err)
  {
    console.error('Failed to move file:', err);
    return res.status(500).json({ error: `Failed to move file to ${folder} folder` });
  }

  const imageUrl = `/users/${req.shareKey}/images/${folder}/${req.file.filename}`;
  console.log('File uploaded:', req.file.filename, 'to', folder, 'for share key', req.shareKey);

  res.json({
    success: true,
    filename: req.file.filename,
    url: imageUrl
  });
});

// AI Image Generation endpoint
app.post('/api/generate-image', requireAuth, upload.fields([{ name: 'baseImage', maxCount: 1 }, { name: 'referenceImage', maxCount: 5 }]), async (req, res) =>
{
  try
  {
    const { prompt, template = 'token' } = req.body;

    if (!prompt)
    {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Get OpenAI API key from share key settings
    const shareKey = req.shareKey;
    if (!shareKey) {
      return res.status(401).json({ error: 'No share key selected' });
    }
    
    const shareKeyPath = path.join(usersDir, shareKey, '.user.json');
    let apiKey = null;
    
    if (fs.existsSync(shareKeyPath)) {
      try {
        const shareKeyData = JSON.parse(fs.readFileSync(shareKeyPath, 'utf-8'));
        apiKey = shareKeyData.openaiApiKey;
      } catch (err) {
        console.error('Error reading share key settings:', err);
      }
    }
    
    if (!apiKey)
    {
      return res.status(500).json({
        error: 'OpenAI API key not configured for this share key. Please add your OpenAI API key in the settings.'
      });
    }

    // Load base template with common image generation instructions
    const baseTemplatePath = path.join(__dirname, 'prompt-templates', 'base.txt');
    let basePrompt = '';
    try
    {
      basePrompt = fs.readFileSync(baseTemplatePath, 'utf-8');
    } catch (err)
    {
      console.warn('Could not load base.txt template');
    }

    // Load specific template based on template name
    const templatePath = path.join(__dirname, 'prompt-templates', `${template}.txt`);
    let specificPrompt = '';

    try
    {
      specificPrompt = fs.readFileSync(templatePath, 'utf-8');
      console.log(`Loaded template: ${template}.txt`);
    } catch (err)
    {
      console.warn(`Could not load template ${template}.txt, using default`);
      specificPrompt = 'Create a fantasy art image suitable for a D&D game.';
    }

    // Combine base and specific prompts
    const systemPrompt = basePrompt ? `${basePrompt}\n\n${specificPrompt}` : specificPrompt;

    // Build the full prompt
    const fullPrompt = `${systemPrompt}\n\nUser request: ${prompt}`;

    // Get baseImage and referenceImages from multer
    const baseImage = req.files?.baseImage?.[0];
    const referenceImages = req.files?.referenceImage || [];

    // If reference images are present, add instruction to use them
    let promptToSend = fullPrompt;
    if (referenceImages.length > 0)
    {
      promptToSend += '\n\nPlease use the attached reference images as style and character guides.  ';
    }

    if (baseImage)
    {
      promptToSend += '\n\nPlease use the attached base image as a guide for composition and layout.  Maintain the same perspective and positioning as closely as possible. try to match the reference images perspective, style, positioning, size, and colors as closely as possible.';

    }
    // Strip HTML tags from promptToSend
    promptToSend = promptToSend.replace(/<[^>]+>/g, '');
    console.log('Generating image with prompt:', promptToSend);
    console.log('Base image:', baseImage ? baseImage.filename : 'none');
    console.log('Reference images:', referenceImages.length);

    // Use gpt-image-1 model
    const model = 'gpt-image-1';
    
    // Define user temp directory once at the top
    const userTempDir = path.join(usersDir, shareKey, 'images', 'temp');

    // Helper to get mime type from filename or file object
    const getMimeType = (file) =>
    {
      // If it's a file object with originalname, use that
      const filename = typeof file === 'string' ? file : (file.originalname || file.filename || '');
      const ext = path.extname(filename).toLowerCase();
      if (ext === '.png') return 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
      if (ext === '.webp') return 'image/webp';
      if (ext === '.gif') return 'image/gif';
      return 'image/png'; // Default to PNG for images
    };

    // If a base image was uploaded, use the edits endpoint
    let filename;
    if (baseImage)
    {
      try
      {
        // Use the base image for editing
        const refPath = path.join(userTempDir, baseImage.filename);
        const buffer = fs.readFileSync(refPath);
        const mime = getMimeType(baseImage.filename);
        const blob = new Blob([buffer], { type: mime });

        // Use manual multipart POST to the edits endpoint
        const form = new FormData();
        form.append('image', blob, baseImage.filename);
        form.append('prompt', promptToSend);
        form.append('model', 'gpt-image-1');
        form.append('n', '1');
        form.append('size', '1024x1024');
        form.append('quality', 'medium');
        form.append('background', 'transparent');
        form.append('output_format', 'png');

        const manualResp = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`
          },
          body: form
        });

        if (!manualResp.ok)
        {
          const errBody = await manualResp.text();
          console.warn('Manual edits POST failed:', manualResp.status, errBody);
          throw new Error(`Manual edits POST failed: ${manualResp.status}`);
        }
        
        const editResponse = await manualResp.json();

        // The SDK may return base64 content or a URL in various shapes depending on SDK version
        const out = editResponse?.data?.[0] || editResponse?.output?.[0] || null;
        let imageBuffer = null;
        if (out?.b64_json)
        {
          imageBuffer = Buffer.from(out.b64_json, 'base64');
        } else if (out?.url)
        {
          const r = await fetch(out.url);
          const ab = await r.arrayBuffer();
          imageBuffer = Buffer.from(ab);
        } else if (out && typeof out === 'string' && out.startsWith('data:'))
        {
          // sometimes the SDK may return a data URI string
          const parts = out.split(',');
          imageBuffer = Buffer.from(parts[1], 'base64');
        }

        if (!imageBuffer)
        {
          console.error('OpenAI edit response did not contain an image. Response snippet:',
            JSON.stringify(Object.keys(editResponse || {}).reduce((acc, k) => ({ ...acc, [k]: typeof editResponse[k] }), {}))
          );
          console.error('Full editResponse (truncated):', JSON.stringify(editResponse, null, 2).slice(0, 4000));
          throw new Error('No image returned from OpenAI edits; see server logs for details');
        }

        // Remove background based on top-left corner color
        try {
          const image = sharp(imageBuffer);
          const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
          
          // Get top-left corner pixel color (RGBA)
          const r = data[0];
          const g = data[1];
          const b = data[2];
          
          console.log(`Detected background color: RGB(${r}, ${g}, ${b}), channels: ${info.channels}`);
          
          // Create a new buffer with transparency
          const pixelCount = info.width * info.height;
          const newData = Buffer.alloc(pixelCount * 4); // RGBA
          
          // Tolerance for color matching - increased for better matching
          const tolerance = 50;
          let transparentPixels = 0;
          
          for (let i = 0; i < pixelCount; i++) {
            const srcOffset = i * info.channels;
            const dstOffset = i * 4;
            
            const pr = data[srcOffset];
            const pg = data[srcOffset + 1];
            const pb = data[srcOffset + 2];
            
            // Check if pixel matches background color (within tolerance)
            const isBackground = 
              Math.abs(pr - r) <= tolerance &&
              Math.abs(pg - g) <= tolerance &&
              Math.abs(pb - b) <= tolerance;
            
            if (isBackground) {
              // Make transparent
              newData[dstOffset] = 0;
              newData[dstOffset + 1] = 0;
              newData[dstOffset + 2] = 0;
              newData[dstOffset + 3] = 0;
              transparentPixels++;
            } else {
              // Keep original color
              newData[dstOffset] = pr;
              newData[dstOffset + 1] = pg;
              newData[dstOffset + 2] = pb;
              newData[dstOffset + 3] = 255;
            }
          }
          
          console.log(`Made ${transparentPixels} out of ${pixelCount} pixels transparent (${(transparentPixels/pixelCount*100).toFixed(1)}%)`);
          
          // Create new PNG with transparency
          imageBuffer = await sharp(newData, {
            raw: {
              width: info.width,
              height: info.height,
              channels: 4
            }
          }).png().toBuffer();
          
          console.log('Background removed successfully');
        } catch (bgRemovalErr) {
          console.error('Background removal failed, using original image:', bgRemovalErr.message);
          console.error(bgRemovalErr.stack);
        }

        filename = `ai-generated-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
        if (!fs.existsSync(userTempDir)) {
          fs.mkdirSync(userTempDir, { recursive: true });
        }
        const savePath = path.join(userTempDir, filename);
        fs.writeFileSync(savePath, imageBuffer);
        console.log('AI-edited image saved to temp:', filename);
      } catch (err)
      {
        console.error('OpenAI SDK images.edits error:', err);
        return res.status(500).json({ error: err.message || 'OpenAI images.edits failed' });
      }
    } else
    {
      console.log('Using gpt-image-1 for image generation');

      // No reference images — use gpt-image-1 for generation
      const requestBody = {
        model: 'gpt-image-1',
        prompt: promptToSend,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
        output_format: 'png'
      };

      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok)
      {
        const errorData = await response.json();
        console.error('OpenAI API error:', errorData);
        return res.status(response.status).json({
          error: errorData.error?.message || 'Failed to generate image'
        });
      }

      const data = await response.json();
      console.log('OpenAI response data:', JSON.stringify(data, null, 2));

      // Handle different response formats
      let generatedImageUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json;

      if (!generatedImageUrl)
      {
        console.error('No image URL or data in response:', data);
        throw new Error('No image returned from OpenAI');
      }

      let imageBuffer;

      // If it's a base64 string, decode it directly
      if (generatedImageUrl.startsWith('data:') || !generatedImageUrl.startsWith('http'))
      {
        // It's base64 data
        const base64Data = generatedImageUrl.includes(',')
          ? generatedImageUrl.split(',')[1]
          : generatedImageUrl;
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else
      {
        // It's a URL, download it
        const imageResponse = await fetch(generatedImageUrl);
        imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      }

      // Remove background based on top-left corner color
      try {
        const image = sharp(imageBuffer);
        const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
        
        // Get top-left corner pixel color (RGBA)
        const r = data[0];
        const g = data[1];
        const b = data[2];
        
        console.log(`Detected background color: RGB(${r}, ${g}, ${b}), channels: ${info.channels}`);
        
        // Create a new buffer with transparency
        const pixelCount = info.width * info.height;
        const newData = Buffer.alloc(pixelCount * 4); // RGBA
        
        // Tolerance for color matching - increased for better matching
        const tolerance = 50;
        let transparentPixels = 0;
        
        for (let i = 0; i < pixelCount; i++) {
          const srcOffset = i * info.channels;
          const dstOffset = i * 4;
          
          const pr = data[srcOffset];
          const pg = data[srcOffset + 1];
          const pb = data[srcOffset + 2];
          
          // Check if pixel matches background color (within tolerance)
          const isBackground = 
            Math.abs(pr - r) <= tolerance &&
            Math.abs(pg - g) <= tolerance &&
            Math.abs(pb - b) <= tolerance;
          
          if (isBackground) {
            // Make transparent
            newData[dstOffset] = 0;
            newData[dstOffset + 1] = 0;
            newData[dstOffset + 2] = 0;
            newData[dstOffset + 3] = 0;
            transparentPixels++;
          } else {
            // Keep original color
            newData[dstOffset] = pr;
            newData[dstOffset + 1] = pg;
            newData[dstOffset + 2] = pb;
            newData[dstOffset + 3] = 255;
          }
        }
        
        console.log(`Made ${transparentPixels} out of ${pixelCount} pixels transparent (${(transparentPixels/pixelCount*100).toFixed(1)}%)`);
        
        // Create new PNG with transparency
        imageBuffer = await sharp(newData, {
          raw: {
            width: info.width,
            height: info.height,
            channels: 4
          }
        }).png().toBuffer();
        
        console.log('Background removed successfully');
      } catch (bgRemovalErr) {
        console.error('Background removal failed, using original image:', bgRemovalErr.message);
        console.error(bgRemovalErr.stack);
      }

      filename = `ai-generated-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
      if (!fs.existsSync(userTempDir)) {
        fs.mkdirSync(userTempDir, { recursive: true });
      }
      const savePath = path.join(userTempDir, filename);
      fs.writeFileSync(savePath, Buffer.from(imageBuffer));
      console.log('AI-generated image saved to temp:', filename);
    }

    const imageUrl = `/users/${shareKey}/images/temp/${filename}`;


    res.json({
      success: true,
      imageUrl,
      filename,
      template
    });

  } catch (err)
  {
    console.error('Image generation error:', err);
    res.status(500).json({
      error: err.message || 'Failed to generate image'
    });
  }
});

// Move AI-generated image from temp to final folder
app.post('/api/confirm-ai-image', requireAuth, express.json(), async (req, res) =>
{
  try
  {
    const { filename, template } = req.body;

    if (!filename || !template)
    {
      return res.status(400).json({ error: 'filename and template required' });
    }

    const shareKey = req.shareKey;
    if (!shareKey) {
      return res.status(401).json({ error: 'No share key available' });
    }

    const userTempDir = path.join(usersDir, shareKey, 'images', 'temp');
    const tempPath = path.join(userTempDir, filename);
    
    if (!fs.existsSync(tempPath))
    {
      return res.status(404).json({ error: 'Temp file not found' });
    }

    // Use template name directly for folder path
    const targetSubfolder = path.join(usersDir, shareKey, 'images', template);
    
    // Ensure target directory exists
    if (!fs.existsSync(targetSubfolder)) {
      fs.mkdirSync(targetSubfolder, { recursive: true });
    }
    
    const finalPath = path.join(targetSubfolder, filename);

    // Move file from temp to final location
    fs.renameSync(tempPath, finalPath);

    // Use template name directly in URL path
    const imageUrl = `/users/${shareKey}/images/${template}/${filename}`;

    console.log('AI image confirmed and moved:', filename, 'to', targetSubfolder);

    res.json({ success: true, imageUrl, filename });
  } catch (err)
  {
    console.error('Confirm AI image error:', err);
    res.status(500).json({ error: 'Failed to confirm AI image' });
  }
});

// Search for reference images using Google Custom Search API
app.get('/api/search-images', async (req, res) =>
{
  try
  {
    const { query } = req.query;
    
    if (!query || typeof query !== 'string')
    {
      return res.status(400).json({ error: 'Query parameter required' });
    }

    // Using Google Custom Search JSON API
    // You'll need to set these in settings.json:
    // googleSearchApiKey and googleSearchEngineId
    const apiKey = googleSearchApiKey || process.env.GOOGLE_SEARCH_API_KEY || 'YOUR_API_KEY';
    const searchEngineId = googleSearchEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID || 'YOUR_SEARCH_ENGINE_ID';
    
    if (apiKey === 'YOUR_API_KEY' || searchEngineId === 'YOUR_SEARCH_ENGINE_ID')
    {
      // Fallback: return mock data for development
      console.warn('Google API keys not configured. Returning empty results.');
      return res.json({ images: [] });
    }

    // Google Custom Search API allows max 10 results per call
    // To get 50 results, we need to make 5 calls with different start positions
    const allImages = [];
    const callsToMake = 5; // 5 calls x 10 results = 50 total
    
    for (let i = 0; i < callsToMake; i++) {
      const start = i * 10 + 1;
      const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&searchType=image&num=10&start=${start}`;
      
      try {
        const response = await fetch(searchUrl);
        
        if (!response.ok) {
          console.warn(`Google API call ${i + 1} failed: ${response.status}`);
          break; // Stop if we hit an error
        }

        const data = await response.json();
        const images = (data.items || []).map(item => ({
          url: item.link,
          thumbnail: item.image?.thumbnailLink || item.link,
          title: item.title,
          width: item.image?.width,
          height: item.image?.height
        }));
        
        allImages.push(...images);
        
        // If we got fewer than 10 results, we've reached the end
        if (images.length < 10) break;
      } catch (err) {
        console.warn(`Error fetching page ${i + 1}:`, err.message);
        break;
      }
    }

    res.json({ images: allImages });
  } catch (err)
  {
    console.error('Image search error:', err);
    res.status(500).json({ error: 'Failed to search images' });
  }
});

// Proxy endpoint to download images and return as blob
app.get('/api/download-image', async (req, res) =>
{
  const { url } = req.query;

  if (!url || typeof url !== 'string')
  {
    return res.status(400).json({ error: 'URL parameter required' });
  }

  try
  {
    // Only allow http/https
    if (!/^https?:\/\//i.test(url))
    {
      return res.status(400).json({ error: 'Only http(s) URLs are supported' });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok)
    {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/'))
    {
      return res.status(400).json({ error: 'URL does not point to an image' });
    }

    const buffer = await response.arrayBuffer();
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(buffer));
  } catch (err)
  {
    console.error('Image download error:', err);
    res.status(500).json({ error: 'Failed to download image' });
  }
});

// Proxy endpoint to fetch external pages and serve them from same origin
app.get('/api/proxy', async (req, res) =>
{
  const { url } = req.query;

  if (!url || typeof url !== 'string')
  {
    return res.status(400).send('URL parameter required');
  }

  try
  {
    // Only allow http/https
    if (!/^https?:\/\//i.test(url))
    {
      return res.status(400).send('Only http(s) URLs are supported');
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok)
    {
      return res.status(response.status).send(`Failed to fetch URL: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'text/html';
    res.setHeader('Content-Type', contentType);

    const body = await response.text();
    res.send(body);
  } catch (err)
  {
    console.error('Proxy error:', err);
    res.status(500).send('Failed to proxy request');
  }
});

// Import portrait image from a character sheet URL using Puppeteer (headless browser)
app.post('/api/import-portrait', express.json(), async (req, res) =>
{
  const { url } = req.body || {};
  if (!url || typeof url !== 'string')
  {
    return res.status(400).json({ error: 'URL required' });
  }

  let browser;
  try
  {
    // Only allow http/https
    if (!/^https?:\/\//i.test(url))
    {
      return res.status(400).json({ error: 'Only http(s) URLs are supported' });
    }

    let imageUrl = null;
    let notes = '';
    let characterName = '';

    console.log('Importing portrait from URL:', url);
    // Check if this is a D&D Beyond URL and use API if so
    const ddbMatch = url.match(/dndbeyond\.com\/characters\/(\d+)/);
    if (ddbMatch)
    {
      const characterId = ddbMatch[1];
      const apiUrl = `https://character-service.dndbeyond.com/character/v5/character/${characterId}`;

      console.log('Fetching D&D Beyond character data from API:', apiUrl);

      const apiResp = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!apiResp.ok)
      {
        return res.status(502).json({ error: `Failed to fetch character data: ${apiResp.status}` });
      }

      const charData = await apiResp.json();

      //console.log('D&D Beyond character data:', charData);
      // Extract data from API response
      characterName = charData.data?.name || '';
      imageUrl = charData.data?.avatarUrl || charData.data?.decorations?.avatarUrl || null;

      // Extract race
      const race = charData.data?.race?.fullName || charData.data?.race?.baseName || '';
      const raceDescription = charData.data?.race?.description || '';
      // Strip HTML from race description
      const stripHtml = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const cleanRaceDescription = stripHtml(raceDescription); console.log(raceDescription);
      // Extract class(es) and descriptions
      const classes = (charData.data?.classes || [])
        .map(c => `${c.definition?.name || ''} ${c.level || ''}`.trim())
        .filter(Boolean)
        .join('/');

      const classDescriptions = (charData.data?.classes || [])
        .map(c => c.definition?.description || '')
        .filter(Boolean)
        .join('\n\n');
      const cleanClassDescriptions = stripHtml(classDescriptions);

      // Extract notes
      const characterNotes = (charData.data?.notes?.allies || '') + '\n\n' +
        (charData.data?.notes?.personalPossessions || '') + '\n\n' +
        (charData.data?.notes?.otherNotes || '') + '\n\n' +
        (charData.data?.notes?.backstory || '');

      // Extract traits (appearance, personality, ideals, bonds, flaws)
      const traits = [
        charData.data?.traits?.appearance || '',
        charData.data?.traits?.personalityTraits || '',
        charData.data?.traits?.ideals || '',
        charData.data?.traits?.bonds || '',
        charData.data?.traits?.flaws || ''
      ].filter(Boolean).join('\n\n');

      // Combine
      const header = [race, classes].filter(Boolean).join(' ');
      const combinedText = [header, raceDescription, classDescriptions, characterNotes.trim(), traits].filter(Boolean).join('\n\n');
      notes = combinedText ? `~~~do not remove~~~\n\n${combinedText}` : '';

    } else
    {
      // Fallback to Puppeteer for non-D&D Beyond URLs
      console.log('Launching Puppeteer for:', url);
      browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();

      // Navigate and wait for network idle
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait an additional 2 seconds for dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Strategy 1: Look for div.ddbc-character-avatar__portrait with background-image
      const result = await page.evaluate(() =>
      {
        let imageUrl = null;
        const portraitDiv = document.querySelector('.ddbc-character-avatar__portrait');
        if (portraitDiv)
        {
          const bgImage = window.getComputedStyle(portraitDiv).backgroundImage;
          const match = bgImage.match(/url\(["']?([^"'\)]+)["']?\)/);
          if (match && match[1])
          {
            imageUrl = match[1];
          }
        }

        // Extract all notes from ct-notes__note elements
        const noteElements = document.querySelectorAll('.ct-notes__note');
        const notes = Array.from(noteElements)
          .map(el => el.textContent?.trim())
          .filter(Boolean)
          .join('\n\n');

        // Extract all appearance/trait data from ct-trait-content__content elements
        const traitElements = document.querySelectorAll('.ct-trait-content__content');
        const traits = Array.from(traitElements)
          .map(el => el.textContent?.trim())
          .filter(Boolean)
          .join('\n\n');

        // Extract character name
        const nameDiv = document.querySelector('.ddbc-character-tidbits__heading');
        const nameH1 = nameDiv?.querySelector('h1');
        const characterName = nameH1?.textContent?.trim() || '';

        // Extract race and class
        const raceElement = document.querySelector('.ddbc-character-summary__race');
        const race = raceElement?.textContent?.trim() || '';

        const classElement = document.querySelector('.ddbc-character-summary__classes');
        const classes = classElement?.textContent?.trim() || '';

        // Combine race/class header with notes and traits
        const header = [race, classes].filter(Boolean).join(' ');
        const combinedText = [header, notes, traits].filter(Boolean).join('\n\n');

        // Add terminator for auto-generated content
        const notesWithTerminator = combinedText ? `~~~do not remove~~~\n\n${combinedText}` : '';

        return { imageUrl, notes: notesWithTerminator, characterName };
      });

      imageUrl = result.imageUrl;
      notes = result.notes || '';
      characterName = result.characterName || '';

      // Strategy 2: Look for img with portrait class
      if (!imageUrl)
      {
        imageUrl = await page.evaluate(() =>
        {
          const img = document.querySelector('.ddbc-character-avatar__portrait img, img.ddbc-character-avatar__portrait');
          return img?.src || null;
        });
      }

      // Strategy 3: Look for any avatar/portrait image
      if (!imageUrl)
      {
        imageUrl = await page.evaluate(() =>
        {
          const img = document.querySelector('[class*="avatar"] img, [class*="portrait"] img');
          return img?.src || null;
        });
      }

      // Strategy 4: og:image meta tag
      if (!imageUrl)
      {
        imageUrl = await page.evaluate(() =>
        {
          const ogImage = document.querySelector('meta[property="og:image"]');
          return ogImage?.getAttribute('content') || null;
        });
      }

      await browser.close();
      browser = null;
    }

    if (!imageUrl)
    {
      console.warn('No portrait image found, using blank image');
      return res.json({
        success: true,
        filename: 'blankimage.png',
        url: '/images/portrait/blankimage.png',
        notes,
        characterName
      });
    }

    // Resolve relative URLs
    try
    {
      imageUrl = new URL(imageUrl, url).href;
    } catch (e)
    {
      // leave as-is
    }

    console.log('Found portrait image:', imageUrl);

    // Download the image
    const imgResp = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!imgResp.ok)
    {
      return res.status(502).json({ error: `Failed to download image: ${imgResp.status}` });
    }

    const contentType = imgResp.headers.get('content-type') || '';
    let ext = '.png';
    if (contentType.includes('jpeg')) ext = '.jpg';
    else if (contentType.includes('png')) ext = '.png';
    else if (contentType.includes('webp')) ext = '.webp';

    const buffer = Buffer.from(await imgResp.arrayBuffer());

    // Get user's share key for saving
    const shareKey = req.shareKey;
    if (!shareKey) {
      throw new Error('No share key available');
    }

    const userPortraitDir = path.join(usersDir, shareKey, 'images', 'portrait');
    if (!fs.existsSync(userPortraitDir)) {
      fs.mkdirSync(userPortraitDir, { recursive: true });
    }

    // Extract character ID from URL (e.g., /characters/158029310/)
    const characterIdMatch = url.match(/\/characters\/(\d+)/);
    const characterId = characterIdMatch ? characterIdMatch[1] : `imported-${Date.now()}`;

    const filename = `${characterId}${ext}`;
    const savePath = path.join(userPortraitDir, filename);
    fs.writeFileSync(savePath, buffer);

    const publicUrl = `/users/${shareKey}/images/portrait/${filename}`;
    console.log('Imported portrait saved:', filename, 'from', imageUrl);
    console.log('Extracted character name:', characterName || 'none');
    console.log('Extracted notes:', notes ? `${notes.length} characters` : 'none');
    res.json({ success: true, filename, url: publicUrl, notes, characterName });
  } catch (err)
  {
    if (browser)
    {
      await browser.close();
    }
    console.error('Import portrait error:', err);
    res.status(500).json({ error: 'Failed to import portrait' });
  }
});

// Get list of all uploaded maps (excludes actor images)
app.get('/api/maps', requireAuth, (req, res) =>
{
  // Maps are now stored in campaign/scenario folders, not a global maps folder
  // This endpoint is deprecated - maps should be accessed via scenario endpoints
  res.json({ maps: [], message: 'Maps are stored per-scenario. Use scenario endpoints instead.' });
});

// Get list of all uploaded actor images
app.get('/api/images', (req, res) =>
{
  try
  {
    const folder = req.query.folder; // Optional filter by folder
    const shareKey = req.shareKey;
    const actors = [];

    if (!shareKey)
    {
      return res.status(401).json({ error: 'No share key available' });
    }

    // If folder is specified, only read from that folder in user's share key directory
    if (folder) {
      const folderPath = path.join(usersDir, shareKey, 'images', folder);
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath);
        files.forEach(file => {
          if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file)) {
            actors.push({ filename: file, url: `/users/${shareKey}/images/${folder}/${file}` });
          }
        });
      }
      return res.json({ actors, files: actors });
    }

    // Otherwise, read portrait and token images from user's share key directory
    const userImagesDir = path.join(usersDir, shareKey, 'images');
    
    // Read portrait images
    const portraitDir = path.join(userImagesDir, 'portrait');
    if (fs.existsSync(portraitDir))
    {
      const portraitFiles = fs.readdirSync(portraitDir);
      portraitFiles.forEach(file =>
      {
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file))
        {
          actors.push({ filename: file, url: `/users/${shareKey}/images/portrait/${file}` });
        }
      });
    }

    // Read token images
    const tokenDir = path.join(userImagesDir, 'token');
    if (fs.existsSync(tokenDir))
    {
      const tokenFiles = fs.readdirSync(tokenDir);
      tokenFiles.forEach(file =>
      {
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file))
        {
          actors.push({ filename: file, url: `/users/${shareKey}/images/token/${file}` });
        }
      });
    }

    res.json({ actors });
  } catch (err)
  {
    console.error('Failed to read actor images:', err);
    res.status(500).json({ error: 'Failed to read actors images' });
  }
});

// Image Gallery Manager - Get images with usage information
app.get('/api/image-gallery', requireAuth, (req, res) =>
{
  try
  {
    const folder = req.query.folder;
    const shareKey = req.shareKey;

    if (!shareKey)
    {
      return res.status(401).json({ error: 'No share key available' });
    }

    if (!folder)
    {
      return res.status(400).json({ error: 'Folder parameter required' });
    }

    const folderPath = path.join(usersDir, shareKey, 'images', folder);
    if (!fs.existsSync(folderPath))
    {
      return res.json({ images: [] });
    }

    const files = fs.readdirSync(folderPath);
    const imageFiles = files.filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));

    // Check each image for usage
    const images = imageFiles.map(filename =>
    {
      const url = `/users/${shareKey}/images/${folder}/${filename}`;
      const usageInfo = checkImageUsage(shareKey, url);

      return {
        filename,
        url,
        inUse: usageInfo.length > 0,
        usedBy: usageInfo
      };
    });

    res.json({ images });
  } catch (err)
  {
    console.error('Failed to load image gallery:', err);
    res.status(500).json({ error: 'Failed to load image gallery' });
  }
});

// Helper function to check if an image is in use
function checkImageUsage(shareKey, imageUrl)
{
  const usedBy = [];
  
  // Extract just the filename from the imageUrl for comparison
  const searchFilename = path.basename(imageUrl);

  try
  {
    const userCampaignsDir = path.join(usersDir, shareKey, 'campaigns');
    if (!fs.existsSync(userCampaignsDir))
    {
      return usedBy;
    }

    const campaigns = fs.readdirSync(userCampaignsDir).filter(file =>
    {
      const stat = fs.statSync(path.join(userCampaignsDir, file));
      return stat.isDirectory();
    });

    for (const campaign of campaigns)
    {
      const campaignPath = path.join(userCampaignsDir, campaign);

      // Check campaign background image
      const metadataPath = path.join(campaignPath, '.metadata.json');
      if (fs.existsSync(metadataPath))
      {
        try
        {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          if (metadata.backgroundImage && path.basename(metadata.backgroundImage) === searchFilename)
          {
            usedBy.push(`Campaign: ${campaign} (background)`);
          }
        } catch (err)
        {
          console.error('Error reading campaign metadata:', err);
        }
      }

      // Check player tokens
      const playerTokensPath = path.join(campaignPath, 'playertokens');
      if (fs.existsSync(playerTokensPath))
      {
        const tokenFiles = fs.readdirSync(playerTokensPath).filter(f => f.endsWith('.json'));
        for (const tokenFile of tokenFiles)
        {
          try
          {
            const fileContent = fs.readFileSync(path.join(playerTokensPath, tokenFile), 'utf8');
            if (fileContent.includes(searchFilename))
            {
              const tokenData = JSON.parse(fileContent);
              usedBy.push(`Player Token: ${tokenData.actor?.name || 'Unknown'} (${campaign}) - ${tokenFile}`);
            }
          } catch (err)
          {
            console.error('Error reading player token:', err);
          }
        }
      }

      // Check scenarios
      const scenariosPath = path.join(campaignPath, 'scenarios');
      if (fs.existsSync(scenariosPath))
      {
        const scenarios = fs.readdirSync(scenariosPath).filter(file =>
        {
          const stat = fs.statSync(path.join(scenariosPath, file));
          return stat.isDirectory();
        });

        for (const scenario of scenarios)
        {
          const scenarioPath = path.join(scenariosPath, scenario);

          // Check NPC tokens
          const npcTokensPath = path.join(scenarioPath, 'npctokens');
          if (fs.existsSync(npcTokensPath))
          {
            const tokenFiles = fs.readdirSync(npcTokensPath).filter(f => f.endsWith('.json'));
            for (const tokenFile of tokenFiles)
            {
              try
              {
                const fileContent = fs.readFileSync(path.join(npcTokensPath, tokenFile), 'utf8');
                if (fileContent.includes(searchFilename))
                {
                  const tokenData = JSON.parse(fileContent);
                  usedBy.push(`NPC Token: ${tokenData.actor?.name || 'Unknown'} (${campaign}/${scenario}) - ${tokenFile}`);
                }
              } catch (err)
              {
                console.error('Error reading NPC token:', err);
              }
            }
          }

          // Check props
          const propsPath = path.join(scenarioPath, 'props');
          if (fs.existsSync(propsPath))
          {
            const propFiles = fs.readdirSync(propsPath).filter(f => f.endsWith('.json'));
            for (const propFile of propFiles)
            {
              try
              {
                const fileContent = fs.readFileSync(path.join(propsPath, propFile), 'utf8');
                if (fileContent.includes(searchFilename))
                {
                  const propData = JSON.parse(fileContent);
                  usedBy.push(`Prop: ${propData.name || 'Unnamed'} (${campaign}/${scenario}) - ${propFile}`);
                }
              } catch (err)
              {
                console.error('Error reading prop:', err);
              }
            }
          }

          // Check maps
          const mapsPath = path.join(scenarioPath, 'maps');
          if (fs.existsSync(mapsPath))
          {
            const mapFiles = fs.readdirSync(mapsPath);
            const imageMapFiles = mapFiles.filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));
            
            for (const mapFile of imageMapFiles)
            {
              if (mapFile === searchFilename)
              {
                usedBy.push(`Map: ${mapFile} (${campaign}/${scenario})`);
              }
            }
          }

          // Check sessions
          const sessionsPath = path.join(campaignPath, 'sessions');
          if (fs.existsSync(sessionsPath))
          {
            const sessions = fs.readdirSync(sessionsPath).filter(file =>
            {
              const stat = fs.statSync(path.join(sessionsPath, file));
              return stat.isDirectory();
            });

            for (const session of sessions)
            {
              const sessionScenarioPath = path.join(sessionsPath, session, 'scenarios', scenario);

              // Check session NPC tokens
              const sessionNpcTokensPath = path.join(sessionScenarioPath, 'npctokens');
              if (fs.existsSync(sessionNpcTokensPath))
              {
                const tokenFiles = fs.readdirSync(sessionNpcTokensPath).filter(f => f.endsWith('.json'));
                for (const tokenFile of tokenFiles)
                {
                  try
                  {
                    const fileContent = fs.readFileSync(path.join(sessionNpcTokensPath, tokenFile), 'utf8');
                    if (fileContent.includes(searchFilename))
                    {
                      const tokenData = JSON.parse(fileContent);
                      usedBy.push(`Session NPC: ${tokenData.actor?.name || 'Unknown'} (${campaign}/${session}/${scenario}) - ${tokenFile}`);
                    }
                  } catch (err)
                  {
                    console.error('Error reading session NPC token:', err);
                  }
                }
              }

              // Check session player tokens
              const sessionPlayerTokensPath = path.join(sessionsPath, session, 'playertokens');
              if (fs.existsSync(sessionPlayerTokensPath))
              {
                const tokenFiles = fs.readdirSync(sessionPlayerTokensPath).filter(f => f.endsWith('.json'));
                for (const tokenFile of tokenFiles)
                {
                  try
                  {
                    const fileContent = fs.readFileSync(path.join(sessionPlayerTokensPath, tokenFile), 'utf8');
                    if (fileContent.includes(searchFilename))
                    {
                      const tokenData = JSON.parse(fileContent);
                      usedBy.push(`Session Player: ${tokenData.actor?.name || 'Unknown'} (${campaign}/${session}) - ${tokenFile}`);
                    }
                  } catch (err)
                  {
                    console.error('Error reading session player token:', err);
                  }
                }
              }

              // Check session props
              const sessionPropsPath = path.join(sessionScenarioPath, 'props');
              if (fs.existsSync(sessionPropsPath))
              {
                const propFiles = fs.readdirSync(sessionPropsPath).filter(f => f.endsWith('.json'));
                for (const propFile of propFiles)
                {
                  try
                  {
                    const fileContent = fs.readFileSync(path.join(sessionPropsPath, propFile), 'utf8');
                    if (fileContent.includes(searchFilename))
                    {
                      const propData = JSON.parse(fileContent);
                      usedBy.push(`Session Prop: ${propData.name || 'Unnamed'} (${campaign}/${session}/${scenario}) - ${propFile}`);
                    }
                  } catch (err)
                  {
                    console.error('Error reading session prop:', err);
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (err)
  {
    console.error('Error checking image usage:', err);
  }

  return usedBy;
}

// Delete an image
app.delete('/api/images', requireGM, (req, res) =>
{
  try
  {
    const { url } = req.query;
    if (!url)
    {
      return res.status(400).json({ error: 'URL parameter required' });
    }

    if (!req.shareKey)
    {
      return res.status(401).json({ error: 'No share key available' });
    }

    // Remove leading slash and API prefix if present
    const relativePath = url.replace(/^\//, '');
    const filePath = path.join(__dirname, relativePath);

    // Security check: ensure path is within user's share key directory
    const normalizedPath = path.normalize(filePath);
    const normalizedUserDir = path.normalize(path.join(usersDir, req.shareKey));
    if (!normalizedPath.startsWith(normalizedUserDir))
    {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    if (!fs.existsSync(filePath))
    {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete the file
    fs.unlinkSync(filePath);
    res.json({ success: true, message: 'Image deleted successfully' });
  } catch (err)
  {
    console.error('Failed to delete image:', err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Remove background from an image (replaces top-left corner color with transparency)
// Flip image horizontally
app.post('/api/images/flip-horizontal', requireGM, express.json(), async (req, res) =>
{
  try
  {
    const { imageUrl } = req.body;
    if (!imageUrl)
    {
      return res.status(400).json({ error: 'imageUrl is required' });
    }

    if (!req.shareKey)
    {
      return res.status(401).json({ error: 'No share key available' });
    }

    // Remove leading slash and get file path
    const relativePath = imageUrl.replace(/^\//, '');
    const filePath = path.join(__dirname, relativePath);

    // Security check: ensure path is within user's share key directory
    const normalizedPath = path.normalize(filePath);
    const normalizedUserDir = path.normalize(path.join(usersDir, req.shareKey));
    if (!normalizedPath.startsWith(normalizedUserDir))
    {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    if (!fs.existsSync(filePath))
    {
      return res.status(404).json({ error: 'File not found' });
    }

    // Flip the image horizontally
    await sharp(filePath)
      .flop() // Horizontal flip
      .toFile(filePath + '.tmp');

    // Replace original file with flipped version
    fs.renameSync(filePath + '.tmp', filePath);

    console.log(`Image flipped: ${filePath}`);
    res.json({ success: true, message: 'Image flipped successfully' });
  } catch (err)
  {
    console.error('Error flipping image:', err);
    res.status(500).json({ error: 'Failed to flip image' });
  }
});

app.post('/api/images/remove-background', requireGM, express.json(), async (req, res) =>
{
  try
  {
    const { imageUrl } = req.body;
    if (!imageUrl)
    {
      return res.status(400).json({ error: 'imageUrl is required' });
    }

    if (!req.shareKey)
    {
      return res.status(401).json({ error: 'No share key available' });
    }

    // Remove leading slash and get file path
    const relativePath = imageUrl.replace(/^\//, '');
    const filePath = path.join(__dirname, relativePath);

    // Security check: ensure path is within user's share key directory
    const normalizedPath = path.normalize(filePath);
    const normalizedUserDir = path.normalize(path.join(usersDir, req.shareKey));
    if (!normalizedPath.startsWith(normalizedUserDir))
    {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    if (!fs.existsSync(filePath))
    {
      return res.status(404).json({ error: 'File not found' });
    }

    // Load the image with sharp
    const image = sharp(filePath);
    const metadata = await image.metadata();

    // Get raw pixel data
    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Get top-left corner pixel color (RGBA)
    const targetR = data[0];
    const targetG = data[1];
    const targetB = data[2];

    console.log(`Removing background color: RGB(${targetR}, ${targetG}, ${targetB})`);

    // Process each pixel - make pixels matching the target color transparent
    const tolerance = 30; // Color tolerance for matching
    for (let i = 0; i < data.length; i += 4)
    {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Check if this pixel is close to the target color
      if (
        Math.abs(r - targetR) <= tolerance &&
        Math.abs(g - targetG) <= tolerance &&
        Math.abs(b - targetB) <= tolerance
      )
      {
        // Make it transparent
        data[i + 3] = 0;
      }
    }

    // Save the modified image back to the same file
    await sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4
      }
    })
    .png() // Save as PNG to preserve transparency
    .toFile(filePath);

    console.log(`Background removed from ${filePath}`);
    res.json({ success: true, message: 'Background removed successfully' });
  } catch (err)
  {
    console.error('Failed to remove background:', err);
    res.status(500).json({ error: 'Failed to remove background: ' + err.message });
  }
});

// Get map metadata (deprecated - maps are now stored per-scenario)
app.get('/api/map-metadata/:filename', requireAuth, (req, res) =>
{
  // This endpoint is deprecated - map metadata is now stored with scenarios
  // Return default metadata for backwards compatibility
  res.json({
    gridColumns: 20,
    gridRows: 20,
    lightingCondition: 'bright',
    fogEnabled: 'off-gm',
    fogRevealDistance: 3,
    showGrid: true
  });
});

// Save map metadata (deprecated - maps are now stored per-scenario)
app.post('/api/map-metadata/:filename', requireGM, (req, res) =>
{
  // This endpoint is deprecated - map metadata is now stored with scenarios
  res.json({ success: true, message: 'Map metadata should be saved via scenario endpoints' });
});

// In-memory game state storage
let currentCampaign = null;
let currentScenario = null;
let currentUserId = null; // Track current user
let currentShareKey = null; // Track current share key for file paths
let currentSessionName = null; // Track current session name
let isSessionActive = false; // Track if we're in game mode
let gameState = {
  backgroundImage: null,
  tokens: [],
  props: [],
  transform: { x: 0, y: 0, scale: 1, rotation: 0 },
  fogEnabled: 'off-gm',
  fogRevealDistance: 3,
  playerFogOpacity: 1,
  lightingCondition: 'bright',
  revealedPath: [],
  gridColumns: 100,
  gridRows: 100,
  showGrid: true,
  imageDimensions: null,
  currentActorId: null,
  showObserverCards: true
};

// Track player heartbeats
const playerHeartbeats = new Map(); // tokenId -> timestamp

// Auto-deactivate players that haven't sent heartbeat in 10 seconds
setInterval(() =>
{
  const now = Date.now();
  const timeout = 10000; // 10 seconds
  let anyChanges = false;

  gameState.tokens.forEach(token =>
  {
    if (token.actor?.player && token.active)
    {
      const lastSeen = playerHeartbeats.get(token.id);
      // Only deactivate if there's a heartbeat entry AND it's stale
      // Don't deactivate tokens that have never sent a heartbeat (they might just be loading)
      if (lastSeen && (now - lastSeen) > timeout)
      {
        console.log('Auto-deactivating stale player:', token.id, token.actor.name);
        token.active = false;
        anyChanges = true;

        // Save player token immediately
        savePlayerToken(token);
      }
    }
  });

  // Save scenario state if any changes occurred
  if (anyChanges)
  {
    saveScenarioGameState(gameState);
    console.log('Saved updated game state after auto-deactivation');
  }
}, 5000); // Check every 5 seconds

// Helper function to get scenario game state file path
function getScenarioGameStatePath()
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return null;
  const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);
  
  if (isSessionActive && currentSessionName)
  {
    // Session files are at campaign level, with scenarios subfolder
    const campaignPath = path.join(userCampaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
    return path.join(sessionPath, '.runtime-state.json');
  }
  
  const scenarioPath = path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario);
  return path.join(scenarioPath, '.scenario-state.json');
}

// Helper function to load scenario game state from file
function loadScenarioGameState()
{
  const statePath = getScenarioGameStatePath();
  if (!statePath || !fs.existsSync(statePath))
  {
    return null;
  }

  try
  {
    const data = fs.readFileSync(statePath, 'utf-8');
    const scenarioState = JSON.parse(data);

    // Convert old image paths to sharekey-based paths
    if (scenarioState.backgroundImage && scenarioState.backgroundImage.startsWith('/images/')) {
      scenarioState.backgroundImage = `/users/${currentShareKey}${scenarioState.backgroundImage}`;
    }

    // Load player tokens from campaign directory and NPC tokens from scenario directory
    const playerTokens = loadPlayerTokens();
    const npcTokens = loadNPCTokens();
    const props = loadProps();

    // Merge all tokens (players + NPCs) and props
    scenarioState.tokens = [...playerTokens, ...npcTokens];
    scenarioState.props = props;

    // Ensure revealZones and permanentlyRevealedZones exist
    if (!scenarioState.revealZones) {
      scenarioState.revealZones = [];
    }
    if (!scenarioState.permanentlyRevealedZones) {
      scenarioState.permanentlyRevealedZones = [];
    }

    return scenarioState;
  } catch (error)
  {
    console.error('Failed to load scenario game state:', error);
    return null;
  }
}

// Helper function to save scenario game state to file
function saveScenarioGameState(state)
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return;

  const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const definitionPath = path.join(scenarioPath, '.scenario-state.json');

  try
  {
    // Filter out tokens and props - they're saved separately
    const stateToSave = {
      ...state,
      tokens: [], // All tokens stored in separate files
      props: [] // All props stored in separate files
    };
    
    // Strip API URL prefix and sharekey prefix from backgroundImage before saving
    if (stateToSave.backgroundImage) {
      // Remove any http://localhost:3001 or similar prefixes
      let cleanPath = stateToSave.backgroundImage.replace(/^(https?:\/\/[^\/]+)+/g, '');
      // Strip sharekey prefix to store in old format
      if (cleanPath.startsWith(`/users/${currentShareKey}/`)) {
        cleanPath = cleanPath.replace(`/users/${currentShareKey}`, '');
      }
      stateToSave.backgroundImage = cleanPath;
    }
    
    console.log('saveScenarioGameState: showObserverCards =', stateToSave.showObserverCards);
    console.log('saveScenarioGameState: backgroundImage =', stateToSave.backgroundImage);

    if (isSessionActive && currentSessionName)
    {
      // GAME MODE: Save ONLY to session folder (new structure: campaign/sessions/[session]/scenarios/[scenario])
      const campaignPath = path.join(campaignsDir, currentCampaign);
      const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
      const runtimePath = path.join(sessionPath, '.runtime-state.json');
      if (!fs.existsSync(sessionPath))
      {
        fs.mkdirSync(sessionPath, { recursive: true });
      }
      fs.writeFileSync(runtimePath, JSON.stringify(stateToSave, null, 2));
    } else
    {
      // EDIT MODE: Save to definition, preserving lastSessionPlayed
      let existingData = {};
      if (fs.existsSync(definitionPath))
      {
        existingData = JSON.parse(fs.readFileSync(definitionPath, 'utf-8'));
      }

      const finalState = {
        ...stateToSave,
        lastSessionPlayed: existingData.lastSessionPlayed // Preserve lastSessionPlayed
      };
      fs.writeFileSync(definitionPath, JSON.stringify(finalState, null, 2));
      
      // Also save map metadata (fog settings, reveal zones, etc.)
      saveMapMetadata(state);
    }
  } catch (error)
  {
    console.error('Failed to save scenario game state:', error);
  }
}

// Helper function to save map metadata (fog settings, reveal zones, etc.)
function saveMapMetadata(state)
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return;
  if (!state.backgroundImage) return;

  const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);

  // Extract filename from backgroundImage path
  const filename = state.backgroundImage.split('/').pop();
  if (!filename) return;

  const metadataPath = path.join(scenarioPath, ".scenario-state.json");

  try
  {
    // Read existing metadata if it exists
    let existingMetadata = {};
    if (fs.existsSync(metadataPath))
    {
      existingMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    }

    // Update metadata with current state
    const updatedMetadata = {
      ...existingMetadata,
      fogEnabled: state.fogEnabled,
      fogRevealDistance: state.fogRevealDistance,
      lightingCondition: state.lightingCondition,
      revealedPath: state.revealedPath || [],
      revealZones: state.revealZones || [],
      permanentlyRevealedZones: state.permanentlyRevealedZones || [],
      gridColumns: state.gridColumns,
      gridRows: state.gridRows,
      showGrid: state.showGrid
    };

    if (state.gridCellDistance !== undefined)
    {
      updatedMetadata.gridCellDistance = state.gridCellDistance;
    }

    fs.writeFileSync(metadataPath, JSON.stringify(updatedMetadata, null, 2));

  } catch (error)
  {
    console.error('Failed to save map metadata:', error);
  }
}

// Helper function to get player tokens directory path
function getPlayerTokensPath()
{
  if (!currentCampaign || !currentShareKey) return null;
  const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);
  if (isSessionActive && currentSessionName)
  {
    // Session files are at campaign level, with scenarios subfolder
    const campaignPath = path.join(userCampaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
    return path.join(sessionPath, 'playertokens');
  }
  return path.join(userCampaignsDir, currentCampaign, 'playertokens');
}

// Helper function to load all player tokens from campaign directory
function loadPlayerTokens()
{
  const tokensPath = getPlayerTokensPath();
  if (!tokensPath || !fs.existsSync(tokensPath))
  {
    return [];
  }

  try
  {
    const files = fs.readdirSync(tokensPath);
    const playerTokens = [];

    for (const file of files)
    {
      if (file.endsWith('.json'))
      {
        try
        {
          const tokenPath = path.join(tokensPath, file);
          const tokenData = fs.readFileSync(tokenPath, 'utf-8');
          const token = JSON.parse(tokenData);
          
          // Convert old image paths to sharekey-based paths
          if (token.imageUrl && token.imageUrl.startsWith('/images/')) {
            token.imageUrl = `/users/${currentShareKey}${token.imageUrl}`;
          }
          if (token.portraitUrl && token.portraitUrl.startsWith('/images/')) {
            token.portraitUrl = `/users/${currentShareKey}${token.portraitUrl}`;
          }
          
          // Also convert state image paths
          if (token.states && Array.isArray(token.states)) {
            token.states = token.states.map(state => ({
              ...state,
              imageUrl: state.imageUrl && state.imageUrl.startsWith('/images/')
                ? `/users/${currentShareKey}${state.imageUrl}`
                : state.imageUrl
            }));
          }
          
          playerTokens.push(token);
        } catch (err)
        {
          console.error(`Failed to load player token ${file}:`, err);
        }
      }
    }

    return playerTokens;
  } catch (error)
  {
    console.error('Failed to load player tokens:', error);
    return [];
  }
}

// Helper function to save a player token to campaign directory
function savePlayerToken(token)
{
  if (!currentCampaign || !currentShareKey) return;

  const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const definitionPath = path.join(campaignsDir, currentCampaign, 'playertokens');

  try
  {
    // Clone token and strip sharekey prefix from image paths before saving
    const tokenToSave = { ...token };
    if (tokenToSave.imageUrl && tokenToSave.imageUrl.startsWith(`/users/${currentShareKey}/`)) {
      tokenToSave.imageUrl = tokenToSave.imageUrl.replace(`/users/${currentShareKey}`, '');
    }
    if (tokenToSave.portraitUrl && tokenToSave.portraitUrl.startsWith(`/users/${currentShareKey}/`)) {
      tokenToSave.portraitUrl = tokenToSave.portraitUrl.replace(`/users/${currentShareKey}`, '');
    }
    
    // Also process states array for image URLs
    if (tokenToSave.states && Array.isArray(tokenToSave.states)) {
      tokenToSave.states = tokenToSave.states.map(state => ({
        ...state,
        imageUrl: state.imageUrl && state.imageUrl.startsWith(`/users/${currentShareKey}/`)
          ? state.imageUrl.replace(`/users/${currentShareKey}`, '')
          : state.imageUrl
      }));
    }

    if (isSessionActive && currentSessionName)
    {
      // GAME MODE: Save ONLY to session folder (new structure: campaign/sessions/[session]/scenarios/[scenario])
      const campaignPath = path.join(campaignsDir, currentCampaign);
      const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
      const runtimePath = path.join(sessionPath, 'playertokens');
      if (!fs.existsSync(runtimePath))
      {
        fs.mkdirSync(runtimePath, { recursive: true });
      }
      const tokenPath = path.join(runtimePath, `${token.id}.json`);
      fs.writeFileSync(tokenPath, JSON.stringify(tokenToSave, null, 2));
    } else
    {
      // EDIT MODE: Save to definition
      if (!fs.existsSync(definitionPath))
      {
        fs.mkdirSync(definitionPath, { recursive: true });
      }
      const tokenPath = path.join(definitionPath, `${token.id}.json`);
      fs.writeFileSync(tokenPath, JSON.stringify(tokenToSave, null, 2));
    }
  } catch (error)
  {
    console.error('Failed to save player token:', error);
  }
}

// Helper function to delete a player token from campaign directory
function deletePlayerToken(tokenId)
{
  const tokensPath = getPlayerTokensPath();
  if (!tokensPath) return;

  try
  {
    const tokenPath = path.join(tokensPath, `${tokenId}.json`);
    if (fs.existsSync(tokenPath))
    {
      fs.unlinkSync(tokenPath);
    }
  } catch (error)
  {
    console.error('Failed to delete player token:', error);
  }
}

// Helper function to get NPC tokens directory path
function getNPCTokensPath()
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return null;
  const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);
  if (isSessionActive && currentSessionName)
  {
    // Session files are at campaign level, with scenarios subfolder
    const campaignPath = path.join(userCampaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
    const npcPath = path.join(sessionPath, 'npctokens');
    return npcPath;
  }
  const npcPath = path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario, 'npctokens');
  return npcPath;
}

// Helper function to load all NPC tokens from scenario directory
function loadNPCTokens()
{
  const tokensPath = getNPCTokensPath();
  if (!tokensPath || !fs.existsSync(tokensPath))
  {
    return [];
  }

  try
  {
    const files = fs.readdirSync(tokensPath);
    const npcTokens = [];

    
    
    for (const file of files)
    {
      if (file.endsWith('.json'))
      {
        try
        {
          const tokenPath = path.join(tokensPath, file);
          const tokenData = fs.readFileSync(tokenPath, 'utf-8');
          const token = JSON.parse(tokenData);
          
          // Convert old image paths to sharekey-based paths
          if (token.imageUrl && token.imageUrl.startsWith('/images/')) {
            token.imageUrl = `/users/${currentShareKey}${token.imageUrl}`;
          }
          if (token.portraitUrl && token.portraitUrl.startsWith('/images/')) {
            token.portraitUrl = `/users/${currentShareKey}${token.portraitUrl}`;
          }
          
          // Also convert state image paths
          if (token.states && Array.isArray(token.states)) {
            token.states = token.states.map(state => ({
              ...state,
              imageUrl: state.imageUrl && state.imageUrl.startsWith('/images/')
                ? `/users/${currentShareKey}${state.imageUrl}`
                : state.imageUrl
            }));
          }
          
          npcTokens.push(token);
        } catch (err)
        {
          console.error(`Failed to load NPC token ${file}:`, err);
        }
      }
    }

    return npcTokens;
  } catch (error)
  {
    console.error('Failed to load NPC tokens:', error);
    return [];
  }
}

// Helper function to save an NPC token to scenario directory
function saveNPCToken(token)
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return;

  const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const definitionPath = path.join(scenarioPath, 'npctokens');

  try
  {
    // Clone token and strip sharekey prefix from image paths before saving
    const tokenToSave = { ...token };
    if (tokenToSave.imageUrl && tokenToSave.imageUrl.startsWith(`/users/${currentShareKey}/`)) {
      tokenToSave.imageUrl = tokenToSave.imageUrl.replace(`/users/${currentShareKey}`, '');
    }
    if (tokenToSave.portraitUrl && tokenToSave.portraitUrl.startsWith(`/users/${currentShareKey}/`)) {
      tokenToSave.portraitUrl = tokenToSave.portraitUrl.replace(`/users/${currentShareKey}`, '');
    }
    
    // Also process states array for image URLs
    if (tokenToSave.states && Array.isArray(tokenToSave.states)) {
      tokenToSave.states = tokenToSave.states.map(state => ({
        ...state,
        imageUrl: state.imageUrl && state.imageUrl.startsWith(`/users/${currentShareKey}/`)
          ? state.imageUrl.replace(`/users/${currentShareKey}`, '')
          : state.imageUrl
      }));
    }

    if (isSessionActive && currentSessionName)
    {
      // GAME MODE: Save ONLY to session folder (new structure: campaign/sessions/[session]/scenarios/[scenario])
      const campaignPath = path.join(campaignsDir, currentCampaign);
      const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
      const runtimePath = path.join(sessionPath, 'npctokens');
      if (!fs.existsSync(runtimePath))
      {
        fs.mkdirSync(runtimePath, { recursive: true });
      }
      const tokenPath = path.join(runtimePath, `${token.id}.json`);
      fs.writeFileSync(tokenPath, JSON.stringify(tokenToSave, null, 2));
    } else
    {
      // EDIT MODE: Save to definition
      if (!fs.existsSync(definitionPath))
      {
        fs.mkdirSync(definitionPath, { recursive: true });
      }
      const tokenPath = path.join(definitionPath, `${token.id}.json`);
      fs.writeFileSync(tokenPath, JSON.stringify(tokenToSave, null, 2));
    }
  } catch (error)
  {
    console.error('Failed to save NPC token:', error);
  }
}

// Helper function to delete an NPC token from scenario directory
function deleteNPCToken(tokenId)
{
  const tokensPath = getNPCTokensPath();
  if (!tokensPath) return;

  try
  {
    const tokenPath = path.join(tokensPath, `${tokenId}.json`);
    if (fs.existsSync(tokenPath))
    {
      fs.unlinkSync(tokenPath);
    }
  } catch (error)
  {
    console.error('Failed to delete NPC token:', error);
  }
}

// ===== PROPS FUNCTIONS =====

// Helper function to get props directory path
function getPropsPath()
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return null;
  const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);
  if (isSessionActive && currentSessionName)
  {
    // Session files are at campaign level, with scenarios subfolder
    const campaignPath = path.join(userCampaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
    return path.join(sessionPath, 'props');
  }
  return path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario, 'props');
}

// Helper function to load all props from scenario directory
function loadProps()
{
  const propsPath = getPropsPath();
  if (!propsPath)
  {
    return [];
  }
  if (!fs.existsSync(propsPath))
  {
    // Try to copy from base scenario definition if in session mode
    if (isSessionActive && currentSessionName && currentCampaign && currentScenario && currentShareKey)
    {
      const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
      const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
      const basePropsPath = path.join(scenarioPath, 'props');
      if (fs.existsSync(basePropsPath))
      {
        fs.mkdirSync(propsPath, { recursive: true });
        const files = fs.readdirSync(basePropsPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            fs.copyFileSync(path.join(basePropsPath, file), path.join(propsPath, file));
          }
        }
      } else
      {
        fs.mkdirSync(propsPath, { recursive: true });
      }
    } else
    {
      fs.mkdirSync(propsPath, { recursive: true });
    }
  }

  try
  {
    const files = fs.readdirSync(propsPath);
    const props = [];

    for (const file of files)
    {
      if (file.endsWith('.json'))
      {
        try
        {
          const propPath = path.join(propsPath, file);
          const propData = fs.readFileSync(propPath, 'utf-8');
          const prop = JSON.parse(propData);
          
          // Convert old image paths to sharekey-based paths
          if (prop.imageUrl && prop.imageUrl.startsWith('/images/')) {
            prop.imageUrl = `/users/${currentShareKey}${prop.imageUrl}`;
          }
          
          // Also convert state image paths
          if (prop.states && Array.isArray(prop.states)) {
            prop.states = prop.states.map(state => ({
              ...state,
              imageUrl: state.imageUrl && state.imageUrl.startsWith('/images/')
                ? `/users/${currentShareKey}${state.imageUrl}`
                : state.imageUrl
            }));
          }
          
          props.push(prop);
        } catch (err)
        {
          console.error(`Failed to load prop ${file}:`, err);
        }
      }
    }

    return props;
  } catch (error)
  {
    console.error('Failed to load props:', error);
    return [];
  }
}

// Helper function to save a prop to scenario directory
function saveProp(prop)
{
  if (!currentCampaign || !currentScenario || !currentShareKey) return;

  const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const definitionPath = path.join(scenarioPath, 'props');

  try
  {
    // Clone prop and strip sharekey prefix from image paths before saving
    const propToSave = { ...prop };
    if (propToSave.imageUrl && propToSave.imageUrl.startsWith(`/users/${currentShareKey}/`)) {
      propToSave.imageUrl = propToSave.imageUrl.replace(`/users/${currentShareKey}`, '');
    }
    
    // Also process states array for image URLs
    if (propToSave.states && Array.isArray(propToSave.states)) {
      propToSave.states = propToSave.states.map(state => ({
        ...state,
        imageUrl: state.imageUrl && state.imageUrl.startsWith(`/users/${currentShareKey}/`)
          ? state.imageUrl.replace(`/users/${currentShareKey}`, '')
          : state.imageUrl
      }));
    }

    if (isSessionActive && currentSessionName)
    {
      // GAME MODE: Save ONLY to session folder (new structure: campaign/sessions/[session]/scenarios/[scenario])
      const campaignPath = path.join(campaignsDir, currentCampaign);
      const sessionPath = path.join(campaignPath, 'sessions', currentSessionName, 'scenarios', currentScenario);
      const runtimePath = path.join(sessionPath, 'props');
      if (!fs.existsSync(runtimePath))
      {
        fs.mkdirSync(runtimePath, { recursive: true });
      }
      const propPath = path.join(runtimePath, `${prop.id}.json`);
      fs.writeFileSync(propPath, JSON.stringify(propToSave, null, 2));
    } else
    {
      // EDIT MODE: Save to definition
      if (!fs.existsSync(definitionPath))
      {
        fs.mkdirSync(definitionPath, { recursive: true });
      }
      const propPath = path.join(definitionPath, `${prop.id}.json`);
      fs.writeFileSync(propPath, JSON.stringify(propToSave, null, 2));
    }
  } catch (error)
  {
    console.error('Failed to save prop:', error);
  }
}

// Helper function to delete a prop from scenario directory
function deleteProp(propId)
{
  const propsPath = getPropsPath();
  if (!propsPath) return;

  try
  {
    const propPath = path.join(propsPath, `${propId}.json`);
    if (fs.existsSync(propPath))
    {
      fs.unlinkSync(propPath);
    }
  } catch (error)
  {
    console.error('Failed to delete prop:', error);
  }
}

// Helper function to get share key's campaigns directory
function getShareKeyCampaignsDir(shareKey) {
  const shareKeyDir = path.join(usersDir, shareKey, 'campaigns');
  if (!fs.existsSync(shareKeyDir)) {
    fs.mkdirSync(shareKeyDir, { recursive: true });
  }
  return shareKeyDir;
}

// Helper function to get share key's archived campaigns directory
function getShareKeyArchivedCampaignsDir(shareKey) {
  const shareKeyDir = path.join(usersDir, shareKey, 'archived-campaigns');
  if (!fs.existsSync(shareKeyDir)) {
    fs.mkdirSync(shareKeyDir, { recursive: true });
  }
  return shareKeyDir;
}

// Helper function to get/save share key data file
function getShareKeyDataPath(shareKey) {
  const shareKeyDir = path.join(usersDir, shareKey);
  if (!fs.existsSync(shareKeyDir)) {
    fs.mkdirSync(shareKeyDir, { recursive: true });
  }
  return path.join(shareKeyDir, '.user.json');
}

// Find all share keys accessible to a user (owner or GM)
function getAccessibleShareKeys(userId, userEmail) {
  const accessible = [];
  
  if (!fs.existsSync(usersDir)) {
    return accessible;
  }
  
  const shareKeyDirs = fs.readdirSync(usersDir).filter(dir => {
    const stat = fs.statSync(path.join(usersDir, dir));
    return stat.isDirectory();
  });
  
  for (const shareKey of shareKeyDirs) {
    const dataPath = path.join(usersDir, shareKey, '.user.json');
    if (fs.existsSync(dataPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        // User has access if they own it or are in the GMs list
        if (data.ownerId === userId || (data.gms && data.gms.includes(userEmail))) {
          accessible.push({
            shareKey,
            ownerId: data.ownerId,
            isOwner: data.ownerId === userId
          });
        }
      } catch (err) {
        console.error(`Error reading data for share key ${shareKey}:`, err);
      }
    }
  }
  
  return accessible;
}

// Check if a share key already exists
function shareKeyExists(shareKey) {
  return fs.existsSync(path.join(usersDir, shareKey));
}

// Backward compatibility wrappers - these now use shareKey but keep the old function names
// The shareKey should be passed via req.shareKey middleware
function getUserCampaignsDir(shareKeyOrUserId) {
  return getShareKeyCampaignsDir(shareKeyOrUserId);
}

function getUserArchivedCampaignsDir(shareKeyOrUserId) {
  return getShareKeyArchivedCampaignsDir(shareKeyOrUserId);
}

function loadUserData(shareKeyOrUserId) {
  return loadShareKeyData(shareKeyOrUserId);
}

function saveUserData(shareKeyOrUserId, data) {
  saveShareKeyData(shareKeyOrUserId, data);
}

function getUserDataPath(shareKeyOrUserId) {
  return getShareKeyDataPath(shareKeyOrUserId);
}

function loadShareKeyData(shareKey) {
  const dataPath = getShareKeyDataPath(shareKey);
  if (fs.existsSync(dataPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      // Ensure required fields exist for backward compatibility
      if (!data.gms) {
        data.gms = [];
      }
      if (!data.ownerId) {
        data.ownerId = null;
      }
      return data;
    } catch (err) {
      console.error('Error reading share key data:', err);
    }
  }
  return { gms: [], ownerId: null };
}

function saveShareKeyData(shareKey, data) {
  const dataPath = getShareKeyDataPath(shareKey);
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function getAllUserKeys() {
  const keys = new Map(); // Map of key -> userId
  if (!fs.existsSync(usersDir)) return keys;
  
  const userDirs = fs.readdirSync(usersDir).filter(file => {
    const stat = fs.statSync(path.join(usersDir, file));
    return stat.isDirectory();
  });
  
  for (const userId of userDirs) {
    const userData = loadUserData(userId);
    if (userData.key) {
      keys.set(userData.key, userId);
    }
  }
  
  return keys;
}

// Share Key Management APIs
// Get accessible share keys for current user
app.get('/api/share-keys', requireAuth, (req, res) => {
  res.json({
    accessibleShareKeys: req.user.accessibleShareKeys || [],
    currentShareKey: req.user.currentShareKey
  });
});

// Create a new share key
app.post('/api/share-keys', requireAuth, express.json(), (req, res) => {
  const { shareKey } = req.body;
  
  if (!shareKey || typeof shareKey !== 'string') {
    return res.status(400).json({ error: 'Share key is required' });
  }
  
  // Sanitize the share key
  const sanitizedKey = shareKey.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (sanitizedKey.length < 3) {
    return res.status(400).json({ error: 'Share key must be at least 3 characters' });
  }
  
  // Check if share key already exists
  if (shareKeyExists(sanitizedKey)) {
    return res.status(409).json({ error: 'This share key is already in use' });
  }
  
  // Create the share key folder with user data
  const shareKeyData = {
    ownerId: req.user.id,
    ownerEmail: req.user.email,
    key: sanitizedKey,
    gms: [req.user.email],
    openaiApiKey: null
  };
  
  saveShareKeyData(sanitizedKey, shareKeyData);
  
  // Add to user's accessible share keys
  if (!req.user.accessibleShareKeys) {
    req.user.accessibleShareKeys = [];
  }
  
  req.user.accessibleShareKeys.push({
    shareKey: sanitizedKey,
    ownerId: req.user.id,
    isOwner: true
  });
  
  // Set as current if it's the first one
  if (!req.user.currentShareKey) {
    req.user.currentShareKey = sanitizedKey;
  }
  
  res.json({
    success: true,
    shareKey: sanitizedKey,
    accessibleShareKeys: req.user.accessibleShareKeys,
    currentShareKey: req.user.currentShareKey
  });
});

// Set current share key
app.patch('/api/share-keys/current', requireAuth, express.json(), (req, res) => {
  const { shareKey } = req.body;
  
  if (!shareKey || typeof shareKey !== 'string') {
    return res.status(400).json({ error: 'Share key is required' });
  }
  
  // Verify user has access to this share key
  const hasAccess = req.user.accessibleShareKeys?.some(sk => sk.shareKey === shareKey);
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'You do not have access to this share key' });
  }
  
  req.user.currentShareKey = shareKey;
  
  res.json({
    success: true,
    currentShareKey: shareKey
  });
});

// Rename a share key (owner only)
app.patch('/api/share-keys/:oldKey/rename', requireAuth, express.json(), (req, res) => {
  const { oldKey } = req.params;
  const { newKey } = req.body;
  
  if (!newKey || typeof newKey !== 'string') {
    return res.status(400).json({ error: 'New share key is required' });
  }
  
  // Sanitize the new key
  const sanitizedNewKey = newKey.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (sanitizedNewKey.length < 3) {
    return res.status(400).json({ error: 'Share key must be at least 3 characters' });
  }
  
  // Verify user owns the old share key
  const shareKeyInfo = req.user.accessibleShareKeys?.find(sk => sk.shareKey === oldKey);
  
  if (!shareKeyInfo || !shareKeyInfo.isOwner) {
    return res.status(403).json({ error: 'You can only rename share keys you own' });
  }
  
  // Check if new key already exists
  if (shareKeyExists(sanitizedNewKey) && oldKey !== sanitizedNewKey) {
    return res.status(409).json({ error: 'This share key is already in use' });
  }
  
  // Rename the folder
  const oldPath = path.join(usersDir, oldKey);
  const newPath = path.join(usersDir, sanitizedNewKey);
  
  try {
    fs.renameSync(oldPath, newPath);
    
    // Update the .user.json with the new key
    const shareKeyData = loadShareKeyData(sanitizedNewKey);
    shareKeyData.key = sanitizedNewKey;
    saveShareKeyData(sanitizedNewKey, shareKeyData);
    
    // Update user's accessible share keys
    if (req.user.accessibleShareKeys) {
      const index = req.user.accessibleShareKeys.findIndex(sk => sk.shareKey === oldKey);
      if (index !== -1) {
        req.user.accessibleShareKeys[index].shareKey = sanitizedNewKey;
      }
    }
    
    // Update current share key if it was the renamed one
    if (req.user.currentShareKey === oldKey) {
      req.user.currentShareKey = sanitizedNewKey;
    }
    
    res.json({
      success: true,
      oldKey,
      newKey: sanitizedNewKey,
      accessibleShareKeys: req.user.accessibleShareKeys,
      currentShareKey: req.user.currentShareKey
    });
  } catch (err) {
    console.error('Error renaming share key folder:', err);
    res.status(500).json({ error: 'Failed to rename share key' });
  }
});

// User Management APIs (deprecated /api/user/key endpoint removed - use share keys instead)

app.patch('/api/user/openai-key', requireGM, express.json(), (req, res) => {
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }
  
  const { openaiApiKey } = req.body;
  
  if (!openaiApiKey || typeof openaiApiKey !== 'string') {
    return res.status(400).json({ error: 'OpenAI API key is required' });
  }
  
  // Basic validation - OpenAI keys should start with 'sk-'
  if (!openaiApiKey.startsWith('sk-')) {
    return res.status(400).json({ error: 'Invalid OpenAI API key format' });
  }
  
  // Update share key data file
  const shareKeyData = loadUserData(shareKey);
  shareKeyData.openaiApiKey = openaiApiKey;
  saveUserData(shareKey, shareKeyData);
  
  res.json({ success: true });
});

app.get('/api/user/openai-key', requireGM, (req, res) => {
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.json({ hasKey: false, maskedKey: null });
  }
  
  const shareKeyData = loadUserData(shareKey);
  
  // Return masked version for security
  const hasKey = !!shareKeyData.openaiApiKey;
  const maskedKey = hasKey 
    ? `${shareKeyData.openaiApiKey.substring(0, 7)}...${shareKeyData.openaiApiKey.substring(shareKeyData.openaiApiKey.length - 4)}`
    : null;
  
  res.json({ hasKey, maskedKey });
});

// Get GM list
app.get('/api/user/gms', requireGM, (req, res) => {
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.json({ gms: [] });
  }
  
  const shareKeyData = loadUserData(shareKey);
  
  res.json({ gms: shareKeyData.gms || [] });
});

// Add a GM
app.post('/api/user/gms', requireGM, (req, res) => {
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }
  
  const { email } = req.body;
  
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  
  const shareKeyData = loadUserData(shareKey);
  if (!shareKeyData.gms) {
    shareKeyData.gms = [];
  }
  
  // Don't add duplicates
  if (shareKeyData.gms.includes(email)) {
    return res.status(400).json({ error: 'GM already exists' });
  }
  
  shareKeyData.gms.push(email);
  saveUserData(shareKey, shareKeyData);
  
  res.json({ gms: shareKeyData.gms });
});

// Remove a GM
app.delete('/api/user/gms', requireGM, (req, res) => {
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }
  
  const { email } = req.body;
  
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  const shareKeyData = loadUserData(shareKey);
  if (!shareKeyData.gms) {
    shareKeyData.gms = [];
  }
  
  shareKeyData.gms = shareKeyData.gms.filter(gm => gm !== email);
  saveUserData(shareKey, shareKeyData);
  
  res.json({ gms: shareKeyData.gms });
});

// Campaign Management APIs
app.get('/api/campaigns', requireGM, (req, res) =>
{
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected. Please create or select a share key.' });
  }
  
  const userCampaignsDir = getUserCampaignsDir(shareKey);
  
  // Ensure user directory exists when they access campaign screen
  if (!fs.existsSync(userCampaignsDir))
  {
    fs.mkdirSync(userCampaignsDir, { recursive: true });
    console.log(`✓ Created campaigns directory for share key: ${shareKey}`);
  }
  
  fs.readdir(userCampaignsDir, (err, files) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read campaigns directory' });
    }

    const campaigns = files
      .filter(file =>
      {
        const stat = fs.statSync(path.join(userCampaignsDir, file));
        return stat.isDirectory();
      })
      .map(campaignName =>
      {
        const campaignPath = path.join(userCampaignsDir, campaignName);
        const scenariosPath = path.join(campaignPath, 'scenarios');

        // Count scenarios in the scenarios/ subfolder
        let scenarioCount = 0;
        if (fs.existsSync(scenariosPath))
        {
          const scenarios = fs.readdirSync(scenariosPath).filter(file =>
          {
            const stat = fs.statSync(path.join(scenariosPath, file));
            return stat.isDirectory();
          });
          scenarioCount = scenarios.length;
        }

        // Try to load metadata
        const metadataPath = path.join(campaignPath, '.metadata.json');
        let description = '';
        let backgroundImage = undefined;
        if (fs.existsSync(metadataPath))
        {
          try
          {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            description = metadata.description || '';
            // Convert old image paths to sharekey-based paths
            if (metadata.backgroundImage) {
              if (metadata.backgroundImage.startsWith('/images/')) {
                backgroundImage = `/users/${shareKey}${metadata.backgroundImage}`;
              } else {
                backgroundImage = metadata.backgroundImage;
              }
            }
          } catch (err)
          {
            console.error('Error reading campaign metadata:', err);
          }
        }

        return {
          name: campaignName,
          scenarioCount,
          description,
          backgroundImage
        };
      });

    res.json({ campaigns });
  });
});

app.post('/api/campaigns', requireGM, express.json(), (req, res) =>
{
  const { name } = req.body;
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }
  
  const userCampaignsDir = getUserCampaignsDir(shareKey);

  if (!name)
  {
    return res.status(400).json({ error: 'Campaign name required' });
  }

  const campaignPath = path.join(userCampaignsDir, name);

  if (fs.existsSync(campaignPath))
  {
    return res.status(400).json({ error: 'Campaign already exists' });
  }

  fs.mkdirSync(campaignPath, { recursive: true });
  res.json({ success: true, name });
});

app.patch('/api/campaigns/:campaignName', requireGM, express.json(), (req, res) =>
{
  const oldName = req.params.campaignName;
  const { name: newName, description, backgroundImage } = req.body;
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }
  
  const userCampaignsDir = getUserCampaignsDir(shareKey);
  const campaignPath = path.join(userCampaignsDir, oldName);
  const metadataPath = path.join(campaignPath, '.metadata.json');

  try
  {
    // Read existing metadata or create new one
    let metadata = { description: '' };
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      } catch (err) {
        console.error('Error reading metadata, using defaults:', err);
      }
    }
    
    // Update fields if provided
    if (description !== undefined) {
      metadata.description = description;
    }
    if (backgroundImage !== undefined) {
      metadata.backgroundImage = backgroundImage;
    }
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    // Rename folder if name changed
    if (newName && newName !== oldName)
    {
      if (currentCampaign === oldName)
      {
        return res.status(400).json({
          error: 'Cannot rename the current active campaign. Please select a different campaign first.'
        });
      }

      const newPath = path.join(userCampaignsDir, newName);
      if (fs.existsSync(newPath))
      {
        return res.status(400).json({ error: 'A campaign with this name already exists' });
      }

      // Use copy + delete approach to avoid permission issues with rename
      try
      {
        fs.cpSync(campaignPath, newPath, { recursive: true });
        fs.rmSync(campaignPath, { recursive: true, force: true });
      } catch (renameError)
      {
        if (fs.existsSync(newPath))
        {
          fs.rmSync(newPath, { recursive: true, force: true });
        }
        throw new Error('Campaign folder may be in use. Please close any open files and try again.');
      }
    }

    res.json({ success: true });
  } catch (error)
  {
    console.error('Error updating campaign:', error);
    res.status(500).json({ error: error.message || 'Failed to update campaign' });
  }
});

app.delete('/api/campaigns/:campaignName', requireGM, (req, res) =>
{
  const campaignName = req.params.campaignName;
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }
  
  const userCampaignsDir = getUserCampaignsDir(shareKey);
  const userArchivedDir = getUserArchivedCampaignsDir(shareKey);
  const campaignPath = path.join(userCampaignsDir, campaignName);

  if (!fs.existsSync(campaignPath))
  {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  // Create archived campaign path with timestamp
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const archivedPath = path.join(userArchivedDir, `${campaignName}_${timestamp}`);

  try
  {
    // Use copy + delete approach to avoid Windows permission issues
    fs.cpSync(campaignPath, archivedPath, { recursive: true });
    fs.rmSync(campaignPath, { recursive: true, force: true });
    res.json({ success: true, message: 'Campaign archived successfully' });
  } catch (error)
  {
    console.error('Error archiving campaign:', error);
    // Clean up partial copy if it exists
    if (fs.existsSync(archivedPath))
    {
      try
      {
        fs.rmSync(archivedPath, { recursive: true, force: true });
      } catch (cleanupErr)
      {
        console.error('Failed to cleanup after failed archive:', cleanupErr);
      }
    }
    res.status(500).json({ error: 'Failed to archive campaign' });
  }
});

// Archive a scenario
app.delete('/api/campaigns/:campaignName/scenarios/:scenarioName', requireGM, provideShareKey, (req, res) =>
{
  const { campaignName, scenarioName } = req.params;
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }
  
  const campaignsDir = getShareKeyCampaignsDir(shareKey);
  const campaignPath = path.join(campaignsDir, campaignName);
  const scenariosPath = path.join(campaignPath, 'scenarios');
  const scenarioPath = path.join(scenariosPath, scenarioName);
  const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');

  if (!fs.existsSync(scenarioPath))
  {
    return res.status(404).json({ error: 'Scenario not found' });
  }

  // Create archived scenarios path with timestamp
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const archivedPath = path.join(archivedScenariosPath, `${scenarioName}_${timestamp}`);

  try
  {
    // Use copy + delete approach to avoid Windows permission issues
    fs.cpSync(scenarioPath, archivedPath, { recursive: true });
    fs.rmSync(scenarioPath, { recursive: true, force: true });
    res.json({ success: true, message: 'Scenario archived successfully' });
  } catch (error)
  {
    console.error('Error archiving scenario:', error);
    // Clean up partial copy if it exists
    if (fs.existsSync(archivedPath))
    {
      try
      {
        fs.rmSync(archivedPath, { recursive: true, force: true });
      } catch (cleanupErr)
      {
        console.error('Failed to cleanup after failed archive:', cleanupErr);
      }
    }
    res.status(500).json({ error: 'Failed to archive scenario' });
  }
});

// Get archived scenarios for a campaign
app.get('/api/campaigns/:campaignName/archived-scenarios', requireGM, provideShareKey, (req, res) =>
{
  const { campaignName } = req.params;
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.json({ archived: [] });
  }
  
  const campaignsDir = getShareKeyCampaignsDir(shareKey);
  const campaignPath = path.join(campaignsDir, campaignName);
  const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');

  if (!fs.existsSync(archivedScenariosPath))
  {
    return res.json({ archived: [] });
  }

  fs.readdir(archivedScenariosPath, (err, files) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read archived scenarios' });
    }

    const archived = files
      .filter(file =>
      {
        const stat = fs.statSync(path.join(archivedScenariosPath, file));
        return stat.isDirectory();
      })
      .map(folderName =>
      {
        // Extract original name and timestamp from folder name
        const lastUnderscore = folderName.lastIndexOf('_');
        const originalName = folderName.substring(0, lastUnderscore);
        const timestamp = folderName.substring(lastUnderscore + 1);

        return {
          folderName,
          originalName,
          archivedAt: timestamp
        };
      })
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)); // Most recent first

    res.json({ archived });
  });
});

// Restore archived scenario
app.post('/api/campaigns/:campaignName/archived-scenarios/:folderName/restore', requireGM, provideShareKey, (req, res) =>
{
  const { campaignName, folderName } = req.params;
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }
  
  const campaignsDir = getShareKeyCampaignsDir(shareKey);
  const campaignPath = path.join(campaignsDir, campaignName);
  const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');
  const scenariosPath = path.join(campaignPath, 'scenarios');
  const archivedPath = path.join(archivedScenariosPath, folderName);

  if (!fs.existsSync(archivedPath))
  {
    return res.status(404).json({ error: 'Archived scenario not found' });
  }

  // Extract original name
  const lastUnderscore = folderName.lastIndexOf('_');
  const originalName = folderName.substring(0, lastUnderscore);
  const restoredPath = path.join(scenariosPath, originalName);

  // Check if a scenario with the same name already exists
  if (fs.existsSync(restoredPath))
  {
    return res.status(400).json({ error: 'A scenario with this name already exists' });
  }

  try
  {
    // Move archived folder back to scenarios
    fs.renameSync(archivedPath, restoredPath);
    res.json({ success: true, message: 'Scenario restored successfully' });
  } catch (error)
  {
    console.error('Error restoring scenario:', error);
    res.status(500).json({ error: 'Failed to restore scenario' });
  }
});

// Permanently delete archived scenario
app.delete('/api/campaigns/:campaignName/archived-scenarios/:folderName', requireGM, provideShareKey, (req, res) =>
{
  const { campaignName, folderName } = req.params;
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }
  
  const campaignsDir = getShareKeyCampaignsDir(shareKey);
  const campaignPath = path.join(campaignsDir, campaignName);
  const archivedScenariosPath = path.join(campaignPath, 'archived-scenarios');
  const archivedPath = path.join(archivedScenariosPath, folderName);

  if (!fs.existsSync(archivedPath))
  {
    return res.status(404).json({ error: 'Archived scenario not found' });
  }

  try
  {
    // Permanently delete the archived folder
    fs.rmSync(archivedPath, { recursive: true, force: true });
    res.json({ success: true, message: 'Scenario permanently deleted' });
  } catch (error)
  {
    console.error('Error deleting archived scenario:', error);
    res.status(500).json({ error: 'Failed to delete scenario' });
  }
});

app.get('/api/archived-campaigns', requireGM, (req, res) =>
{
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.json({ archived: [] });
  }
  
  const userArchivedDir = getUserArchivedCampaignsDir(shareKey);

  fs.readdir(userArchivedDir, (err, files) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read archived campaigns' });
    }

    const archived = files
      .filter(file =>
      {
        const stat = fs.statSync(path.join(userArchivedDir, file));
        return stat.isDirectory();
      })
      .map(folderName =>
      {
        // Extract original name and timestamp from folder name
        const lastUnderscore = folderName.lastIndexOf('_');
        const originalName = folderName.substring(0, lastUnderscore);
        const timestamp = folderName.substring(lastUnderscore + 1);

        return {
          folderName,
          originalName,
          archivedAt: timestamp
        };
      })
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)); // Most recent first

    res.json({ archived });
  });
});

app.post('/api/archived-campaigns/:folderName/restore', requireGM, provideShareKey, (req, res) =>
{
  const folderName = req.params.folderName;
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }
  
  const userArchivedDir = getUserArchivedCampaignsDir(shareKey);
  const userCampaignsDir = getUserCampaignsDir(shareKey);
  const archivedPath = path.join(userArchivedDir, folderName);

  if (!fs.existsSync(archivedPath))
  {
    return res.status(404).json({ error: 'Archived campaign not found' });
  }

  // Extract original name
  const lastUnderscore = folderName.lastIndexOf('_');
  const originalName = folderName.substring(0, lastUnderscore);
  const restoredPath = path.join(userCampaignsDir, originalName);

  // Check if a campaign with the same name already exists
  if (fs.existsSync(restoredPath))
  {
    return res.status(400).json({ error: 'A campaign with this name already exists' });
  }

  try
  {
    // Move archived folder back to campaigns
    fs.renameSync(archivedPath, restoredPath);
    res.json({ success: true, message: 'Campaign restored successfully' });
  } catch (error)
  {
    console.error('Error restoring campaign:', error);
    res.status(500).json({ error: 'Failed to restore campaign' });
  }
});

app.delete('/api/archived-campaigns/:folderName', requireGM, provideShareKey, (req, res) =>
{
  const folderName = req.params.folderName;
  const shareKey = req.shareKey;
  
  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }
  
  const userArchivedDir = getUserArchivedCampaignsDir(shareKey);
  const archivedPath = path.join(userArchivedDir, folderName);

  if (!fs.existsSync(archivedPath))
  {
    return res.status(404).json({ error: 'Archived campaign not found' });
  }

  try
  {
    // Permanently delete the archived folder
    fs.rmSync(archivedPath, { recursive: true, force: true });
    res.json({ success: true, message: 'Campaign permanently deleted' });
  } catch (error)
  {
    console.error('Error deleting archived campaign:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

app.get('/api/campaigns/:campaignName/scenarios', requireAuth, provideShareKey, (req, res) =>
{
  const campaignsDir = getShareKeyCampaignsDir(req.shareKey);
  const campaignPath = path.join(campaignsDir, req.params.campaignName);
  const scenariosPath = path.join(campaignPath, 'scenarios');

  // Get campaign metadata for background image
  let campaignBackgroundImage = undefined;
  const campaignMetadataPath = path.join(campaignPath, '.metadata.json');
  if (fs.existsSync(campaignMetadataPath))
  {
    try
    {
      const metadata = JSON.parse(fs.readFileSync(campaignMetadataPath, 'utf-8'));
      // Convert old image paths to sharekey-based paths
      if (metadata.backgroundImage) {
        if (metadata.backgroundImage.startsWith('/images/')) {
          campaignBackgroundImage = `/users/${req.shareKey}${metadata.backgroundImage}`;
        } else {
          campaignBackgroundImage = metadata.backgroundImage;
        }
      }
    } catch (err)
    {
      console.error('Failed to read campaign metadata:', err);
    }
  }

  if (!fs.existsSync(scenariosPath))
  {
    return res.json({ scenarios: [], campaignBackgroundImage });
  }

  fs.readdir(scenariosPath, (err, files) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read scenarios' });
    }

    const scenarios = files
      .filter(file =>
      {
        const stat = fs.statSync(path.join(scenariosPath, file));
        return stat.isDirectory();
      })
      .map(scenarioName =>
      {
        const scenarioPath = path.join(scenariosPath, scenarioName);
        const maps = fs.readdirSync(scenarioPath).filter(file => file.endsWith('.json'));

        let description = '';
        const metadataPath = path.join(scenarioPath, '.metadata.json');
        if (fs.existsSync(metadataPath))
        {
          try
          {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
            description = metadata.description || '';
          } catch (err)
          {
            console.error('Failed to read scenario metadata:', err);
          }
        }

        // Get background image from scenario state
        let mapImageUrl = undefined;
        const scenarioStatePath = path.join(scenarioPath, '.scenario-state.json');
        if (fs.existsSync(scenarioStatePath))
        {
          try
          {
            const scenarioState = JSON.parse(fs.readFileSync(scenarioStatePath, 'utf-8'));
            if (scenarioState.backgroundImage)
            {
              // Convert old paths like "/images/maps/filename.jpg" to sharekey paths
              if (scenarioState.backgroundImage.startsWith('/images/')) {
                mapImageUrl = `/users/${req.shareKey}${scenarioState.backgroundImage}`;
              } else {
                mapImageUrl = scenarioState.backgroundImage;
              }
            }
          } catch (err)
          {
            console.error('Failed to read scenario state:', err);
          }
        }

        return {
          name: scenarioName,
          mapCount: maps.length,
          description,
          mapImageUrl
        };
      });

    res.json({ scenarios, campaignBackgroundImage });
  });
});

app.post('/api/campaigns/:campaignName/scenarios', requireGM, provideShareKey, express.json(), (req, res) =>
{
  const { name } = req.body;
  const campaignsDir = getShareKeyCampaignsDir(req.shareKey);
  const campaignPath = path.join(campaignsDir, req.params.campaignName);
  const scenariosPath = path.join(campaignPath, 'scenarios');

  if (!name)
  {
    return res.status(400).json({ error: 'Scenario name required' });
  }

  if (!fs.existsSync(campaignPath))
  {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  if (!fs.existsSync(scenariosPath))
  {
    fs.mkdirSync(scenariosPath, { recursive: true });
  }

  const scenarioPath = path.join(scenariosPath, name);

  if (fs.existsSync(scenarioPath))
  {
    return res.status(400).json({ error: 'Scenario already exists' });
  }

  // Create scenario directory
  fs.mkdirSync(scenarioPath, { recursive: true });

  res.json({ success: true, name });
});

// Check if scenario has any existing maps
app.get('/api/scenario-maps', requireAuth, (req, res) =>
{
  if (!currentCampaign || !currentScenario || !currentShareKey)
  {
    return res.status(400).json({ error: 'No campaign/scenario context set' });
  }

  const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario);

  if (!fs.existsSync(scenarioPath))
  {
    return res.json({ hasExistingMap: false });
  }

  try
  {
    // Check if there's a saved scenario state with backgroundImage
    const savedState = loadScenarioGameState();
    if (savedState && savedState.backgroundImage)
    {
      return res.json({
        hasExistingMap: true,
        backgroundImage: savedState.backgroundImage
      });
    }

    return res.json({ hasExistingMap: false });
  } catch (error)
  {
    console.error('Error checking scenario maps:', error);
    return res.json({ hasExistingMap: false });
  }
});

app.patch('/api/campaigns/:campaignName/scenarios/:scenarioName', requireGM, provideShareKey, express.json(), (req, res) =>
{
  const { description, newName } = req.body;
  const campaignsDir = getShareKeyCampaignsDir(req.shareKey);
  const campaignPath = path.join(campaignsDir, req.params.campaignName);
  const scenariosPath = path.join(campaignPath, 'scenarios');
  const scenarioPath = path.join(scenariosPath, req.params.scenarioName);

  if (!fs.existsSync(scenarioPath))
  {
    return res.status(404).json({ error: 'Scenario not found' });
  }

  try
  {
    if (description !== undefined)
    {
      const metadataPath = path.join(scenarioPath, '.metadata.json');
      const metadata = { description };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    }

    if (newName && newName !== req.params.scenarioName)
    {
      const newPath = path.join(scenariosPath, newName);

      if (fs.existsSync(newPath))
      {
        return res.status(400).json({ error: 'A scenario with that name already exists' });
      }

      if (currentCampaign === req.params.campaignName && currentScenario === req.params.scenarioName)
      {
        return res.status(400).json({ error: 'Cannot rename the current active scenario' });
      }

      try
      {
        fs.cpSync(scenarioPath, newPath, { recursive: true });
        fs.rmSync(scenarioPath, { recursive: true, force: true });
      } catch (err)
      {
        if (fs.existsSync(newPath))
        {
          try
          {
            fs.rmSync(newPath, { recursive: true, force: true });
          } catch (cleanupErr)
          {
            console.error('Failed to cleanup after failed rename:', cleanupErr);
          }
        }
        throw err;
      }
    }

    res.json({ success: true });
  } catch (err)
  {
    console.error('Error updating scenario:', err);
    res.status(500).json({ error: 'Failed to update scenario' });
  }
});

app.post('/api/set-context', requireGM, provideShareKey, express.json(), (req, res) =>
{
  const { campaign, scenario } = req.body;
  const shareKey = req.shareKey;

  if (!shareKey) {
    return res.status(400).json({ error: 'No share key selected' });
  }

  const campaignsDir = getShareKeyCampaignsDir(shareKey);

  if (!campaign || !scenario)
  {
    return res.status(400).json({ error: 'Campaign and scenario required' });
  }

  const scenarioPath = path.join(campaignsDir, campaign, 'scenarios', scenario);

  if (!fs.existsSync(scenarioPath))
  {
    return res.status(404).json({ error: 'Scenario not found' });
  }

  currentCampaign = campaign;
  currentScenario = scenario;
  currentUserId = req.user.id;
  currentShareKey = shareKey; // Store shareKey for file path resolution
  
  // Clear session state when setting context (we're in edit mode)
  isSessionActive = false;
  currentSessionName = null;
  console.log('Context set to:', campaign, '/', scenario, '(EDIT MODE)');

  // Load scenario game state from file if it exists
  const savedState = loadScenarioGameState();
  if (savedState)
  {
    gameState = { ...savedState };
    console.log('Loaded scenario game state from file');
  } else
  {
    // Reset to default state if no saved state exists
    gameState = {
      backgroundImage: null,
      tokens: [],
      props: [],
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      fogEnabled: 'off-gm',
      fogRevealDistance: 3,
      playerFogOpacity: 1,
      lightingCondition: 'bright',
      revealedPath: [],
      gridColumns: 100,
      gridRows: 100,
      showGrid: true,
      imageDimensions: null
    };
  }

  res.json({ success: true, campaign, scenario });
});

// Load a map - reads from JSON file and sets it as current state
app.post('/api/load-map', requireGM, express.json(), (req, res) =>
{
  const { filename } = req.body;

  if (!filename)
  {
    return res.status(400).json({ error: 'Filename required' });
  }

  if (!currentCampaign || !currentScenario || !currentShareKey)
  {
    return res.status(400).json({ error: 'No campaign/scenario context set' });
  }

  const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const metadataPath = path.join(scenarioPath, '.scenario-state.json');

  // Load metadata from file
  if (fs.existsSync(metadataPath))
  {
    try
    {
      const data = fs.readFileSync(metadataPath, 'utf8');
      const metadata = JSON.parse(data);

      // Load player tokens from campaign directory and NPC tokens from scenario directory
      const playerTokens = loadPlayerTokens();
      const npcTokens = loadNPCTokens();
      const props = loadProps();

      // Preserve runtime-only values from existing gameState
      const currentActorId = gameState.currentActorId;
      const showObserverCards = gameState.showObserverCards;

      // Set as current game state, merging player and NPC tokens
      gameState = {
        backgroundImage: `/users/${currentShareKey}/images/maps/${filename}`,
        tokens: [...playerTokens, ...npcTokens],
        props: props,
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        fogEnabled: metadata.fogEnabled || 'off-gm',
        fogRevealDistance: metadata.fogRevealDistance || 3,
        playerFogOpacity: 1,
        lightingCondition: metadata.lightingCondition || 'bright',
        revealedPath: metadata.revealedPath || [],
        revealZones: metadata.revealZones || [],
        permanentlyRevealedZones: metadata.permanentlyRevealedZones || [],
        gridColumns: metadata.gridColumns || 20,
        gridRows: metadata.gridRows || 20,
        showGrid: metadata.showGrid !== undefined ? metadata.showGrid : true,
        imageDimensions: null,
        currentActorId,
        showObserverCards
      };

      res.json({ success: true, state: gameState });
    } catch (error)
    {
      console.error('Failed to parse metadata:', error);
      res.status(500).json({ error: 'Failed to parse metadata file' });
    }
  } else
  {
    // No metadata file, create default state with player tokens
    const playerTokens = loadPlayerTokens();
    const props = loadProps();

    // Preserve runtime-only values from existing gameState
    const currentActorId = gameState.currentActorId;
    const showObserverCards = gameState.showObserverCards;

    gameState = {
      backgroundImage: `/users/${currentShareKey}/images/maps/${filename}`,
      tokens: playerTokens,
      props: props,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      fogEnabled: 'off-gm',
      fogRevealDistance: 3,
      playerFogOpacity: 1,
      revealZones: [],
      permanentlyRevealedZones: [],
      lightingCondition: 'bright',
      revealedPath: [],
      gridColumns: 20,
      gridRows: 20,
      showGrid: true,
      imageDimensions: null,
      currentActorId,
      showObserverCards
    };

    res.json({ success: true, state: gameState });
  }
});

// Get current game state (with optional session parameter for observer/player views)
app.get('/api/game-state', (req, res) =>
{
  const { session, campaign } = req.query;

  // If campaign and session parameters provided, load from session metadata
  if (campaign && session)
  {
    try
    {
      // Observer view is public - try to get shareKey from user if authenticated,
      // otherwise look it up by searching share key directories
      let shareKey = req.user?.currentShareKey;
      
      if (!shareKey)
      {
        // Public access - need to find which share key directory contains this campaign
        const shareKeyDirs = fs.readdirSync(path.join(__dirname, 'users'));
        for (const dir of shareKeyDirs)
        {
          // Skip special directories like 'sessions'
          if (dir === 'sessions') continue;
          
          const shareKeyPath = path.join(__dirname, 'users', dir);
          const campaignsPath = path.join(shareKeyPath, 'campaigns', campaign);
          if (fs.existsSync(campaignsPath))
          {
            // Found the campaign - dir is the share key
            shareKey = dir;
            break;
          }
        }
        
        if (!shareKey)
        {
          return res.status(404).json({ error: 'Campaign not found' });
        }
      }
      const campaignsDir = getShareKeyCampaignsDir(shareKey);
      const campaignPath = path.join(campaignsDir, campaign);
      const sessionPath = path.join(campaignPath, 'sessions', session);
      const sessionMetadataPath = path.join(sessionPath, '.session-metadata.json');

      if (!fs.existsSync(sessionMetadataPath))
      {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Read session metadata to determine current scenario
      const sessionMetadata = JSON.parse(fs.readFileSync(sessionMetadataPath, 'utf-8'));
      const scenario = sessionMetadata.currentScenario;

      // Load state from session/scenario folder
      const sessionScenarioPath = path.join(sessionPath, 'scenarios', scenario);
      const sessionStatePath = path.join(sessionScenarioPath, '.runtime-state.json');

      if (!fs.existsSync(sessionStatePath))
      {
        return res.status(404).json({ error: 'Session scenario state not found' });
      }

      const sessionStateData = fs.readFileSync(sessionStatePath, 'utf-8');
      const sessionState = JSON.parse(sessionStateData);

      // Fix background image URL to include share key prefix
      if (sessionState.backgroundImage) {
        if (sessionState.backgroundImage.startsWith('/images/')) {
          // Old path format - prepend sharekey
          sessionState.backgroundImage = `/users/${shareKey}${sessionState.backgroundImage}`;
        } else if (!sessionState.backgroundImage.startsWith('/users/') && !sessionState.backgroundImage.startsWith('http')) {
          // Bare filename - assume it's in the maps folder
          sessionState.backgroundImage = `/users/${shareKey}/images/maps/${sessionState.backgroundImage}`;
        }
      }

      // Load tokens from session/scenario folder
      const playerTokens = [];
      const npcTokens = [];
      const props = [];

      // Load player tokens from session
      const sessionPlayerTokensPath = path.join(sessionScenarioPath, 'playertokens');
      if (fs.existsSync(sessionPlayerTokensPath))
      {
        const files = fs.readdirSync(sessionPlayerTokensPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            const tokenData = fs.readFileSync(path.join(sessionPlayerTokensPath, file), 'utf-8');
            const token = JSON.parse(tokenData);
            // Ensure image paths have the sharekey prefix
            if (token.imageUrl) {
              if (token.imageUrl.startsWith('/images/')) {
                // Old path format - prepend sharekey
                token.imageUrl = `/users/${shareKey}${token.imageUrl}`;
              } else if (!token.imageUrl.startsWith('/users/') && !token.imageUrl.startsWith('http')) {
                // Bare filename - assume it's in the token images folder
                token.imageUrl = `/users/${shareKey}/images/token/${token.imageUrl}`;
              }
            }
            if (token.portraitUrl) {
              if (token.portraitUrl.startsWith('/images/')) {
                token.portraitUrl = `/users/${shareKey}${token.portraitUrl}`;
              } else if (!token.portraitUrl.startsWith('/users/') && !token.portraitUrl.startsWith('http')) {
                token.portraitUrl = `/users/${shareKey}/images/portrait/${token.portraitUrl}`;
              }
            }
            playerTokens.push(token);
          }
        }
      }

      // Load NPC tokens from session
      const sessionNPCTokensPath = path.join(sessionScenarioPath, 'npctokens');
      if (fs.existsSync(sessionNPCTokensPath))
      {
        const files = fs.readdirSync(sessionNPCTokensPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            const tokenData = fs.readFileSync(path.join(sessionNPCTokensPath, file), 'utf-8');
            const token = JSON.parse(tokenData);
            // Ensure image paths have the sharekey prefix
            if (token.imageUrl) {
              if (token.imageUrl.startsWith('/images/')) {
                // Old path format - prepend sharekey
                token.imageUrl = `/users/${shareKey}${token.imageUrl}`;
              } else if (!token.imageUrl.startsWith('/users/') && !token.imageUrl.startsWith('http')) {
                // Bare filename - assume it's in the token images folder
                token.imageUrl = `/users/${shareKey}/images/token/${token.imageUrl}`;
              }
            }
            if (token.portraitUrl) {
              if (token.portraitUrl.startsWith('/images/')) {
                token.portraitUrl = `/users/${shareKey}${token.portraitUrl}`;
              } else if (!token.portraitUrl.startsWith('/users/') && !token.portraitUrl.startsWith('http')) {
                token.portraitUrl = `/users/${shareKey}/images/portrait/${token.portraitUrl}`;
              }
            }
            npcTokens.push(token);
          }
        }
      }

      // Load props from session
      const sessionPropsPath = path.join(sessionScenarioPath, 'props');
      if (fs.existsSync(sessionPropsPath))
      {
        const files = fs.readdirSync(sessionPropsPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            const propData = fs.readFileSync(path.join(sessionPropsPath, file), 'utf-8');
            const prop = JSON.parse(propData);
            // Ensure image paths have the sharekey prefix
            if (prop.imageUrl) {
              if (prop.imageUrl.startsWith('/images/')) {
                // Old path format - prepend sharekey
                prop.imageUrl = `/users/${shareKey}${prop.imageUrl}`;
              } else if (!prop.imageUrl.startsWith('/users/') && !prop.imageUrl.startsWith('http')) {
                // Bare filename - assume it's in the props images folder
                prop.imageUrl = `/users/${shareKey}/images/props/${prop.imageUrl}`;
              }
            }
            props.push(prop);
          }
        }
      }

      sessionState.tokens = [...playerTokens, ...npcTokens];
      sessionState.props = props;

      // Ensure showObserverCards has a default value if not set
      if (sessionState.showObserverCards === undefined)
      {
        sessionState.showObserverCards = true;
      }

      // Ensure revealZones and permanentlyRevealedZones exist
      if (!sessionState.revealZones) {
        sessionState.revealZones = [];
      }
      if (!sessionState.permanentlyRevealedZones) {
        sessionState.permanentlyRevealedZones = [];
      }

      // Check if this session is currently active
      const isThisSessionActive = (isSessionActive && currentCampaign === campaign && currentSessionName === session);

      return res.json({
        state: sessionState,
        sessionActive: isThisSessionActive,
        sessionName: session,
        campaignName: campaign,
        scenarioName: scenario
      });
    } catch (error)
    {
      console.error('Failed to load session state:', error);
      return res.status(500).json({ error: 'Failed to load session state' });
    }
  }

  // Default: return current gameState
  // In edit mode, reload tokens and props from disk to ensure they're fresh
  if (currentCampaign && currentScenario)
  {
    const playerTokens = loadPlayerTokens();
    const npcTokens = loadNPCTokens();
    gameState.tokens = [...playerTokens, ...npcTokens];
    gameState.props = loadProps();
  }
  

  
  res.json({ state: gameState, sessionActive: isSessionActive });
});

// Get scenario metadata (including lastSessionPlayed)
app.get('/api/scenario-metadata', requireAuth, (req, res) =>
{
  if (!currentCampaign || !currentScenario || !currentShareKey)
  {
    return res.json({ lastSessionPlayed: null });
  }

  try
  {
    const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
    const definitionPath = path.join(scenarioPath, '.scenario-state.json');

    if (!fs.existsSync(definitionPath))
    {
      return res.json({ lastSessionPlayed: null });
    }

    const definitionData = JSON.parse(fs.readFileSync(definitionPath, 'utf-8'));
    res.json({ lastSessionPlayed: definitionData.lastSessionPlayed || null });
  } catch (err)
  {
    console.error('Failed to get scenario metadata:', err);
    res.status(500).json({ error: 'Failed to get scenario metadata' });
  }
});

// List available sessions for current campaign (campaign-wide, not scenario-specific)
app.get('/api/sessions', requireAuth, (req, res) =>
{
  if (!currentCampaign || !currentShareKey)
  {
    return res.json({ sessions: [] });
  }

  try
  {
    const campaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const campaignPath = path.join(campaignsDir, currentCampaign);
    const sessionsPath = path.join(campaignPath, 'sessions');

    if (!fs.existsSync(sessionsPath))
    {
      return res.json({ sessions: [] });
    }

    const sessions = fs.readdirSync(sessionsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    res.json({ sessions });
  } catch (err)
  {
    console.error('Failed to list sessions:', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Start a game session (create session folder if new, or load existing)
// Sessions are now campaign-wide and track which scenario they're on
app.post('/api/session/start', requireGM, express.json(), (req, res) =>
{
  if (!currentCampaign || !currentScenario || !currentShareKey)
  {
    return res.status(400).json({ error: 'No campaign/scenario context set' });
  }

  if (isSessionActive)
  {
    return res.status(400).json({ error: 'Session already active' });
  }

  const { sessionName } = req.body;
  if (!sessionName || sessionName.trim() === '')
  {
    return res.status(400).json({ error: 'Session name is required' });
  }

  try
  {
    const userCampaignsDir = getShareKeyCampaignsDir(currentShareKey);
    const campaignPath = path.join(userCampaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', sessionName);
    const sessionScenarioPath = path.join(sessionPath, 'scenarios', currentScenario);
    const scenarioPath = path.join(userCampaignsDir, currentCampaign, 'scenarios', currentScenario);
    
    // Check if session already exists
    const sessionExists = fs.existsSync(sessionPath);
    const sessionMetadataPath = path.join(sessionPath, '.session-metadata.json');

    if (!sessionExists)
    {
      // NEW SESSION: Create at campaign level
      fs.mkdirSync(sessionPath, { recursive: true });

      // Create session metadata to track current scenario
      const sessionMetadata = {
        currentScenario: currentScenario,
        createdAt: new Date().toISOString(),
        lastPlayed: new Date().toISOString()
      };
      fs.writeFileSync(sessionMetadataPath, JSON.stringify(sessionMetadata, null, 2));

      // Create scenario subfolder for this session
      fs.mkdirSync(sessionScenarioPath, { recursive: true });

      // Copy scenario state
      const sourceStatePath = path.join(scenarioPath, '.scenario-state.json');
      const sessionStatePath = path.join(sessionScenarioPath, '.runtime-state.json');
      if (fs.existsSync(sourceStatePath))
      {
        const definitionState = JSON.parse(fs.readFileSync(sourceStatePath, 'utf-8'));
        // showObserverCards is runtime-only, always initialize to true for new sessions
        definitionState.showObserverCards = true;

        fs.writeFileSync(sessionStatePath, JSON.stringify(definitionState, null, 2));
      }

      // Copy player tokens
      const playerTokensPath = path.join(campaignPath, 'playertokens');
      const sessionPlayerTokensPath = path.join(sessionScenarioPath, 'playertokens');
      if (fs.existsSync(playerTokensPath))
      {
        fs.mkdirSync(sessionPlayerTokensPath, { recursive: true });
        const files = fs.readdirSync(playerTokensPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            fs.copyFileSync(
              path.join(playerTokensPath, file),
              path.join(sessionPlayerTokensPath, file)
            );
          }
        }
      }

      // Copy NPC tokens from scenario
      const npcTokensPath = path.join(scenarioPath, 'npctokens');
      const sessionNPCTokensPath = path.join(sessionScenarioPath, 'npctokens');
      if (fs.existsSync(npcTokensPath))
      {
        fs.mkdirSync(sessionNPCTokensPath, { recursive: true });
        const files = fs.readdirSync(npcTokensPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            fs.copyFileSync(
              path.join(npcTokensPath, file),
              path.join(sessionNPCTokensPath, file)
            );
          }
        }
      }

      // Copy props from scenario
      const propsPath = path.join(scenarioPath, 'props');
      const sessionPropsPath = path.join(sessionScenarioPath, 'props');
      if (fs.existsSync(propsPath))
      {
        fs.mkdirSync(sessionPropsPath, { recursive: true });
        const files = fs.readdirSync(propsPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            fs.copyFileSync(
              path.join(propsPath, file),
              path.join(sessionPropsPath, file)
            );
          }
        }
      }

      console.log('Created new session:', sessionName, 'starting on scenario:', currentScenario);
    } else
    {
      // EXISTING SESSION: Load session metadata and check scenario state
      const sessionMetadata = JSON.parse(fs.readFileSync(sessionMetadataPath, 'utf-8'));
      const previousScenario = sessionMetadata.currentScenario;
      
      // Check if this scenario already exists in the session
      const sessionScenarioExists = fs.existsSync(sessionScenarioPath);
      
      if (!sessionScenarioExists)
      {
        // First time playing this scenario in this session - copy from definition
        console.log('Session', sessionName, 'entering new scenario:', currentScenario);
        fs.mkdirSync(sessionScenarioPath, { recursive: true });
        
        // Copy scenario state
        const sourceStatePath = path.join(scenarioPath, '.scenario-state.json');
        const sessionStatePath = path.join(sessionScenarioPath, '.runtime-state.json');
        if (fs.existsSync(sourceStatePath))
        {
          const definitionState = JSON.parse(fs.readFileSync(sourceStatePath, 'utf-8'));
          definitionState.showObserverCards = true;
          fs.writeFileSync(sessionStatePath, JSON.stringify(definitionState, null, 2));
        }
        
        // Copy player tokens from campaign
        const playerTokensPath = path.join(campaignPath, 'playertokens');
        const sessionPlayerTokensPath = path.join(sessionScenarioPath, 'playertokens');
        if (fs.existsSync(playerTokensPath))
        {
          fs.mkdirSync(sessionPlayerTokensPath, { recursive: true });
          const files = fs.readdirSync(playerTokensPath);
          for (const file of files)
          {
            if (file.endsWith('.json'))
            {
              fs.copyFileSync(
                path.join(playerTokensPath, file),
                path.join(sessionPlayerTokensPath, file)
              );
            }
          }
        }
        
        // Copy NPC tokens from scenario definition
        const npcTokensPath = path.join(scenarioPath, 'npctokens');
        const sessionNPCTokensPath = path.join(sessionScenarioPath, 'npctokens');
        if (fs.existsSync(npcTokensPath))
        {
          fs.mkdirSync(sessionNPCTokensPath, { recursive: true });
          const files = fs.readdirSync(npcTokensPath);
          for (const file of files)
          {
            if (file.endsWith('.json'))
            {
              fs.copyFileSync(
                path.join(npcTokensPath, file),
                path.join(sessionNPCTokensPath, file)
              );
            }
          }
        }
        
        // Copy props from scenario definition
        const propsPath = path.join(scenarioPath, 'props');
        const sessionPropsPath = path.join(sessionScenarioPath, 'props');
        if (fs.existsSync(propsPath))
        {
          fs.mkdirSync(sessionPropsPath, { recursive: true });
          const files = fs.readdirSync(propsPath);
          for (const file of files)
          {
            if (file.endsWith('.json'))
            {
              fs.copyFileSync(
                path.join(propsPath, file),
                path.join(sessionPropsPath, file)
              );
            }
          }
        }
      }
      
      // Update session metadata with current scenario
      sessionMetadata.currentScenario = currentScenario;
      sessionMetadata.lastPlayed = new Date().toISOString();
      fs.writeFileSync(sessionMetadataPath, JSON.stringify(sessionMetadata, null, 2));
      console.log('Loading session:', sessionName, 'on scenario:', currentScenario);
    }

    currentSessionName = sessionName;
    isSessionActive = true; // Set to true for session mode

    // Reload game state from session files
    const loadedState = loadScenarioGameState();
    if (loadedState)
    {
      gameState = loadedState;
      console.log('Loaded session state - showObserverCards:', gameState.showObserverCards);
    } else
    {
      console.log('Warning: No state loaded from session files');
    }

    console.log('Game session started:', sessionName, 'for', currentCampaign, currentScenario);
    res.json({ success: true, isSessionActive: true, sessionName });
  } catch (err)
  {
    console.error('Failed to start session:', err);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// End a game session (keep session files for later, just deactivate and switch to edit mode)
app.post('/api/session/end', requireGM, express.json(), (req, res) =>
{
  if (!isSessionActive)
  {
    return res.status(400).json({ error: 'No active session' });
  }

  try
  {
    const campaignPath = path.join(campaignsDir, currentCampaign);
    const sessionPath = path.join(campaignPath, 'sessions', currentSessionName);

    // Read session metadata to get current scenario
    const metadataPath = path.join(sessionPath, '.session-metadata.json');
    let sessionScenario = currentScenario;
    if (fs.existsSync(metadataPath))
    {
      const sessionMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      sessionScenario = sessionMetadata.currentScenario;
    }

    // Deactivate all player tokens in the session
    const sessionPlayerTokensPath = path.join(sessionPath, 'scenarios', sessionScenario, 'playertokens');
    if (fs.existsSync(sessionPlayerTokensPath))
    {
      const sessionTokenFiles = fs.readdirSync(sessionPlayerTokensPath);
      for (const file of sessionTokenFiles)
      {
        if (file.endsWith('.json'))
        {
          const tokenPath = path.join(sessionPlayerTokensPath, file);
          const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
          tokenData.active = false;
          fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));
        }
      }
      console.log(`Deactivated ${sessionTokenFiles.length} player tokens in session`);
    }

    // Update session metadata
    const sessionMetadataPath = path.join(sessionPath, '.session-metadata.json');
    if (fs.existsSync(sessionMetadataPath))
    {
      const sessionMetadata = JSON.parse(fs.readFileSync(sessionMetadataPath, 'utf-8'));
      sessionMetadata.lastPlayed = new Date().toISOString();
      fs.writeFileSync(sessionMetadataPath, JSON.stringify(sessionMetadata, null, 2));
    }

    const endedSessionName = currentSessionName;
    isSessionActive = false;
    currentSessionName = null;

    // Reload game state from definition files for editing
    const loadedState = loadScenarioGameState();
    if (loadedState)
    {
      gameState = loadedState;
      console.log('Game state reloaded from definition files for editing, tokens:', gameState.tokens.length);
    }

    console.log('Game session ended:', endedSessionName, 'for', currentCampaign, currentScenario);
    res.json({ 
      success: true, 
      isSessionActive: false,
      gameState: gameState
    });
  } catch (err)
  {
    console.error('Failed to end session:', err);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// Get session status
app.get('/api/session/status', (req, res) =>
{
  res.json({
    isSessionActive,
    sessionName: currentSessionName
  });
});

// Update game state (and save to map JSON)
app.post('/api/game-state', requireGM, express.json(), (req, res) =>
{
  const { state } = req.body;

  if (!state)
  {
    return res.status(400).json({ error: 'State required' });
  }

  // Update in-memory state (last write wins)
  gameState = { ...state };

  // Separate player tokens from NPC tokens
  const playerTokens = gameState.tokens.filter(t => t.actor?.player);
  const npcTokens = gameState.tokens.filter(t => !t.actor?.player);

  // Get existing tokens from disk
  const existingPlayerTokens = loadPlayerTokens();
  const existingNPCTokens = loadNPCTokens();

  // Save current player tokens individually to campaign directory
  for (const playerToken of playerTokens)
  {
    savePlayerToken(playerToken);
  }

  // Save current NPC tokens individually to scenario directory
  for (const npcToken of npcTokens)
  {
    saveNPCToken(npcToken);
  }

  // DISABLED: Don't auto-delete tokens on every sync
  // The frontend may not have all tokens loaded yet, so we shouldn't delete
  // Tokens should only be deleted via explicit delete actions
  /*
  // Delete any player tokens that exist on disk but not in current state
  const currentPlayerIds = new Set(playerTokens.map(t => t.id));
  for (const existingToken of existingPlayerTokens)
  {
    if (!currentPlayerIds.has(existingToken.id))
    {
      console.log('DELETING player token that is not in current state:', existingToken.id, existingToken.actor?.name);
      deletePlayerToken(existingToken.id);
    }
  }

  // Delete any NPC tokens that exist on disk but not in current state
  const currentNPCIds = new Set(npcTokens.map(t => t.id));
  for (const existingToken of existingNPCTokens)
  {
    if (!currentNPCIds.has(existingToken.id))
    {
      console.log('DELETING NPC token that is not in current state:', existingToken.id, existingToken.actor?.name);
      deleteNPCToken(existingToken.id);
    }
  }
  */

  // Handle props if they exist in state
  if (gameState.props && Array.isArray(gameState.props))
  {
    const existingProps = loadProps();

    // Save current props individually to scenario directory
    for (const prop of gameState.props)
    {
      saveProp(prop);
    }

    // Delete any props that exist on disk but not in current state
    const currentPropIds = new Set(gameState.props.map(p => p.id));
    for (const existingProp of existingProps)
    {
      if (!currentPropIds.has(existingProp.id))
      {
        deleteProp(existingProp.id);
      }
    }
  }

  // Save scenario-level game state (tokens now stored separately)
  saveScenarioGameState(gameState);

  res.json({ success: true });
});

// Player heartbeat endpoint
app.post('/api/player-heartbeat', express.json(), (req, res) =>
{
  const { tokenId } = req.body;

  if (tokenId)
  {
    playerHeartbeats.set(tokenId, Date.now());

    // Find the token and set it to active
    const token = gameState.tokens.find(t => t.id === tokenId);
    if (token)
    {
      if (!token.active)
      {
        console.log('Activating player token:', tokenId, token.actor?.name);
        token.active = true;

        // Save player token immediately if it's a player token
        if (token.actor?.player)
        {
          savePlayerToken(token);
        }

        // Save scenario state
        saveScenarioGameState(gameState);
      }
    } else
    {
      console.log('Heartbeat for unknown token:', tokenId);
    }
  }

  res.json({ success: true });
});

// Deactivate a player token (for page unload)
app.post('/api/deactivate-token', express.json(), (req, res) =>
{
  console.log('Deactivate token request received:', req.body);

  const { tokenId } = req.body;

  if (!tokenId)
  {
    console.log('No tokenId provided');
    return res.status(400).json({ error: 'Token ID required' });
  }

  // Update token active state in memory
  const tokenToUpdate = gameState.tokens.find(t => t.id === tokenId);

  if (tokenToUpdate)
  {
    tokenToUpdate.active = false;
    console.log('Deactivated token in memory:', tokenId, tokenToUpdate.actor?.name);

    // If it's a player token, save it separately
    if (tokenToUpdate.actor?.player)
    {
      savePlayerToken(tokenToUpdate);
      console.log('Saved player token to file:', tokenId);
    }

    // Save scenario state
    saveScenarioGameState(gameState);
  } else
  {
    console.log('Token not found:', tokenId);
  }

  res.json({ success: true });
});

// Update token position (for player/observer view movement)
app.post('/api/update-token-position', express.json(), (req, res) =>
{
  console.log('Update token position request:', req.body);

  const { tokenId, x, y, currentlyFacing } = req.body;

  if (!tokenId || x === undefined || y === undefined)
  {
    return res.status(400).json({ error: 'Token ID, x, and y are required' });
  }

  // Find the token
  const tokenToUpdate = gameState.tokens.find(t => t.id === tokenId);

  if (!tokenToUpdate)
  {
    return res.status(404).json({ error: 'Token not found' });
  }

  // Check permissions: GM can move any token, players can only move their own
  const isGM = req.user && req.user.role === 'gm';
  const isPlayerToken = tokenToUpdate.actor?.player === true;
  
  if (!isGM && !isPlayerToken)
  {
    return res.status(403).json({ error: 'Not authorized to move this token' });
  }

  // Update position
  tokenToUpdate.x = x;
  tokenToUpdate.y = y;
  if (currentlyFacing) tokenToUpdate.currentlyFacing = currentlyFacing;

  console.log(`Updated token ${tokenId} position to (${x}, ${y}), currentlyFacing: ${currentlyFacing}`);

  // Save to appropriate file
  if (isPlayerToken)
  {
    savePlayerToken(tokenToUpdate);
  }
  else
  {
    // NPC token - save to scenario directory
    saveNPCToken(tokenToUpdate);
  }

  // Save scenario state
  saveScenarioGameState(gameState);

  res.json({ success: true, token: tokenToUpdate });
});

// Serve uploaded images from server's file system (legacy)
app.use('/images', express.static(path.join(__dirname, 'images')));

// Serve user-specific images from share key folders
app.use('/users', express.static(path.join(__dirname, 'users')));

// Serve static files from the React app (production)
if (process.env.NODE_ENV === 'production')
{
  app.use(express.static(path.join(__dirname, '..', 'dist')));

  // Handle React routing, return all requests to React app
  app.get('*', (req, res) =>
  {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

app.listen(PORT, () =>
{
  console.log(`Upload server running on http://localhost:${PORT}`);
  console.log(`Users directory: ${usersDir}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Clear user-specific temp folders on startup
  try
  {
    let totalCleared = 0;
    
    // Clear user-specific temp folders
    if (fs.existsSync(usersDir)) {
      const users = fs.readdirSync(usersDir);
      for (const user of users) {
        const userTempDir = path.join(usersDir, user, 'images', 'temp');
        if (fs.existsSync(userTempDir)) {
          const tempFiles = fs.readdirSync(userTempDir);
          for (const file of tempFiles) {
            const filePath = path.join(userTempDir, file);
            if (fs.statSync(filePath).isFile()) {
              fs.unlinkSync(filePath);
              totalCleared++;
            }
          }
        }
      }
    }
    
    console.log(`Cleared ${totalCleared} files from temp directories`);
  } catch (err)
  {
    console.warn('Failed to clear temp directory:', err);
  }
});
