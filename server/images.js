import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

// Register image-related routes. Context should provide:
// - app: express app (passed in caller)
// - usersDir: path to users directory
// - requireAuth, requireGM: middleware
// - googleSearchApiKey, googleSearchEngineId: optional for search
// - __dirname: server directory
export function registerImageRoutes(app, context = {}) {
  const usersDir = context.usersDir || path.join(process.cwd(), 'users');
  const requireAuth = context.requireAuth;
  const requireGM = context.requireGM;
  const provideShareKey = context.provideShareKey;
  const googleSearchApiKey = context.googleSearchApiKey || null;
  const googleSearchEngineId = context.googleSearchEngineId || null;
  const serverDir = context.__dirname || process.cwd();

  // Configure multer for file uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const shareKey = req.shareKey;
      if (!shareKey) return cb(new Error('No share key available'));
      const userTempDir = path.join(usersDir, shareKey, 'images', 'temp');
      if (!fs.existsSync(userTempDir)) fs.mkdirSync(userTempDir, { recursive: true });
      cb(null, userTempDir);
    },
    filename: (req, file, cb) => {
      const customName = req.body.customName || file.originalname.replace(/\.[^/.]+$/, '');
      const safeName = customName.replace(/[^a-zA-Z0-9-_\s]/g, '').replace(/\s+/g, '-');
      const ext = path.extname(file.originalname);
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, `${safeName}-${uniqueSuffix}${ext}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Only image files are allowed!'));
    }
  });

  // Upload endpoint
  app.post('/api/upload', requireGM, provideShareKey, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.shareKey) return res.status(401).json({ error: 'No share key available' });

    let folder = 'maps';
    if (req.body.type === 'portrait') folder = 'portrait';
    else if (req.body.type === 'token') folder = 'token';
    else if (req.body.type === 'props') folder = 'props';
    else if (req.body.type === 'misc') folder = 'misc';

    const userImagesDir = path.join(usersDir, req.shareKey, 'images', folder);
    if (!fs.existsSync(userImagesDir)) fs.mkdirSync(userImagesDir, { recursive: true });

    const userTempDir = path.join(usersDir, req.shareKey, 'images', 'temp');
    const oldPath = path.join(userTempDir, req.file.filename);
    const newPath = path.join(userImagesDir, req.file.filename);

    try {
      fs.renameSync(oldPath, newPath);
    } catch (err) {
      console.error('Failed to move file:', err);
      return res.status(500).json({ error: `Failed to move file to ${folder} folder` });
    }

    const imageUrl = `/users/${req.shareKey}/images/${folder}/${req.file.filename}`;
    res.json({ success: true, filename: req.file.filename, url: imageUrl });
  });

  // AI Image Generation endpoint
  app.post('/api/generate-image', requireAuth, provideShareKey, upload.fields([{ name: 'baseImage', maxCount: 1 }, { name: 'referenceImage', maxCount: 5 }]), async (req, res) => {
    try {
      const { prompt, template = 'token' } = req.body;
      if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
      const shareKey = req.shareKey;
      if (!shareKey) return res.status(401).json({ error: 'No share key selected' });

      const shareKeyPath = path.join(usersDir, shareKey, '.user.json');
      let apiKey = null;
      if (fs.existsSync(shareKeyPath)) {
        try { apiKey = JSON.parse(fs.readFileSync(shareKeyPath, 'utf-8')).openaiApiKey; } catch (e) { console.error(e); }
      }
      if (!apiKey) return res.status(500).json({ error: 'OpenAI API key not configured for this share key.' });

      const baseTemplatePath = path.join(serverDir, 'prompt-templates', 'base.txt');
      let basePrompt = '';
      try { basePrompt = fs.readFileSync(baseTemplatePath, 'utf-8'); } catch (e) { }

      const templatePath = path.join(serverDir, 'prompt-templates', `${template}.txt`);
      let specificPrompt = '';
      try { specificPrompt = fs.readFileSync(templatePath, 'utf-8'); } catch (e) { specificPrompt = 'Create a fantasy art image suitable for a D&D game.'; }

      const systemPrompt = basePrompt ? `${basePrompt}\n\n${specificPrompt}` : specificPrompt;
      let promptToSend = `${systemPrompt}\n\nUser request: ${prompt}`.replace(/<[^>]+>/g, '');

      const baseImage = req.files?.baseImage?.[0];
      const referenceImages = req.files?.referenceImage || [];
      if (referenceImages.length > 0) promptToSend += '\n\nPlease use the attached reference images as style and character guides.';
      if (baseImage) promptToSend += '\n\nPlease use the attached base image as a guide for composition and layout.';

      const userTempDir = path.join(usersDir, shareKey, 'images', 'temp');

      const getMimeType = (file) => {
        const filename = typeof file === 'string' ? file : (file.originalname || file.filename || '');
        const ext = path.extname(filename).toLowerCase();
        if (ext === '.png') return 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
        if (ext === '.webp') return 'image/webp';
        if (ext === '.gif') return 'image/gif';
        return 'image/png';
      };

      let filename;
      if (baseImage) {
        try {
          const refPath = path.join(userTempDir, baseImage.filename);
          const buffer = fs.readFileSync(refPath);
          const mime = getMimeType(baseImage.filename);
          const blob = new Blob([buffer], { type: mime });

          const form = new FormData();
          form.append('image', blob, baseImage.filename);
          form.append('prompt', promptToSend);
          form.append('model', 'gpt-image-1');
          form.append('n', '1');
          form.append('size', '1024x1024');
          form.append('quality', 'medium');
          form.append('background', 'transparent');
          form.append('output_format', 'png');

          const manualResp = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: form });
          if (!manualResp.ok) throw new Error(`Manual edits POST failed: ${manualResp.status}`);
          const editResponse = await manualResp.json();
          const out = editResponse?.data?.[0] || editResponse?.output?.[0] || null;
          let imageBuffer = null;
          if (out?.b64_json) imageBuffer = Buffer.from(out.b64_json, 'base64');
          else if (out?.url) { const r = await fetch(out.url); const ab = await r.arrayBuffer(); imageBuffer = Buffer.from(ab); }
          else if (out && typeof out === 'string' && out.startsWith('data:')) { const parts = out.split(','); imageBuffer = Buffer.from(parts[1], 'base64'); }
          if (!imageBuffer) throw new Error('No image returned from OpenAI edits');

          try {
            const image = sharp(imageBuffer);
            const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
            const r = data[0], g = data[1], b = data[2];
            const pixelCount = info.width * info.height;
            const newData = Buffer.alloc(pixelCount * 4);
            const tolerance = 50;
            let transparentPixels = 0;
            for (let i = 0; i < pixelCount; i++) {
              const srcOffset = i * info.channels;
              const dstOffset = i * 4;
              const pr = data[srcOffset], pg = data[srcOffset + 1], pb = data[srcOffset + 2];
              const isBackground = Math.abs(pr - r) <= tolerance && Math.abs(pg - g) <= tolerance && Math.abs(pb - b) <= tolerance;
              if (isBackground) { newData[dstOffset] = 0; newData[dstOffset + 1] = 0; newData[dstOffset + 2] = 0; newData[dstOffset + 3] = 0; transparentPixels++; }
              else { newData[dstOffset] = pr; newData[dstOffset + 1] = pg; newData[dstOffset + 2] = pb; newData[dstOffset + 3] = 255; }
            }
            imageBuffer = await sharp(newData, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
          } catch (bgRemovalErr) {
            console.error('Background removal failed, using original image:', bgRemovalErr.message);
          }

          filename = `ai-generated-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
          if (!fs.existsSync(userTempDir)) fs.mkdirSync(userTempDir, { recursive: true });
          fs.writeFileSync(path.join(userTempDir, filename), imageBuffer);
        } catch (err) {
          console.error('OpenAI SDK images.edits error:', err); return res.status(500).json({ error: err.message || 'OpenAI images.edits failed' });
        }
      } else {
        // No base image - use generations
        const requestBody = { model: 'gpt-image-1', prompt: promptToSend, n: 1, size: '1024x1024', quality: 'medium', background: 'transparent', output_format: 'png' };
        const response = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(requestBody) });
        if (!response.ok) { const errorData = await response.json(); return res.status(response.status).json({ error: errorData.error?.message || 'Failed to generate image' }); }
        const data = await response.json();
        let generatedImageUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json;
        if (!generatedImageUrl) throw new Error('No image returned from OpenAI');
        let imageBuffer;
        if (generatedImageUrl.startsWith('data:') || !generatedImageUrl.startsWith('http')) { const base64Data = generatedImageUrl.includes(',') ? generatedImageUrl.split(',')[1] : generatedImageUrl; imageBuffer = Buffer.from(base64Data, 'base64'); }
        else { const imageResponse = await fetch(generatedImageUrl); imageBuffer = Buffer.from(await imageResponse.arrayBuffer()); }

        try {
          const image = sharp(imageBuffer);
          const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
          const r = data[0], g = data[1], b = data[2];
          const pixelCount = info.width * info.height;
          const newData = Buffer.alloc(pixelCount * 4);
          const tolerance = 50;
          let transparentPixels = 0;
          for (let i = 0; i < pixelCount; i++) {
            const srcOffset = i * info.channels; const dstOffset = i * 4; const pr = data[srcOffset], pg = data[srcOffset + 1], pb = data[srcOffset + 2];
            const isBackground = Math.abs(pr - r) <= tolerance && Math.abs(pg - g) <= tolerance && Math.abs(pb - b) <= tolerance;
            if (isBackground) { newData[dstOffset] = 0; newData[dstOffset + 1] = 0; newData[dstOffset + 2] = 0; newData[dstOffset + 3] = 0; transparentPixels++; }
            else { newData[dstOffset] = pr; newData[dstOffset + 1] = pg; newData[dstOffset + 2] = pb; newData[dstOffset + 3] = 255; }
          }
          imageBuffer = await sharp(newData, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
        } catch (bgRemovalErr) { console.error('Background removal failed, using original image:', bgRemovalErr.message); }

        filename = `ai-generated-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
        if (!fs.existsSync(userTempDir)) fs.mkdirSync(userTempDir, { recursive: true });
        fs.writeFileSync(path.join(userTempDir, filename), Buffer.from(imageBuffer));
      }

      const imageUrl = `/users/${shareKey}/images/temp/${filename}`;
      res.json({ success: true, imageUrl, filename, template });
    } catch (err) { console.error('Image generation error:', err); res.status(500).json({ error: err.message || 'Failed to generate image' }); }
  });

  // Move AI-generated image from temp to final folder
  app.post('/api/confirm-ai-image', requireAuth, provideShareKey, express.json(), async (req, res) => {
    try {
      const { filename, template } = req.body;
      if (!filename || !template) return res.status(400).json({ error: 'filename and template required' });
      const shareKey = req.shareKey; if (!shareKey) return res.status(401).json({ error: 'No share key available' });
      const userTempDir = path.join(usersDir, shareKey, 'images', 'temp');
      const tempPath = path.join(userTempDir, filename);
      if (!fs.existsSync(tempPath)) return res.status(404).json({ error: 'Temp file not found' });
      const targetSubfolder = path.join(usersDir, shareKey, 'images', template);
      if (!fs.existsSync(targetSubfolder)) fs.mkdirSync(targetSubfolder, { recursive: true });
      const finalPath = path.join(targetSubfolder, filename);
      fs.renameSync(tempPath, finalPath);
      const imageUrl = `/users/${shareKey}/images/${template}/${filename}`;
      res.json({ success: true, imageUrl, filename });
    } catch (err) { console.error('Confirm AI image error:', err); res.status(500).json({ error: 'Failed to confirm AI image' }); }
  });

  // Image search (Google Custom Search)
  app.get('/api/search-images', async (req, res) => {
    try {
      const { query } = req.query; if (!query || typeof query !== 'string') return res.status(400).json({ error: 'Query parameter required' });
      const apiKey = googleSearchApiKey || process.env.GOOGLE_SEARCH_API_KEY || 'YOUR_API_KEY';
      const searchEngineId = googleSearchEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID || 'YOUR_SEARCH_ENGINE_ID';
      if (apiKey === 'YOUR_API_KEY' || searchEngineId === 'YOUR_SEARCH_ENGINE_ID') return res.json({ images: [] });
      const allImages = []; const callsToMake = 5;
      for (let i = 0; i < callsToMake; i++) {
        const start = i * 10 + 1; const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&searchType=image&num=10&start=${start}`;
        try { const response = await fetch(searchUrl); if (!response.ok) break; const data = await response.json(); const images = (data.items || []).map(item => ({ url: item.link, thumbnail: item.image?.thumbnailLink || item.link, title: item.title, width: item.image?.width, height: item.image?.height })); allImages.push(...images); if (images.length < 10) break; } catch (err) { break; }
      }
      res.json({ images: allImages });
    } catch (err) { console.error('Image search error:', err); res.status(500).json({ error: 'Failed to search images' }); }
  });

  // Proxy to download images
  app.get('/api/download-image', async (req, res) => {
    const { url } = req.query; if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL parameter required' });
    try { if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Only http(s) URLs are supported' }); const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`); const contentType = response.headers.get('content-type'); if (!contentType || !contentType.startsWith('image/')) return res.status(400).json({ error: 'URL does not point to an image' }); const buffer = await response.arrayBuffer(); res.setHeader('Content-Type', contentType); res.setHeader('Access-Control-Allow-Origin', '*'); res.send(Buffer.from(buffer)); } catch (err) { console.error('Image download error:', err); res.status(500).json({ error: 'Failed to download image' }); }
  });

  // Proxy to fetch external pages
  app.get('/api/proxy', async (req, res) => {
    const { url } = req.query; if (!url || typeof url !== 'string') return res.status(400).send('URL parameter required');
    try { if (!/^https?:\/\//i.test(url)) return res.status(400).send('Only http(s) URLs are supported'); const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (!response.ok) return res.status(response.status).send(`Failed to fetch URL: ${response.status}`); const contentType = response.headers.get('content-type') || 'text/html'; res.setHeader('Content-Type', contentType); const body = await response.text(); res.send(body); } catch (err) { console.error('Proxy error:', err); res.status(500).send('Failed to proxy request'); }
  });

  // Import portrait via Puppeteer
  app.post('/api/import-portrait', provideShareKey, express.json(), async (req, res) => {
    const { url } = req.body || {}; if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL required' });
    const shareKey = req.shareKey; if (!shareKey) return res.status(401).json({ error: 'No share key available' });
    let browser; try {
      if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Only http(s) URLs are supported' });
      let imageUrl = null; let notes = ''; let characterName = '';
      const ddbMatch = url.match(/dndbeyond\.com\/characters\/(\d+)/);
      if (ddbMatch) {
        const characterId = ddbMatch[1]; const apiUrl = `https://character-service.dndbeyond.com/character/v5/character/${characterId}`;
        const apiResp = await fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (!apiResp.ok) return res.status(502).json({ error: `Failed to fetch character data: ${apiResp.status}` }); const charData = await apiResp.json(); characterName = charData.data?.name || ''; imageUrl = charData.data?.avatarUrl || charData.data?.decorations?.avatarUrl || null; const race = charData.data?.race?.fullName || charData.data?.race?.baseName || ''; const raceDescription = charData.data?.race?.description || ''; const stripHtml = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); const cleanRaceDescription = stripHtml(raceDescription); const classes = (charData.data?.classes || []).map(c => `${c.definition?.name || ''} ${c.level || ''}`.trim()).filter(Boolean).join('/'); const classDescriptions = (charData.data?.classes || []).map(c => c.definition?.description || '').filter(Boolean).join('\n\n'); const cleanClassDescriptions = stripHtml(classDescriptions); const characterNotes = (charData.data?.notes?.allies || '') + '\n\n' + (charData.data?.notes?.personalPossessions || '') + '\n\n' + (charData.data?.notes?.otherNotes || '') + '\n\n' + (charData.data?.notes?.backstory || ''); const traits = [ charData.data?.traits?.appearance || '', charData.data?.traits?.personalityTraits || '', charData.data?.traits?.ideals || '', charData.data?.traits?.bonds || '', charData.data?.traits?.flaws || '' ].filter(Boolean).join('\n\n'); const header = [race, classes].filter(Boolean).join(' '); const combinedText = [header, raceDescription, classDescriptions, characterNotes.trim(), traits].filter(Boolean).join('\n\n'); notes = combinedText ? `~~~do not remove~~~\n\n${combinedText}` : '';
      } else {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage(); await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }); await new Promise(resolve => setTimeout(resolve, 2000)); const result = await page.evaluate(() => { let imageUrl = null; const portraitDiv = document.querySelector('.ddbc-character-avatar__portrait'); if (portraitDiv) { const bgImage = window.getComputedStyle(portraitDiv).backgroundImage; const match = bgImage.match(/url\(["']?([^"'\)]+)["']?\)/); if (match && match[1]) { imageUrl = match[1]; } } const noteElements = document.querySelectorAll('.ct-notes__note'); const notes = Array.from(noteElements).map(el => el.textContent?.trim()).filter(Boolean).join('\n\n'); const traitElements = document.querySelectorAll('.ct-trait-content__content'); const traits = Array.from(traitElements).map(el => el.textContent?.trim()).filter(Boolean).join('\n\n'); const nameDiv = document.querySelector('.ddbc-character-tidbits__heading'); const nameH1 = nameDiv?.querySelector('h1'); const characterName = nameH1?.textContent?.trim() || ''; const raceElement = document.querySelector('.ddbc-character-summary__race'); const race = raceElement?.textContent?.trim() || ''; const classElement = document.querySelector('.ddbc-character-summary__classes'); const classes = classElement?.textContent?.trim() || ''; const header = [race, classes].filter(Boolean).join(' '); const combinedText = [header, notes, traits].filter(Boolean).join('\n\n'); const notesWithTerminator = combinedText ? `~~~do not remove~~~\n\n${combinedText}` : ''; return { imageUrl, notes: notesWithTerminator, characterName }; });
      imageUrl = result.imageUrl; notes = result.notes || ''; characterName = result.characterName || '';
      if (!imageUrl) { imageUrl = await page.evaluate(() => { const img = document.querySelector('.ddbc-character-avatar__portrait img, img.ddbc-character-avatar__portrait'); return img?.src || null; }); }
      if (!imageUrl) { imageUrl = await page.evaluate(() => { const img = document.querySelector('[class*="avatar"] img, [class*="portrait"] img'); return img?.src || null; }); }
      if (!imageUrl) { imageUrl = await page.evaluate(() => { const ogImage = document.querySelector('meta[property="og:image"]'); return ogImage?.getAttribute('content') || null; }); }
      if (browser) { await browser.close(); browser = null; }
      }

    if (!imageUrl) return res.json({ success: true, filename: 'blankimage.png', url: '/images/portrait/blankimage.png', notes, characterName });
    try { imageUrl = new URL(imageUrl, url).href; } catch (e) {}
    const imgResp = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (!imgResp.ok) return res.status(502).json({ error: `Failed to download image: ${imgResp.status}` }); const contentType = imgResp.headers.get('content-type') || ''; let ext = '.png'; if (contentType.includes('jpeg')) ext = '.jpg'; else if (contentType.includes('png')) ext = '.png'; else if (contentType.includes('webp')) ext = '.webp'; const buffer = Buffer.from(await imgResp.arrayBuffer()); const userPortraitDir = path.join(usersDir, shareKey, 'images', 'portrait'); if (!fs.existsSync(userPortraitDir)) fs.mkdirSync(userPortraitDir, { recursive: true }); const characterIdMatch = url.match(/\/characters\/(\d+)/); const characterId = characterIdMatch ? characterIdMatch[1] : `imported-${Date.now()}`; const filename = `${characterId}${ext}`; const savePath = path.join(userPortraitDir, filename); fs.writeFileSync(savePath, buffer); const publicUrl = `/users/${shareKey}/images/portrait/${filename}`; res.json({ success: true, filename, url: publicUrl, notes, characterName }); } catch (err) { console.error('Import portrait error:', err); if (browser) await browser.close(); res.status(500).json({ error: 'Failed to import portrait' }); } });

  // Get list of all uploaded maps (deprecated)
  app.get('/api/maps', requireAuth, (req, res) => {
    res.json({ maps: [], message: 'Maps are stored per-scenario. Use scenario endpoints instead.' });
  });

  // Get list of all uploaded actor images
  app.get('/api/images', (req, res) => {
    try {
      const folder = req.query.folder;
      // Allow unauthenticated listing when a shareKey is provided via query or header
      let shareKey = (req.query && req.query.shareKey) || req.headers['x-share-key'] || req.shareKey || (req.user && req.user.currentShareKey);
      if (shareKey) shareKey = String(shareKey).toLowerCase();
      const actors = [];
      if (!shareKey) return res.status(400).json({ error: 'No share key available' });
      if (folder) { const folderPath = path.join(usersDir, shareKey, 'images', folder); if (fs.existsSync(folderPath)) { const files = fs.readdirSync(folderPath); files.forEach(file => { if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file)) { actors.push({ filename: file, url: `/users/${shareKey}/images/${folder}/${file}` }); } }); } return res.json({ actors, files: actors }); }
      const userImagesDir = path.join(usersDir, shareKey, 'images');
      const portraitDir = path.join(userImagesDir, 'portrait'); if (fs.existsSync(portraitDir)) { const portraitFiles = fs.readdirSync(portraitDir); portraitFiles.forEach(file => { if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file)) { actors.push({ filename: file, url: `/users/${shareKey}/images/portrait/${file}` }); } }); }
      const tokenDir = path.join(userImagesDir, 'token'); if (fs.existsSync(tokenDir)) { const tokenFiles = fs.readdirSync(tokenDir); tokenFiles.forEach(file => { if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file)) { actors.push({ filename: file, url: `/users/${shareKey}/images/token/${file}` }); } }); }
      res.json({ actors });
    } catch (err) { console.error('Failed to read actor images:', err); res.status(500).json({ error: 'Failed to read actors images' }); }
  });

    // Helper function to check if an image is in use
    function checkImageUsage(shareKey, imageUrl) {
      const usedBy = [];
      const searchFilename = path.basename(imageUrl);

      try {
        const userCampaignsDir = path.join(usersDir, shareKey, 'campaigns');
        if (!fs.existsSync(userCampaignsDir)) {
          return usedBy;
        }

        const campaigns = fs.readdirSync(userCampaignsDir).filter(file => {
          const stat = fs.statSync(path.join(userCampaignsDir, file));
          return stat.isDirectory();
        });

        for (const campaign of campaigns) {
          const campaignPath = path.join(userCampaignsDir, campaign);

          // Check campaign background image
          const metadataPath = path.join(campaignPath, '.metadata.json');
          if (fs.existsSync(metadataPath)) {
            try {
              const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
              if (metadata.backgroundImage && path.basename(metadata.backgroundImage) === searchFilename) {
                usedBy.push(`Campaign: ${campaign} (background)`);
              }
            } catch (err) {
              console.error('Error reading campaign metadata:', err);
            }
          }

          // Check player tokens
          const playerTokensPath = path.join(campaignPath, 'playertokens');
          if (fs.existsSync(playerTokensPath)) {
            const tokenFiles = fs.readdirSync(playerTokensPath).filter(f => f.endsWith('.json'));
            for (const tokenFile of tokenFiles) {
              try {
                const fileContent = fs.readFileSync(path.join(playerTokensPath, tokenFile), 'utf8');
                if (fileContent.includes(searchFilename)) {
                  const tokenData = JSON.parse(fileContent);
                  usedBy.push(`Player Token: ${tokenData.actor?.name || 'Unknown'} (${campaign}) - ${tokenFile}`);
                }
              } catch (err) {
                console.error('Error reading player token:', err);
              }
            }
          }

          // Check scenarios
          const scenariosPath = path.join(campaignPath, 'scenarios');
          if (fs.existsSync(scenariosPath)) {
            const scenarios = fs.readdirSync(scenariosPath).filter(file => {
              const stat = fs.statSync(path.join(scenariosPath, file));
              return stat.isDirectory();
            });

            for (const scenario of scenarios) {
              const scenarioPath = path.join(scenariosPath, scenario);

              // Check NPC tokens
              const npcTokensPath = path.join(scenarioPath, 'npctokens');
              if (fs.existsSync(npcTokensPath)) {
                const tokenFiles = fs.readdirSync(npcTokensPath).filter(f => f.endsWith('.json'));
                for (const tokenFile of tokenFiles) {
                  try {
                    const fileContent = fs.readFileSync(path.join(npcTokensPath, tokenFile), 'utf8');
                    if (fileContent.includes(searchFilename)) {
                      const tokenData = JSON.parse(fileContent);
                      usedBy.push(`NPC Token: ${tokenData.actor?.name || 'Unknown'} (${campaign}/${scenario}) - ${tokenFile}`);
                    }
                  } catch (err) {
                    console.error('Error reading NPC token:', err);
                  }
                }
              }

              // Check props
              const propsPath = path.join(scenarioPath, 'props');
              if (fs.existsSync(propsPath)) {
                const propFiles = fs.readdirSync(propsPath).filter(f => f.endsWith('.json'));
                for (const propFile of propFiles) {
                  try {
                    const fileContent = fs.readFileSync(path.join(propsPath, propFile), 'utf8');
                    if (fileContent.includes(searchFilename)) {
                      const propData = JSON.parse(fileContent);
                      usedBy.push(`Prop: ${propData.name || 'Unnamed'} (${campaign}/${scenario}) - ${propFile}`);
                    }
                  } catch (err) {
                    console.error('Error reading prop:', err);
                  }
                }
              }

              // Check maps
              const mapsPath = path.join(scenarioPath, 'maps');
              if (fs.existsSync(mapsPath)) {
                const mapFiles = fs.readdirSync(mapsPath);
                const imageMapFiles = mapFiles.filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));
                for (const mapFile of imageMapFiles) {
                  if (mapFile === searchFilename) {
                    usedBy.push(`Map: ${mapFile} (${campaign}/${scenario})`);
                  }
                }
              }

              // Check sessions
              const sessionsPath = path.join(campaignPath, 'sessions');
              if (fs.existsSync(sessionsPath)) {
                const sessions = fs.readdirSync(sessionsPath).filter(file => {
                  const stat = fs.statSync(path.join(sessionsPath, file));
                  return stat.isDirectory();
                });

                for (const session of sessions) {
                  const sessionScenarioPath = path.join(sessionsPath, session, 'scenarios', scenario);

                  // Check session NPC tokens
                  const sessionNpcTokensPath = path.join(sessionScenarioPath, 'npctokens');
                  if (fs.existsSync(sessionNpcTokensPath)) {
                    const tokenFiles = fs.readdirSync(sessionNpcTokensPath).filter(f => f.endsWith('.json'));
                    for (const tokenFile of tokenFiles) {
                      try {
                        const fileContent = fs.readFileSync(path.join(sessionNpcTokensPath, tokenFile), 'utf8');
                        if (fileContent.includes(searchFilename)) {
                          const tokenData = JSON.parse(fileContent);
                          usedBy.push(`Session NPC: ${tokenData.actor?.name || 'Unknown'} (${campaign}/${session}/${scenario}) - ${tokenFile}`);
                        }
                      } catch (err) {
                        console.error('Error reading session NPC token:', err);
                      }
                    }
                  }

                  // Check session player tokens
                  const sessionPlayerTokensPath = path.join(sessionsPath, session, 'playertokens');
                  if (fs.existsSync(sessionPlayerTokensPath)) {
                    const tokenFiles = fs.readdirSync(sessionPlayerTokensPath).filter(f => f.endsWith('.json'));
                    for (const tokenFile of tokenFiles) {
                      try {
                        const fileContent = fs.readFileSync(path.join(sessionPlayerTokensPath, tokenFile), 'utf8');
                        if (fileContent.includes(searchFilename)) {
                          const tokenData = JSON.parse(fileContent);
                          usedBy.push(`Session Player: ${tokenData.actor?.name || 'Unknown'} (${campaign}/${session}) - ${tokenFile}`);
                        }
                      } catch (err) {
                        console.error('Error reading session player token:', err);
                      }
                    }
                  }

                  // Check session props
                  const sessionPropsPath = path.join(sessionScenarioPath, 'props');
                  if (fs.existsSync(sessionPropsPath)) {
                    const propFiles = fs.readdirSync(sessionPropsPath).filter(f => f.endsWith('.json'));
                    for (const propFile of propFiles) {
                      try {
                        const fileContent = fs.readFileSync(path.join(sessionPropsPath, propFile), 'utf8');
                        if (fileContent.includes(searchFilename)) {
                          const propData = JSON.parse(fileContent);
                          usedBy.push(`Session Prop: ${propData.name || 'Unnamed'} (${campaign}/${session}/${scenario}) - ${propFile}`);
                        }
                      } catch (err) {
                        console.error('Error reading session prop:', err);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('Error checking image usage:', err);
      }

      return usedBy;
    }

    // Image Gallery Manager
  app.get('/api/image-gallery', (req, res) => {
    try {
      const folder = req.query.folder;

      // Allow unauthenticated listing when a shareKey is provided via query or header
      let shareKey = (req.query && req.query.shareKey) || req.headers['x-share-key'] || req.shareKey || (req.user && req.user.currentShareKey);
      if (shareKey) shareKey = String(shareKey).toLowerCase();

      if (!shareKey) return res.status(400).json({ error: 'No share key available' });
      if (!folder) return res.status(400).json({ error: 'Folder parameter required' });

      const folderPath = path.join(usersDir, shareKey, 'images', folder);
      if (!fs.existsSync(folderPath)) return res.json({ images: [] });

      const files = fs.readdirSync(folderPath);
      const imageFiles = files.filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));
      const images = imageFiles.map(filename => {
        const url = `/users/${shareKey}/images/${folder}/${filename}`;
        const usageInfo = checkImageUsage(shareKey, url);
        return { filename, url, inUse: usageInfo.length > 0, usedBy: usageInfo };
      });

      res.json({ images });
    } catch (err) {
      console.error('Failed to load image gallery:', err);
      res.status(500).json({ error: 'Failed to load image gallery' });
    }
  });

  // Delete an image
  app.delete('/api/images', requireGM, provideShareKey, (req, res) => {
    try {
      const { url } = req.query; if (!url) return res.status(400).json({ error: 'URL parameter required' }); if (!req.shareKey) return res.status(401).json({ error: 'No share key available' }); const relativePath = url.replace(/^\//, ''); const filePath = path.join(serverDir, relativePath); const normalizedPath = path.normalize(filePath); const normalizedUserDir = path.normalize(path.join(usersDir, req.shareKey)); if (!normalizedPath.startsWith(normalizedUserDir)) return res.status(403).json({ error: 'Access denied' }); if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' }); fs.unlinkSync(filePath); res.json({ success: true, message: 'Image deleted successfully' }); } catch (err) { console.error('Failed to delete image:', err); res.status(500).json({ error: 'Failed to delete image' }); }
  });

  // Flip horizontal
  app.post('/api/images/flip-horizontal', requireGM, provideShareKey, express.json(), async (req, res) => {
    try {
      const { imageUrl } = req.body; if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' }); if (!req.shareKey) return res.status(401).json({ error: 'No share key available' }); const relativePath = imageUrl.replace(/^\//, ''); const filePath = path.join(serverDir, relativePath); const normalizedPath = path.normalize(filePath); const normalizedUserDir = path.normalize(path.join(usersDir, req.shareKey)); if (!normalizedPath.startsWith(normalizedUserDir)) return res.status(403).json({ error: 'Access denied' }); if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' }); await sharp(filePath).flop().toFile(filePath + '.tmp'); fs.renameSync(filePath + '.tmp', filePath); res.json({ success: true, message: 'Image flipped successfully' }); } catch (err) { console.error('Error flipping image:', err); res.status(500).json({ error: 'Failed to flip image' }); }
  });

  // Remove background
  app.post('/api/images/remove-background', requireGM, provideShareKey, express.json(), async (req, res) => {
    try {
      const { imageUrl } = req.body; if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' }); if (!req.shareKey) return res.status(401).json({ error: 'No share key available' }); const relativePath = imageUrl.replace(/^\//, ''); const filePath = path.join(serverDir, relativePath); const normalizedPath = path.normalize(filePath); const normalizedUserDir = path.normalize(path.join(usersDir, req.shareKey)); if (!normalizedPath.startsWith(normalizedUserDir)) return res.status(403).json({ error: 'Access denied' }); if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' }); const image = sharp(filePath); const metadata = await image.metadata(); const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const targetR = data[0], targetG = data[1], targetB = data[2]; const tolerance = 30; for (let i = 0; i < data.length; i += 4) { const r = data[i], g = data[i + 1], b = data[i + 2]; if (Math.abs(r - targetR) <= tolerance && Math.abs(g - targetG) <= tolerance && Math.abs(b - targetB) <= tolerance) { data[i + 3] = 0; } } await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(filePath); res.json({ success: true, message: 'Background removed successfully' }); } catch (err) { console.error('Failed to remove background:', err); res.status(500).json({ error: 'Failed to remove background: ' + err.message }); }
  });

}

// Helper function to fix legacy image paths to use share key paths
export function fixImagePath(imagePath, shareKey) {
  if (!imagePath || !shareKey) return imagePath;
  if (imagePath.startsWith('http')) return imagePath; // Already absolute URL

  // If it's a legacy /images/ path, convert to share key path
  if (imagePath.startsWith('/images/')) {
    return `/users/${shareKey}${imagePath}`;
  }

  return imagePath;
}
