# Authentication Setup

## Google OAuth Setup

1. **Create a Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one

2. **Enable Google+ API**
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google+ API" and enable it

3. **Create OAuth 2.0 Credentials**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Web application"
   - Add authorized redirect URIs:
     - Development: `http://localhost:3001/auth/google/callback`
     - Production: `https://yourdomain.com/auth/google/callback`

4. **Configure settings.json**
   - Copy `server/settings.json.example` to `server/settings.json`
   - Add your Google OAuth credentials:
   ```json
   {
     "oauth": {
       "google": {
         "clientId": "YOUR_GOOGLE_CLIENT_ID",
         "clientSecret": "YOUR_GOOGLE_CLIENT_SECRET",
         "callbackURL": "http://localhost:3001/auth/google/callback"
       }
     },
     "sessionSecret": "97be34bf54ffb45d501eef0185fcc2337873d8b202d87ce4dd633ef6633a4eae"
   }
   ```

5. **Generate a Session Secret**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

## How It Works

- **GM Access**: GMs must log in with Google OAuth to access:
  - Campaign management (create, edit, delete)
  - Scenario management
  - Map uploads
  - Token/prop creation
  - Game state control

- **Public Access**: Players and observers can access without login:
  - Observer view (read-only map view)
  - Player view (character cards and sheets)

## Routes

### Protected Routes (GM only)
- `/` - Campaign selection
- `/campaign/:name` - Scenario selection
- `/campaign/:name/:scenario/gm` - GM view

### Public Routes
- `/:campaign/:session/observer` - Observer view
- `/:campaign/:session/player` - Player view
- `/login` - Login page

## Session Management

- Sessions are stored in memory (development)
- Cookies are httpOnly and last 24 hours
- Set `cookie.secure: true` in production with HTTPS

## Development Notes

- CORS is configured to allow credentials from `http://localhost:5173`
- In production, update CORS origin to match your frontend domain
- The backend runs on port 3001, frontend on 5173
