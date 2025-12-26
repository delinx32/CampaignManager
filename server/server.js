
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import OpenAI from 'openai';
import puppeteer from 'puppeteer';

// Load settings.json for OpenAI API key
let openaiApiKey = null;
try
{
  const settingsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'settings.json');
  if (fs.existsSync(settingsPath))
  {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    openaiApiKey = settings.openaiApiKey || null;
  }
} catch (err)
{
  console.warn('Could not load settings.json:', err);
}

// Initialize OpenAI SDK client (will use settings.json value or env var)
const openaiClient = new OpenAI({ apiKey: openaiApiKey || process.env.OPENAI_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for the Vite dev server (development only)
if (process.env.NODE_ENV !== 'production')
{
  app.use(cors());
}

// Parse JSON bodies
app.use(express.json());

// Ensure the images/maps directory exists (on server's file system)
const imagesDir = path.join(__dirname, 'images');
const mapsUploadDir = path.join(imagesDir, 'maps');
const actorsDir = path.join(imagesDir, 'actors');
const portraitUploadDir = path.join(actorsDir, 'portrait');
const tokenUploadDir = path.join(actorsDir, 'token');
const tempUploadDir = path.join(actorsDir, 'temp');
const campaignsDir = path.join(__dirname, 'campaigns');
const archivedCampaignsDir = path.join(__dirname, 'archived-campaigns');

if (!fs.existsSync(mapsUploadDir))
{
  fs.mkdirSync(mapsUploadDir, { recursive: true });
}
if (!fs.existsSync(actorsDir))
{
  fs.mkdirSync(actorsDir, { recursive: true });
}
if (!fs.existsSync(portraitUploadDir))
{
  fs.mkdirSync(portraitUploadDir, { recursive: true });
}
if (!fs.existsSync(tokenUploadDir))
{
  fs.mkdirSync(tokenUploadDir, { recursive: true });
}
if (!fs.existsSync(tempUploadDir))
{
  fs.mkdirSync(tempUploadDir, { recursive: true });
}
if (!fs.existsSync(campaignsDir))
{
  fs.mkdirSync(campaignsDir, { recursive: true });
}
if (!fs.existsSync(archivedCampaignsDir))
{
  fs.mkdirSync(archivedCampaignsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) =>
  {
    // Default to maps, will be handled in the endpoint
    cb(null, mapsUploadDir);
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

// Upload endpoint
app.post('/api/upload', upload.single('image'), (req, res) =>
{
  if (!req.file)
  {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Determine folder: portrait, token, or maps
  let folder = 'maps';
  if (req.body.type === 'portrait') folder = 'portrait';
  else if (req.body.type === 'token') folder = 'token';

  // Save to correct folder
  let saveDir = mapsUploadDir;
  if (folder === 'portrait') saveDir = portraitUploadDir;
  else if (folder === 'token') saveDir = tokenUploadDir;
  const oldPath = path.join(mapsUploadDir, req.file.filename);
  const newPath = path.join(saveDir, req.file.filename);
  if (saveDir !== mapsUploadDir)
  {
    try
    {
      fs.renameSync(oldPath, newPath);
      console.log(`File moved from maps to ${folder}:`, req.file.filename);
    } catch (err)
    {
      console.error('Failed to move file:', err);
      return res.status(500).json({ error: `Failed to move file to ${folder} folder` });
    }
  }

  const imageUrl = `/images/${folder}/${req.file.filename}`;
  console.log('File uploaded:', req.file.filename, 'to', folder);

  res.json({
    success: true,
    filename: req.file.filename,
    url: imageUrl
  });
});

// AI Image Generation endpoint
app.post('/api/generate-image', upload.array('referenceImage', 5), async (req, res) =>
{
  try
  {
    const { prompt, template = 'token' } = req.body;

    if (!prompt)
    {
      return res.status(400).json({ error: 'Prompt is required' });
    }


    // Check for OpenAI API key in settings.json
    const apiKey = openaiApiKey;
    if (!apiKey)
    {
      return res.status(500).json({
        error: 'OpenAI API key not configured. Please set openaiApiKey in server/settings.json.'
      });
    }

    // Load system prompt template based on template name
    const templatePath = path.join(__dirname, 'prompt-templates', `${template}.txt`);
    let systemPrompt = '';

    try
    {
      systemPrompt = fs.readFileSync(templatePath, 'utf-8');
      console.log(`Loaded template: ${template}.txt`);
    } catch (err)
    {
      console.warn(`Could not load template ${template}.txt, using default`);
      systemPrompt = 'You are a fantasy art generator for D&D tokens. Create clear, centered character portraits suitable for game tokens.';
    }

    // Build the full prompt
    const fullPrompt = `${systemPrompt}\n\nUser request: ${prompt}`;

    // If reference images are present, add a specific instruction requesting the model use them
    let promptToSend = fullPrompt;
    if (req.files && req.files.length > 0)
    {
      promptToSend += '\n\nPlease use the attached image as a reference and try to make the portrait match the character as closely as possible.';
    }

    // Strip HTML tags from promptToSend
    promptToSend = promptToSend.replace(/<[^>]+>/g, '');
    console.log('Generating image with prompt:', promptToSend);
    console.log('Reference images:', req.files?.length || 0);

    // Allow model selection via request, default to 'dall-e-3'
    const model = req.body.model || 'gpt-image-1';

    // Helper to get mime type from filename
    const getMimeType = (fn) =>
    {
      const ext = path.extname(fn).toLowerCase();
      if (ext === '.png') return 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
      if (ext === '.webp') return 'image/webp';
      if (ext === '.gif') return 'image/gif';
      return 'application/octet-stream';
    };

    // If reference images were uploaded, prefer using the OpenAI SDK images.edits endpoint
    let filename;
    if (req.files && req.files.length > 0)
    {
      try
      {
        // Use the first uploaded reference image as the edit source
        const refFile = req.files[0];
        const refPath = path.join(mapsUploadDir, refFile.filename);

        const sdkModel = (req.body.model && req.body.model.startsWith('gpt-image')) ? req.body.model : 'gpt-image-1';

        // Try SDK edit-style methods in a few possible names for compatibility
        let editResponse = null;
        const imageClient = openaiClient.images || {};
        const tryMethods = [
          'edits', // example: openai.images.edits
          'edit',  // possible alternative
          'generate' // some SDKs accept image param on generate
        ];

        for (const m of tryMethods)
        {
          if (typeof imageClient[m] === 'function')
          {
            try
            {
              editResponse = await imageClient[m].call(imageClient, {
                image: fs.createReadStream(refPath),
                prompt: promptToSend,
                model: sdkModel,
                n: 1,
                size: '128x128',
                quality: 'auto',
                background: 'auto',
                moderation: 'auto',
                input_fidelity: 'low'
              });
              break;
            } catch (innerErr)
            {
              console.warn(`openai.images.${m} failed, trying next method:`, innerErr && innerErr.message);
            }
          }
        }

        // If SDK methods didn't produce a usable response, try a manual multipart POST to the edits endpoint
        if (!editResponse)
        {
          try
          {
            const buffer = fs.readFileSync(refPath);
            const mime = getMimeType(refFile.filename);
            const blob = new Blob([buffer], { type: mime });
            const form = new FormData();
            // 'image' is the field name expected by the /v1/images/edits endpoint
            form.append('image', blob, refFile.filename);
            form.append('prompt', promptToSend);
            form.append('model', sdkModel);
            form.append('n', '1');
            form.append('size', '128x128');

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
            } else
            {
              editResponse = await manualResp.json();
            }
          } catch (manualErr)
          {
            console.warn('Manual multipart edits attempt failed:', manualErr && manualErr.message);
          }
        }

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

        filename = `ai-generated-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
        const savePath = path.join(tempUploadDir, filename);
        fs.writeFileSync(savePath, imageBuffer);
        console.log('AI-edited image saved to temp:', filename);
      } catch (err)
      {
        console.error('OpenAI SDK images.edits error:', err);
        return res.status(500).json({ error: err.message || 'OpenAI images.edits failed' });
      }
    } else
    {
      console.log(model);

      // No reference images — fall back to JSON generation
      const requestBody = {
        model,
        prompt: promptToSend,
        n: 1,
        size: '1024x1024'
      };

      // Different models use different parameter names
      if (model.startsWith('dall-e-'))
      {
        requestBody.quality = 'standard';
        requestBody.response_format = 'url';
      } else if (model.startsWith('gpt-image'))
      {
        requestBody.quality = 'auto';
      }

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

      filename = `ai-generated-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
      const savePath = path.join(tempUploadDir, filename);
      fs.writeFileSync(savePath, Buffer.from(imageBuffer));
      console.log('AI-generated image saved to temp:', filename);
    }

    const imageUrl = `/images/actors/temp/${filename}`;

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
app.post('/api/confirm-ai-image', express.json(), async (req, res) =>
{
  try
  {
    const { filename, template } = req.body;

    if (!filename || !template)
    {
      return res.status(400).json({ error: 'filename and template required' });
    }

    const tempPath = path.join(tempUploadDir, filename);
    if (!fs.existsSync(tempPath))
    {
      return res.status(404).json({ error: 'Temp file not found' });
    }

    const targetSubfolder = (template === 'portrait') ? portraitUploadDir : tokenUploadDir;
    const finalPath = path.join(targetSubfolder, filename);

    // Move file from temp to final location
    fs.renameSync(tempPath, finalPath);

    const imageUrl = (template === 'portrait') ? `/images/actors/portrait/${filename}` : `/images/actors/token/${filename}`;

    console.log('AI image confirmed and moved:', filename, 'to', targetSubfolder);

    res.json({ success: true, imageUrl, filename });
  } catch (err)
  {
    console.error('Confirm AI image error:', err);
    res.status(500).json({ error: 'Failed to confirm AI image' });
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
        url: '/images/actors/portrait/blankimage.png',
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

    // Ensure portrait dir exists
    if (!fs.existsSync(portraitUploadDir))
    {
      fs.mkdirSync(portraitUploadDir, { recursive: true });
    }

    // Extract character ID from URL (e.g., /characters/158029310/)
    const characterIdMatch = url.match(/\/characters\/(\d+)/);
    const characterId = characterIdMatch ? characterIdMatch[1] : `imported-${Date.now()}`;

    const filename = `${characterId}${ext}`;
    const savePath = path.join(portraitUploadDir, filename);
    fs.writeFileSync(savePath, buffer);

    const publicUrl = `/images/actors/portrait/${filename}`;
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
app.get('/api/maps', (req, res) =>
{
  fs.readdir(mapsUploadDir, (err, files) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read maps directory' });
    }

    const maps = files
      .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
      .filter(file => !file.startsWith('token-')) // Exclude any token images that might be in maps folder
      .map(file => ({
        filename: file,
        url: `/images/maps/${file}`
      }));

    res.json({ maps });
  });
});

// Get list of all uploaded actor images
app.get('/api/actors', (req, res) =>
{
  try
  {
    const actors = [];

    // Read portrait images
    if (fs.existsSync(portraitUploadDir))
    {
      const portraitFiles = fs.readdirSync(portraitUploadDir);
      portraitFiles.forEach(file =>
      {
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file))
        {
          actors.push({ filename: file, url: `/images/actors/portrait/${file}` });
        }
      });
    }

    // Read token images
    if (fs.existsSync(tokenUploadDir))
    {
      const tokenFiles = fs.readdirSync(tokenUploadDir);
      tokenFiles.forEach(file =>
      {
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file))
        {
          actors.push({ filename: file, url: `/images/actors/token/${file}` });
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

// Get map metadata
app.get('/api/map-metadata/:filename', (req, res) =>
{
  const mapFilename = req.params.filename;
  const metadataFilename = mapFilename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '.json');
  const metadataPath = path.join(mapsUploadDir, metadataFilename);

  if (!fs.existsSync(metadataPath))
  {
    // Return default metadata if file doesn't exist
    return res.json({
      gridColumns: 20,
      gridRows: 20,
      lightingCondition: 'bright',
      fogEnabled: 'off-gm',
      fogRevealDistance: 3,
      showGrid: true
    });
  }

  fs.readFile(metadataPath, 'utf8', (err, data) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read metadata file' });
    }

    try
    {
      const metadata = JSON.parse(data);
      res.json(metadata);
    } catch (parseErr)
    {
      res.status(500).json({ error: 'Invalid metadata file' });
    }
  });
});

// Save map metadata
app.post('/api/map-metadata/:filename', (req, res) =>
{
  const mapFilename = req.params.filename;
  const metadataFilename = mapFilename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '.json');
  const metadataPath = path.join(mapsUploadDir, metadataFilename);

  const metadata = req.body;

  fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8', (err) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to save metadata file' });
    }

    res.json({ success: true });
  });
});

// In-memory game state storage
let currentCampaign = null;
let currentScenario = null;
let currentSessionName = null; // Track current session name
let isSessionActive = false; // Track if we're in game mode
let gameState = {
  currentMapFilename: null,
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
  if (!currentCampaign || !currentScenario) return null;
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  if (isSessionActive && currentSessionName)
  {
    const sessionPath = path.join(scenarioPath, 'sessions', currentSessionName);
    return path.join(sessionPath, '.runtime-state.json');
  }
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

    // Load player tokens from campaign directory and NPC tokens from scenario directory
    const playerTokens = loadPlayerTokens();
    const npcTokens = loadNPCTokens();
    const props = loadProps();

    // Merge all tokens (players + NPCs) and props
    scenarioState.tokens = [...playerTokens, ...npcTokens];
    scenarioState.props = props;

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
  if (!currentCampaign || !currentScenario) return;

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
    
    console.log('saveScenarioGameState: showObserverCards =', stateToSave.showObserverCards);

    if (isSessionActive && currentSessionName)
    {
      // GAME MODE: Save ONLY to session folder
      const sessionPath = path.join(scenarioPath, 'sessions', currentSessionName);
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
    }
  } catch (error)
  {
    console.error('Failed to save scenario game state:', error);
  }
}

// Helper function to get player tokens directory path
function getPlayerTokensPath()
{
  if (!currentCampaign) return null;
  if (isSessionActive && currentSessionName)
  {
    const sessionPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario, 'sessions', currentSessionName);
    return path.join(sessionPath, 'playertokens');
  }
  return path.join(campaignsDir, currentCampaign, 'playertokens');
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
  if (!currentCampaign) return;

  const definitionPath = path.join(campaignsDir, currentCampaign, 'playertokens');

  try
  {
    if (isSessionActive && currentSessionName)
    {
      // GAME MODE: Save ONLY to session folder
      const sessionPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario, 'sessions', currentSessionName);
      const runtimePath = path.join(sessionPath, 'playertokens');
      if (!fs.existsSync(runtimePath))
      {
        fs.mkdirSync(runtimePath, { recursive: true });
      }
      const tokenPath = path.join(runtimePath, `${token.id}.json`);
      console.log('SAVING PLAYER TOKEN TO SESSION:', tokenPath);
      fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2));
    } else
    {
      // EDIT MODE: Save to definition
      if (!fs.existsSync(definitionPath))
      {
        fs.mkdirSync(definitionPath, { recursive: true });
      }
      const tokenPath = path.join(definitionPath, `${token.id}.json`);
      console.log('SAVING PLAYER TOKEN TO DEFINITION:', tokenPath);
      fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2));
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
  if (!currentCampaign || !currentScenario) return null;
  if (isSessionActive && currentSessionName)
  {
    const sessionPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario, 'sessions', currentSessionName);
    return path.join(sessionPath, 'npctokens');
  }
  return path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario, 'npctokens');
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
  if (!currentCampaign || !currentScenario) return;

  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const definitionPath = path.join(scenarioPath, 'npctokens');

  try
  {
    if (isSessionActive && currentSessionName)
    {
      // GAME MODE: Save ONLY to session folder
      const sessionPath = path.join(scenarioPath, 'sessions', currentSessionName);
      const runtimePath = path.join(sessionPath, 'npctokens');
      if (!fs.existsSync(runtimePath))
      {
        fs.mkdirSync(runtimePath, { recursive: true });
      }
      const tokenPath = path.join(runtimePath, `${token.id}.json`);
      fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2));
    } else
    {
      // EDIT MODE: Save to definition
      if (!fs.existsSync(definitionPath))
      {
        fs.mkdirSync(definitionPath, { recursive: true });
      }
      const tokenPath = path.join(definitionPath, `${token.id}.json`);
      fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2));
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
  if (!currentCampaign || !currentScenario) return null;
  if (isSessionActive && currentSessionName)
  {
    const sessionPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario, 'sessions', currentSessionName);
    return path.join(sessionPath, 'props');
  }
  return path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario, 'props');
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
    if (isSessionActive && currentSessionName && currentCampaign && currentScenario)
    {
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
  if (!currentCampaign || !currentScenario) return;

  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const definitionPath = path.join(scenarioPath, 'props');

  try
  {
    if (isSessionActive && currentSessionName)
    {
      // GAME MODE: Save ONLY to session folder
      const sessionPath = path.join(scenarioPath, 'sessions', currentSessionName);
      const runtimePath = path.join(sessionPath, 'props');
      if (!fs.existsSync(runtimePath))
      {
        fs.mkdirSync(runtimePath, { recursive: true });
      }
      const propPath = path.join(runtimePath, `${prop.id}.json`);
      fs.writeFileSync(propPath, JSON.stringify(prop, null, 2));
    } else
    {
      // EDIT MODE: Save to definition
      if (!fs.existsSync(definitionPath))
      {
        fs.mkdirSync(definitionPath, { recursive: true });
      }
      const propPath = path.join(definitionPath, `${prop.id}.json`);
      fs.writeFileSync(propPath, JSON.stringify(prop, null, 2));
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

// Migration function to move tokens from map JSON files to separate token files
function migrateTokensFromMapFiles()
{
  console.log('Starting token migration from map JSON files...');

  if (!fs.existsSync(campaignsDir))
  {
    console.log('No campaigns directory found, skipping migration');
    return;
  }

  const campaigns = fs.readdirSync(campaignsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const campaign of campaigns)
  {
    const campaignPath = path.join(campaignsDir, campaign);

    // Get all scenarios in this campaign
    const scenarios = fs.readdirSync(campaignPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && dirent.name !== 'playertokens')
      .map(dirent => dirent.name);

    for (const scenario of scenarios)
    {
      const scenarioPath = path.join(campaignPath, scenario);

      // Find all map JSON files (not .scenario-state.json or .metadata.json)
      const files = fs.readdirSync(scenarioPath);
      const mapJsonFiles = files.filter(f =>
        f.endsWith('.json') &&
        !f.startsWith('.scenario-state') &&
        !f.startsWith('.metadata')
      );

      for (const mapFile of mapJsonFiles)
      {
        const mapPath = path.join(scenarioPath, mapFile);

        try
        {
          const data = fs.readFileSync(mapPath, 'utf-8');
          const mapData = JSON.parse(data);

          if (mapData.tokens && mapData.tokens.length > 0)
          {
            console.log(`Migrating ${mapData.tokens.length} tokens from ${campaign}/${scenario}/${mapFile}`);

            // Set context temporarily for helper functions
            const originalCampaign = currentCampaign;
            const originalScenario = currentScenario;
            currentCampaign = campaign;
            currentScenario = scenario;

            // Separate and save tokens
            const playerTokens = mapData.tokens.filter(t => t.actor?.player);
            const npcTokens = mapData.tokens.filter(t => !t.actor?.player);

            for (const token of playerTokens)
            {
              savePlayerToken(token);
            }

            for (const token of npcTokens)
            {
              saveNPCToken(token);
            }

            // Clear tokens from map JSON and save
            mapData.tokens = [];
            fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2));

            console.log(`  Migrated ${playerTokens.length} player tokens, ${npcTokens.length} NPC tokens`);

            // Restore context
            currentCampaign = originalCampaign;
            currentScenario = originalScenario;
          }
        } catch (error)
        {
          console.error(`Failed to migrate tokens from ${mapFile}:`, error);
        }
      }
    }
  }

  console.log('Token migration completed');
}

// Migration function to move map JSON files to maps/ subfolder
function migrateMapFilesToSubfolder()
{
  console.log('Starting map files migration to maps/ subfolder...');

  if (!fs.existsSync(campaignsDir))
  {
    console.log('No campaigns directory found, skipping migration');
    return;
  }

  const campaigns = fs.readdirSync(campaignsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const campaign of campaigns)
  {
    const campaignPath = path.join(campaignsDir, campaign);

    // Get all scenarios in this campaign
    const scenarios = fs.readdirSync(campaignPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && dirent.name !== 'playertokens')
      .map(dirent => dirent.name);

    for (const scenario of scenarios)
    {
      const scenarioPath = path.join(campaignPath, scenario);

      // Find all map JSON files in scenario root (not .scenario-state.json or .metadata.json)
      const files = fs.readdirSync(scenarioPath);
      const mapJsonFiles = files.filter(f =>
        f.endsWith('.json') &&
        !f.startsWith('.scenario-state') &&
        !f.startsWith('.metadata')
      );

      if (mapJsonFiles.length > 0)
      {
        // Create maps directory if it doesn't exist
        const mapsPath = path.join(scenarioPath, 'maps');
        if (!fs.existsSync(mapsPath))
        {
          fs.mkdirSync(mapsPath, { recursive: true });
        }

        for (const mapFile of mapJsonFiles)
        {
          const oldPath = path.join(scenarioPath, mapFile);
          const newPath = path.join(mapsPath, mapFile);

          try
          {
            // Only move if destination doesn't already exist
            if (!fs.existsSync(newPath))
            {
              fs.renameSync(oldPath, newPath);
              console.log(`Moved ${campaign}/${scenario}/${mapFile} to maps/ subfolder`);
            }
          } catch (error)
          {
            console.error(`Failed to move ${mapFile}:`, error);
          }
        }
      }
    }
  }

  console.log('Map files migration completed');
}

// Migration function to move scenarios into scenarios/ subfolder
function migrateScenariosToSubfolder()
{
  console.log('Starting scenarios migration to scenarios/ subfolder...');

  if (!fs.existsSync(campaignsDir))
  {
    console.log('No campaigns directory found, skipping migration');
    return;
  }

  const campaigns = fs.readdirSync(campaignsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const campaign of campaigns)
  {
    const campaignPath = path.join(campaignsDir, campaign);

    // Get all directories in campaign root that are NOT playertokens or scenarios
    const items = fs.readdirSync(campaignPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && dirent.name !== 'playertokens' && dirent.name !== 'scenarios')
      .map(dirent => dirent.name);

    if (items.length > 0)
    {
      // Create scenarios directory if it doesn't exist
      const scenariosPath = path.join(campaignPath, 'scenarios');
      if (!fs.existsSync(scenariosPath))
      {
        fs.mkdirSync(scenariosPath, { recursive: true });
      }

      for (const scenario of items)
      {
        const oldPath = path.join(campaignPath, scenario);
        const newPath = path.join(scenariosPath, scenario);

        try
        {
          // Only move if destination doesn't already exist
          if (!fs.existsSync(newPath))
          {
            fs.renameSync(oldPath, newPath);
            console.log(`Moved ${campaign}/${scenario} to scenarios/ subfolder`);
          }
        } catch (error)
        {
          console.error(`Failed to move ${scenario}:`, error);
        }
      }
    }
  }

  console.log('Scenarios migration completed');
}

// Campaign Management APIs
app.get('/api/campaigns', (req, res) =>
{
  fs.readdir(campaignsDir, (err, files) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read campaigns directory' });
    }

    const campaigns = files
      .filter(file =>
      {
        const stat = fs.statSync(path.join(campaignsDir, file));
        return stat.isDirectory();
      })
      .map(campaignName =>
      {
        const campaignPath = path.join(campaignsDir, campaignName);
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
        if (fs.existsSync(metadataPath))
        {
          try
          {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            description = metadata.description || '';
          } catch (err)
          {
            console.error('Error reading campaign metadata:', err);
          }
        }

        return {
          name: campaignName,
          scenarioCount,
          description
        };
      });

    res.json({ campaigns });
  });
});

app.post('/api/campaigns', express.json(), (req, res) =>
{
  const { name } = req.body;

  if (!name)
  {
    return res.status(400).json({ error: 'Campaign name required' });
  }

  const campaignPath = path.join(campaignsDir, name);

  if (fs.existsSync(campaignPath))
  {
    return res.status(400).json({ error: 'Campaign already exists' });
  }

  fs.mkdirSync(campaignPath, { recursive: true });
  res.json({ success: true, name });
});

app.patch('/api/campaigns/:campaignName', express.json(), (req, res) =>
{
  const oldName = req.params.campaignName;
  const { name: newName, description } = req.body;
  const campaignPath = path.join(campaignsDir, oldName);
  const metadataPath = path.join(campaignPath, '.metadata.json');

  try
  {
    const metadata = { description: description || '' };
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

      const newPath = path.join(campaignsDir, newName);
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

app.delete('/api/campaigns/:campaignName', (req, res) =>
{
  const campaignName = req.params.campaignName;
  const campaignPath = path.join(campaignsDir, campaignName);

  if (!fs.existsSync(campaignPath))
  {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  // Create archived campaign path with timestamp
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const archivedPath = path.join(archivedCampaignsDir, `${campaignName}_${timestamp}`);

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

app.get('/api/archived-campaigns', (req, res) =>
{
  fs.readdir(archivedCampaignsDir, (err, files) =>
  {
    if (err)
    {
      return res.status(500).json({ error: 'Failed to read archived campaigns' });
    }

    const archived = files
      .filter(file =>
      {
        const stat = fs.statSync(path.join(archivedCampaignsDir, file));
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

app.post('/api/archived-campaigns/:folderName/restore', (req, res) =>
{
  const folderName = req.params.folderName;
  const archivedPath = path.join(archivedCampaignsDir, folderName);

  if (!fs.existsSync(archivedPath))
  {
    return res.status(404).json({ error: 'Archived campaign not found' });
  }

  // Extract original name
  const lastUnderscore = folderName.lastIndexOf('_');
  const originalName = folderName.substring(0, lastUnderscore);
  const restoredPath = path.join(campaignsDir, originalName);

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

app.delete('/api/archived-campaigns/:folderName', (req, res) =>
{
  const folderName = req.params.folderName;
  const archivedPath = path.join(archivedCampaignsDir, folderName);

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

app.get('/api/campaigns/:campaignName/scenarios', (req, res) =>
{
  const campaignPath = path.join(campaignsDir, req.params.campaignName);
  const scenariosPath = path.join(campaignPath, 'scenarios');

  if (!fs.existsSync(scenariosPath))
  {
    return res.json({ scenarios: [] });
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

        return {
          name: scenarioName,
          mapCount: maps.length,
          description
        };
      });

    res.json({ scenarios });
  });
});

app.post('/api/campaigns/:campaignName/scenarios', express.json(), (req, res) =>
{
  const { name } = req.body;
  const campaignPath = path.join(campaignsDir, req.params.campaignName);

  if (!name)
  {
    return res.status(400).json({ error: 'Scenario name required' });
  }

  if (!fs.existsSync(campaignPath))
  {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const scenarioPath = path.join(campaignPath, name);

  if (fs.existsSync(scenarioPath))
  {
    return res.status(400).json({ error: 'Scenario already exists' });
  }

  res.json({ success: true, name });
});

// Check if scenario has any existing maps
app.get('/api/scenario-maps', (req, res) =>
{
  if (!currentCampaign || !currentScenario)
  {
    return res.status(400).json({ error: 'No campaign/scenario context set' });
  }

  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);

  if (!fs.existsSync(scenarioPath))
  {
    return res.json({ hasExistingMap: false });
  }

  try
  {
    // First check if there's a saved scenario state with a current map
    const savedState = loadScenarioGameState();
    if (savedState && savedState.currentMapFilename)
    {
      // Verify the image file exists
      const mapsDir = path.join(__dirname, 'images', 'maps');
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      let imageExists = false;

      for (const ext of imageExtensions)
      {
        const baseName = savedState.currentMapFilename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
        if (fs.existsSync(path.join(mapsDir, baseName + ext)))
        {
          imageExists = true;
          break;
        }
      }

      if (imageExists)
      {
        return res.json({
          hasExistingMap: true,
          mapFilename: savedState.currentMapFilename
        });
      }
    }

    // Otherwise, look for any map JSON files in maps/ subfolder
    const mapsPath = path.join(scenarioPath, 'maps');

    if (!fs.existsSync(mapsPath))
    {
      return res.json({ hasExistingMap: false });
    }

    const files = fs.readdirSync(mapsPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length > 0)
    {
      // Return the first map file found and load it
      const mapJsonFile = jsonFiles[0];
      const mapJsonPath = path.join(mapsPath, mapJsonFile);
      const metadata = JSON.parse(fs.readFileSync(mapJsonPath, 'utf-8'));

      // Find the corresponding image file (could be .jpg, .png, etc.)
      const baseName = mapJsonFile.replace('.json', '');
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      let imageFilename = null;

      // Check images/maps directory for the actual image
      const mapsDir = path.join(__dirname, 'images', 'maps');
      if (fs.existsSync(mapsDir))
      {
        const mapFiles = fs.readdirSync(mapsDir);
        for (const ext of imageExtensions)
        {
          if (mapFiles.includes(baseName + ext))
          {
            imageFilename = baseName + ext;
            break;
          }
        }
      }

      if (imageFilename)
      {
        res.json({
          hasExistingMap: true,
          mapFilename: imageFilename,
          metadata
        });
      } else
      {
        res.json({ hasExistingMap: false });
      }
    } else
    {
      res.json({ hasExistingMap: false });
    }
  } catch (err)
  {
    console.error('Error checking scenario maps:', err);
    res.status(500).json({ error: 'Failed to check scenario maps' });
  }
});

app.patch('/api/campaigns/:campaignName/scenarios/:scenarioName', express.json(), (req, res) =>
{
  const { description, newName } = req.body;
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

app.post('/api/set-context', express.json(), (req, res) =>
{
  const { campaign, scenario } = req.body;

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
      currentMapFilename: null,
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
app.post('/api/load-map', express.json(), (req, res) =>
{
  const { filename } = req.body;

  if (!filename)
  {
    return res.status(400).json({ error: 'Filename required' });
  }

  if (!currentCampaign || !currentScenario)
  {
    return res.status(400).json({ error: 'No campaign/scenario context set' });
  }

  const metadataFilename = filename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '.json');
  const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
  const mapsPath = path.join(scenarioPath, 'maps');
  const metadataPath = path.join(mapsPath, metadataFilename);

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
        currentMapFilename: filename,
        backgroundImage: `/images/maps/${filename}`,
        tokens: [...playerTokens, ...npcTokens],
        props: props,
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        fogEnabled: metadata.fogEnabled || 'off-gm',
        fogRevealDistance: metadata.fogRevealDistance || 3,
        playerFogOpacity: 1,
        lightingCondition: metadata.lightingCondition || 'bright',
        revealedPath: metadata.revealedPath || [],
        gridColumns: metadata.gridColumns || 20,
        gridRows: metadata.gridRows || 20,
        showGrid: metadata.showGrid !== undefined ? metadata.showGrid : true,
        imageDimensions: null,
        currentActorId,
        showObserverCards
      };

      console.log('Loaded map:', filename, 'with', gameState.tokens.length, 'tokens and', gameState.props.length, 'props');
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
      currentMapFilename: filename,
      backgroundImage: `/images/maps/${filename}`,
      tokens: playerTokens,
      props: props,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      fogEnabled: 'off-gm',
      fogRevealDistance: 3,
      playerFogOpacity: 1,
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
  const { session } = req.query;

  // If session parameter provided, load from that session's folder
  if (session && currentCampaign && currentScenario)
  {
    try
    {
      const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
      const sessionPath = path.join(scenarioPath, 'sessions', session);
      const sessionStatePath = path.join(sessionPath, '.runtime-state.json');

      if (!fs.existsSync(sessionStatePath))
      {
        return res.status(404).json({ error: 'Session not found' });
      }

      const sessionStateData = fs.readFileSync(sessionStatePath, 'utf-8');
      const sessionState = JSON.parse(sessionStateData);

      // Load tokens from session folder
      const playerTokens = [];
      const npcTokens = [];
      const props = [];

      // Load player tokens from session
      const sessionPlayerTokensPath = path.join(sessionPath, 'playertokens');
      if (fs.existsSync(sessionPlayerTokensPath))
      {
        const files = fs.readdirSync(sessionPlayerTokensPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            const tokenData = fs.readFileSync(path.join(sessionPlayerTokensPath, file), 'utf-8');
            playerTokens.push(JSON.parse(tokenData));
          }
        }
      }

      // Load NPC tokens from session
      const sessionNPCTokensPath = path.join(sessionPath, 'npctokens');
      if (fs.existsSync(sessionNPCTokensPath))
      {
        const files = fs.readdirSync(sessionNPCTokensPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            const tokenData = fs.readFileSync(path.join(sessionNPCTokensPath, file), 'utf-8');
            npcTokens.push(JSON.parse(tokenData));
          }
        }
      }

      // Load props from session
      const sessionPropsPath = path.join(sessionPath, 'props');
      if (fs.existsSync(sessionPropsPath))
      {
        const files = fs.readdirSync(sessionPropsPath);
        for (const file of files)
        {
          if (file.endsWith('.json'))
          {
            const propData = fs.readFileSync(path.join(sessionPropsPath, file), 'utf-8');
            props.push(JSON.parse(propData));
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

      // Check if this session is currently active
      const isThisSessionActive = (isSessionActive && currentSessionName === session);

      return res.json({
        state: sessionState,
        sessionActive: isThisSessionActive,
        sessionName: session
      });
    } catch (error)
    {
      console.error('Failed to load session state:', error);
      return res.status(500).json({ error: 'Failed to load session state' });
    }
  }

  // Default: return current gameState
  // Reload props from disk to ensure they're fresh
  if (currentCampaign && currentScenario)
  {
    gameState.props = loadProps();
  }
  res.json({ state: gameState, sessionActive: isSessionActive });
});

// Get scenario metadata (including lastSessionPlayed)
app.get('/api/scenario-metadata', (req, res) =>
{
  if (!currentCampaign || !currentScenario)
  {
    return res.json({ lastSessionPlayed: null });
  }

  try
  {
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

// List available sessions for current scenario
app.get('/api/sessions', (req, res) =>
{
  if (!currentCampaign || !currentScenario)
  {
    return res.json({ sessions: [] });
  }

  try
  {
    const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
    const sessionsPath = path.join(scenarioPath, 'sessions');

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
app.post('/api/session/start', express.json(), (req, res) =>
{
  if (!currentCampaign || !currentScenario)
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
    const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
    const sessionPath = path.join(scenarioPath, 'sessions', sessionName);

    // Check if session already exists
    const sessionExists = fs.existsSync(sessionPath);

    if (!sessionExists)
    {
      // NEW SESSION: Create session folder and copy from definition
      fs.mkdirSync(sessionPath, { recursive: true });

      // Copy scenario state
      const sourceStatePath = path.join(scenarioPath, '.scenario-state.json');
      const sessionStatePath = path.join(sessionPath, '.runtime-state.json');
      if (fs.existsSync(sourceStatePath))
      {
        const definitionState = JSON.parse(fs.readFileSync(sourceStatePath, 'utf-8'));
        // showObserverCards is runtime-only, always initialize to true for new sessions
        definitionState.showObserverCards = true;

        fs.writeFileSync(sessionStatePath, JSON.stringify(definitionState, null, 2));
      }

      // Copy player tokens
      const playerTokensPath = path.join(campaignsDir, currentCampaign, 'playertokens');
      const sessionPlayerTokensPath = path.join(sessionPath, 'playertokens');
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

      // Copy NPC tokens
      const npcTokensPath = path.join(scenarioPath, 'npctokens');
      const sessionNPCTokensPath = path.join(sessionPath, 'npctokens');
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

      console.log('Created new session:', sessionName);
    } else
    {
      console.log('Loading existing session:', sessionName);
    }

    currentSessionName = sessionName;
    isSessionActive = false; // Temporarily set to false to update definition

    // Update lastSessionPlayed in definition file
    const definitionPath = path.join(scenarioPath, '.scenario-state.json');
    if (fs.existsSync(definitionPath))
    {
      const definitionData = JSON.parse(fs.readFileSync(definitionPath, 'utf-8'));
      definitionData.lastSessionPlayed = sessionName;
      fs.writeFileSync(definitionPath, JSON.stringify(definitionData, null, 2));
      console.log('Updated lastSessionPlayed to:', sessionName, 'in', definitionPath);
    } else
    {
      console.log('Warning: Definition file not found at:', definitionPath);
    }

    isSessionActive = true; // Now set to true for session mode

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

// End a game session (keep session files, switch to definition view)
app.post('/api/session/end', express.json(), (req, res) =>
{
  if (!isSessionActive)
  {
    return res.status(400).json({ error: 'No active session' });
  }

  try
  {
    const sessionPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario, 'sessions', currentSessionName);

    // Copy session player tokens back to campaign root
    const sessionPlayerTokensPath = path.join(sessionPath, 'playertokens');
    const definitionPlayerTokensPath = path.join(campaignsDir, currentCampaign, 'playertokens');

    if (fs.existsSync(sessionPlayerTokensPath))
    {
      if (!fs.existsSync(definitionPlayerTokensPath))
      {
        fs.mkdirSync(definitionPlayerTokensPath, { recursive: true });
      }

      const sessionTokenFiles = fs.readdirSync(sessionPlayerTokensPath);
      for (const file of sessionTokenFiles)
      {
        if (file.endsWith('.json'))
        {
          // Read token, set inactive, then save
          const tokenPath = path.join(sessionPlayerTokensPath, file);
          const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
          tokenData.active = false;

          // Save back to session folder
          fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));

          // Copy to definition folder
          fs.copyFileSync(
            tokenPath,
            path.join(definitionPlayerTokensPath, file)
          );
        }
      }
      console.log(`Copied ${sessionTokenFiles.length} player token files from session to definition (all set inactive)`);
    }

    // Copy session NPC tokens back to scenario definition
    const sessionNPCTokensPath = path.join(sessionPath, 'npctokens');
    const definitionNPCTokensPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario, 'npctokens');

    if (fs.existsSync(sessionNPCTokensPath))
    {
      if (!fs.existsSync(definitionNPCTokensPath))
      {
        fs.mkdirSync(definitionNPCTokensPath, { recursive: true });
      }

      const sessionNPCFiles = fs.readdirSync(sessionNPCTokensPath);
      for (const file of sessionNPCFiles)
      {
        if (file.endsWith('.json'))
        {
          fs.copyFileSync(
            path.join(sessionNPCTokensPath, file),
            path.join(definitionNPCTokensPath, file)
          );
        }
      }
      console.log(`Copied ${sessionNPCFiles.length} NPC token files from session to definition`);
    }

    // Copy session props back to scenario definition
    const sessionPropsPath = path.join(sessionPath, 'props');
    const definitionPropsPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario, 'props');

    if (fs.existsSync(sessionPropsPath))
    {
      if (!fs.existsSync(definitionPropsPath))
      {
        fs.mkdirSync(definitionPropsPath, { recursive: true });
      }

      const sessionPropFiles = fs.readdirSync(sessionPropsPath);
      for (const file of sessionPropFiles)
      {
        if (file.endsWith('.json'))
        {
          fs.copyFileSync(
            path.join(sessionPropsPath, file),
            path.join(definitionPropsPath, file)
          );
        }
      }
      console.log(`Copied ${sessionPropFiles.length} prop files from session to definition`);
    }

    // Keep session files for next time, just deactivate
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
      gameState: gameState // Return updated state so client can refresh
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
app.post('/api/game-state', express.json(), (req, res) =>
{
  const { state } = req.body;

  if (!state)
  {
    return res.status(400).json({ error: 'State required' });
  }

  // Update in-memory state (last write wins)
  gameState = { ...state };
  
  console.log('POST /api/game-state: showObserverCards =', gameState.showObserverCards);

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

  // Delete any player tokens that exist on disk but not in current state
  const currentPlayerIds = new Set(playerTokens.map(t => t.id));
  for (const existingToken of existingPlayerTokens)
  {
    if (!currentPlayerIds.has(existingToken.id))
    {
      deletePlayerToken(existingToken.id);
    }
  }

  // Delete any NPC tokens that exist on disk but not in current state
  const currentNPCIds = new Set(npcTokens.map(t => t.id));
  for (const existingToken of existingNPCTokens)
  {
    if (!currentNPCIds.has(existingToken.id))
    {
      deleteNPCToken(existingToken.id);
    }
  }

  // Handle props if they exist in state
  console.log('POST /api/game-state: Received', gameState.props?.length || 0, 'props in state');
  if (gameState.props && Array.isArray(gameState.props))
  {
    const existingProps = loadProps();

    // Save current props individually to scenario directory
    for (const prop of gameState.props)
    {
      console.log('Saving prop:', prop.id, prop.name, 'rotation:', prop.rotation, 'scale:', prop.scale);
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

  // Save to map JSON file if we have a current map and context
  if (gameState.currentMapFilename && currentCampaign && currentScenario)
  {
    const metadataFilename = gameState.currentMapFilename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '.json');
    const scenarioPath = path.join(campaignsDir, currentCampaign, 'scenarios', currentScenario);
    const mapsPath = path.join(scenarioPath, 'maps');

    // Ensure maps directory exists
    if (!fs.existsSync(mapsPath))
    {
      fs.mkdirSync(mapsPath, { recursive: true });
    }

    const metadataPath = path.join(mapsPath, metadataFilename);

    const metadata = {
      gridColumns: gameState.gridColumns,
      gridRows: gameState.gridRows,
      lightingCondition: gameState.lightingCondition,
      fogEnabled: gameState.fogEnabled,
      fogRevealDistance: gameState.fogRevealDistance,
      showGrid: gameState.showGrid,
      tokens: [], // All tokens stored in separate files
      revealedPath: gameState.revealedPath
    };

    try
    {
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error)
    {
      console.error('Failed to save metadata:', error);
    }
  }

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

// Serve uploaded images from server's file system
app.use('/images', express.static(path.join(__dirname, 'images')));

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
  console.log(`Maps directory: ${mapsUploadDir}`);
  console.log(`Actors directory: ${actorsDir}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Run migrations on startup (in order: scenarios first, then tokens, then maps)
  migrateScenariosToSubfolder();
  migrateTokensFromMapFiles();
  migrateMapFilesToSubfolder();
});
