import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import session from 'express-session';
import SessionFileStore from 'session-file-store';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FileStore = SessionFileStore(session);

// Load settings
let settings = {};
try {
  const settingsPath = path.join(__dirname, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }
} catch (error) {
  console.error('Error loading settings:', error);
}

// In-memory user store (persisted to disk)
const users = new Map();
const usersByEmail = new Map();

// Path to store user data
const usersDataPath = path.join(__dirname, 'users', 'sessions', 'users.json');

// Load users from disk
const loadUsers = () => {
  try {
    if (fs.existsSync(usersDataPath)) {
      const data = JSON.parse(fs.readFileSync(usersDataPath, 'utf8'));
      data.users.forEach(user => {
        users.set(user.id, user);
        usersByEmail.set(user.email, user);
      });
      console.log(`✓ Loaded ${users.size} users from disk`);
    }
  } catch (error) {
    console.error('Error loading users:', error);
  }
};

// Save users to disk
const saveUsers = () => {
  try {
    const usersArray = Array.from(users.values());
    fs.writeFileSync(usersDataPath, JSON.stringify({ users: usersArray }, null, 2));
  } catch (error) {
    console.error('Error saving users:', error);
  }
};

// Load users on startup
loadUsers();

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser((id, done) => {
  const user = users.get(id);
  if (!user) {
    // User not found in memory (likely after server restart)
    // Return null to indicate user is not authenticated
    return done(null, false);
  }
  done(null, user);
});

// Configure Google OAuth Strategy
const isOAuthConfigured = settings.oauth?.google?.clientId && settings.oauth?.google?.clientSecret;

if (isOAuthConfigured) {
  passport.use(new GoogleStrategy({
    clientID: settings.oauth.google.clientId,
    clientSecret: settings.oauth.google.clientSecret,
    callbackURL: settings.oauth.google.callbackURL || 'http://localhost:3001/auth/google/callback'
  },
  (accessToken, refreshToken, profile, done) => {
    // Find or create user
    let user = usersByEmail.get(profile.emails[0].value);
    
    if (!user) {
      user = {
        id: profile.id,
        email: profile.emails[0].value,
        name: profile.displayName,
        picture: profile.photos?.[0]?.value,
        provider: 'google',
        role: 'player' // Default to player, will be updated to GM if they own share keys
      };
      users.set(user.id, user);
      usersByEmail.set(user.email, user);
      saveUsers(); // Persist to disk
    } else {
      // Update existing user info
      user.name = profile.displayName;
      user.picture = profile.photos?.[0]?.value;
      saveUsers(); // Persist to disk
    }
    
    // Scan for accessible share keys
    const usersDir = path.join(__dirname, 'users');
    const accessibleShareKeys = [];
    
    if (fs.existsSync(usersDir)) {
      const shareKeyDirs = fs.readdirSync(usersDir).filter(dir => {
        try {
          const stat = fs.statSync(path.join(usersDir, dir));
          return stat.isDirectory();
        } catch {
          return false;
        }
      });
      
      for (const shareKey of shareKeyDirs) {
        const dataPath = path.join(usersDir, shareKey, '.user.json');
        if (fs.existsSync(dataPath)) {
          try {
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            // User has access if they own it or are in the GMs list
            if (data.ownerId === user.id || (data.gms && data.gms.includes(user.email))) {
              accessibleShareKeys.push({
                shareKey,
                ownerId: data.ownerId,
                isOwner: data.ownerId === user.id
              });
            }
          } catch (err) {
            console.error(`Error reading data for share key ${shareKey}:`, err);
          }
        }
      }
    }
    
    user.accessibleShareKeys = accessibleShareKeys;
    user.currentShareKey = accessibleShareKeys.length > 0 ? accessibleShareKeys[0].shareKey : null;
    
    // Assign role based on share key ownership
    // If user owns or has access to any share keys, they're a GM
    // Otherwise, they're a player
    if (accessibleShareKeys.length > 0) {
      user.role = 'gm';
    } else {
      user.role = 'player';
    }
    
    // Save user with updated share keys
    saveUsers();
    
    console.log(`✓ User ${user.email} has access to ${accessibleShareKeys.length} share key(s) - Role: ${user.role}`);
    
    return done(null, user);
  }));
} else {
  console.warn('⚠️  Google OAuth not configured. Please add oauth credentials to settings.json');
  console.warn('   Copy settings.json.example to settings.json and add your Google OAuth credentials.');
}

// Ensure sessions directory exists
const sessionsDir = path.join(__dirname, 'users', 'sessions');
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// Session middleware configuration
const sessionMiddleware = session({
  store: new FileStore({
    path: sessionsDir,
    ttl: 30 * 24 * 60 * 60, // 30 days in seconds
    reapInterval: 24 * 60 * 60 // Clean up expired sessions every 24 hours
  }),
  secret: settings.sessionSecret || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
});

// Authentication middleware - require login for protected routes
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
};

// GM role middleware - require GM role
// User is considered a GM if they:
// 1. Are authenticated and accessing their own campaigns
// 2. Are in the campaign owner's GM list (for future collaboration)
const requireGM = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // For now, all authenticated users can access their own campaigns
  // Future: check if req.user.id is in the campaign owner's GM list
  if (req.user.role === 'gm') {
    return next();
  }
  
  res.status(403).json({ error: 'GM access required' });
};

// ===========================
// Authentication Routes Setup
// ===========================

/**
 * Register all authentication routes with the Express app
 * @param {Express.Application} app - The Express app instance
 * @param {Object} context - Context object with game state getters and other references
 *                            Can contain functions that return current values
 */
function registerAuthRoutes(app, context = {}) {
  // Destructure context with defaults and handle both values and functions
  const getContext = (key, defaultValue) => {
    const value = context[key];
    return typeof value === 'function' ? value() : value;
  };

  const getCurrentShareKey = () => getContext('currentShareKey', null);
  const getCurrentCampaign = () => getContext('currentCampaign', null);
  const getCurrentSessionName = () => getContext('currentSessionName', null);
  const getCurrentScenario = () => getContext('currentScenario', null);
  const getIsSessionActive = () => getContext('isSessionActive', false);
  const getUsersDir = () => getContext('usersDir', path.join(__dirname, 'users'));

  // ===========================
  // Google OAuth Routes
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
        // Successful authentication, redirect to home page
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

  // ===========================
  // Logout Route
  // ===========================

  app.post('/auth/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: 'Logout failed' });
      }
      res.json({ success: true });
    });
  });

  // ===========================
  // Auth Status Route
  // ===========================

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

  // ===========================
  // Share Key Sessions Route (Public)
  // ===========================

  app.get('/api/sharekey/:shareKey/sessions', (req, res) => {
    const { shareKey } = req.params;
    const usersDir = getUsersDir();
    const isSessionActive = getIsSessionActive();
    const currentShareKey = getCurrentShareKey();
    const currentCampaign = getCurrentCampaign();
    const currentSessionName = getCurrentSessionName();
    const currentScenario = getCurrentScenario();

    try {
      const shareKeyPath = path.join(usersDir, shareKey);
      if (!fs.existsSync(shareKeyPath)) {
        return res.status(404).json({ error: 'Share key not found', campaigns: [] });
      }

      // Check if there's a currently active session for this share key
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
  // Share Key Management Routes
  // ===========================

  // Get accessible share keys for current user
  app.get('/api/share-keys', requireAuth, (req, res) => {
    res.json({
      accessibleShareKeys: req.user.accessibleShareKeys || [],
      currentShareKey: req.user.currentShareKey
    });
  });

  // Create a new share key
  app.post('/api/share-keys', requireAuth, (req, res) => {
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

    // Save updated user
    saveUsers();

    res.json({
      success: true,
      shareKey: sanitizedKey,
      accessibleShareKeys: req.user.accessibleShareKeys,
      currentShareKey: req.user.currentShareKey
    });
  });

  // Set current share key
  app.patch('/api/share-keys/current', requireAuth, (req, res) => {
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
    saveUsers();

    res.json({
      success: true,
      currentShareKey: shareKey
    });
  });

  // Rename a share key (owner only)
  app.patch('/api/share-keys/:oldKey/rename', requireAuth, (req, res) => {
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

      saveUsers();

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
}

// ===========================
// Helper Functions
// ===========================

/**
 * Check if a share key already exists
 */
function shareKeyExists(shareKey) {
  const usersDir = path.join(__dirname, 'users');
  return fs.existsSync(path.join(usersDir, shareKey));
}

/**
 * Get the path to a share key's .user.json data file
 */
function getShareKeyDataPath(shareKey) {
  const usersDir = path.join(__dirname, 'users');
  return path.join(usersDir, shareKey, '.user.json');
}

/**
 * Load share key data from disk
 */
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

/**
 * Save share key data to disk
 */
function saveShareKeyData(shareKey, data) {
  const usersDir = path.join(__dirname, 'users');
  const dataPath = getShareKeyDataPath(shareKey);
  
  // Ensure directory exists
  const dir = path.dirname(dataPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

export {
  passport,
  sessionMiddleware,
  requireAuth,
  requireGM,
  isOAuthConfigured,
  users,
  usersByEmail,
  registerAuthRoutes,
  shareKeyExists,
  loadShareKeyData,
  saveShareKeyData
};
