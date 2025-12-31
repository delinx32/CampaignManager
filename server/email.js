import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let emailTransporter = null;
let emailConfigured = false;

/**
 * Initialize email transporter with Gmail credentials from settings.json
 * Requires email.gmail and email.appPassword in settings.json
 */
export function initializeEmailService() {
  try {
    const settingsPath = path.join(__dirname, 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      console.warn('⚠️  settings.json not found');
      return false;
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const gmailUser = settings.email?.gmail;
    const gmailAppPassword = settings.email?.appPassword;
    const frontendUrl = settings.email?.frontendUrl || 'http://localhost:5173';

    if (!gmailUser || !gmailAppPassword) {
      console.warn('⚠️  Email service not configured. Add email.gmail and email.appPassword to settings.json to enable player invites.');
      emailConfigured = false;
      return false;
    }

    emailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailAppPassword
      }
    });

    emailConfigured = true;
    console.log(`✓ Email service initialized with ${gmailUser}`);
    return true;
  } catch (err) {
    console.error('Failed to initialize email service:', err);
    emailConfigured = false;
    return false;
  }
}

/**
 * Send player invite email
 * @param {string} playerEmail - Email address of the player to invite
 * @param {string} shareKey - Share key for the campaign
 * @param {string} ownerName - Name of the campaign owner/GM
 * @param {string} campaignName - Name of the campaign (optional)
 * @param {string} frontendUrl - Frontend URL to use in the invite link (optional, defaults to http://localhost:5173)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendPlayerInviteEmail(playerEmail, shareKey, ownerName, campaignName = null, frontendUrl = null) {
  if (!emailConfigured || !emailTransporter) {
    console.warn('Email service not configured, skipping email send');
    return { success: false, error: 'Email service not configured' };
  }

  // Use provided frontendUrl, fallback to settings.json, then default
  if (!frontendUrl) {
    try {
      const settingsPath = path.join(__dirname, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        frontendUrl = settings.email?.frontendUrl || 'http://localhost:5173';
      }
    } catch (err) {
      frontendUrl = 'http://localhost:5173';
    }
  }

  const landingPageUrl = `${frontendUrl}/${encodeURIComponent(shareKey)}`;

  const emailHtml = `
    <h2>You've been invited to join a D&D campaign!</h2>
    
    <p>Hello,</p>
    
    <p><strong>${ownerName}</strong> has added you as a player to ${campaignName ? `the <strong>${campaignName}</strong> campaign` : 'their D&D campaign'}.</p>
    
    <p>You can now access the player view by logging in with your Google account at the link below:</p>
    
    <p style="margin: 20px 0;">
      <a href="${landingPageUrl}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
        Access Campaign
      </a>
    </p>
    
    <p>Or visit this link directly:<br />
    <code style="background-color: #f0f0f0; padding: 4px 8px; border-radius: 3px;">${landingPageUrl}</code></p>
    
    <p>Once you're in, you'll be able to:</p>
    <ul>
      <li>View the campaign map during sessions</li>
      <li>See your character information</li>
      <li>Watch real-time updates from the GM</li>
    </ul>
    
    <p>If you have any questions, contact ${ownerName} directly.</p>
    
    <p>Happy adventuring!</p>
    
    <hr style="border: none; border-top: 1px solid #ddd; margin-top: 30px;" />
    <p style="color: #666; font-size: 12px;">
      This email was sent because you were added to a D&D campaign player list.
    </p>
  `;

  const emailText = `
You've been invited to join a D&D campaign!

Hello,

${ownerName} has added you as a player to ${campaignName ? `the ${campaignName} campaign` : 'their D&D campaign'}.

You can now access the player view by logging in with your Google account at:
${landingPageUrl}

Once you're in, you'll be able to:
- View the campaign map during sessions
- See your character information
- Watch real-time updates from the GM

If you have any questions, contact ${ownerName} directly.

Happy adventuring!
`;

  try {
    await emailTransporter.sendMail({
      from: process.env.GMAIL_USER,
      to: playerEmail,
      subject: `You've been invited to a D&D campaign${campaignName ? `: ${campaignName}` : ''}!`,
      text: emailText,
      html: emailHtml
    });

    console.log(`✓ Player invite sent to ${playerEmail} for share key ${shareKey}`);
    return { success: true };
  } catch (err) {
    console.error(`Error sending email to ${playerEmail}:`, err);
    return { success: false, error: err.message };
  }
}

export default {
  initializeEmailService,
  sendPlayerInviteEmail
};
