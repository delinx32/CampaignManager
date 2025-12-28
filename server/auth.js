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

export {
  passport,
  sessionMiddleware,
  requireAuth,
  requireGM,
  isOAuthConfigured,
  users,
  usersByEmail
};
