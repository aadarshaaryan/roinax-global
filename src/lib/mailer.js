
import 'dotenv/config';
import { google } from 'googleapis';

// Gmail OAuth2 Configuration
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);

oAuth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN,
});

// Gmail API Client
const gmail = google.gmail({
  version: 'v1',
  auth: oAuth2Client,
});

// Validate Gmail configuration
const validateGmailConfig = () => {
  const requiredVariables = [
    'GMAIL_USER',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
  ];

  const missingVariables = requiredVariables.filter(
    (key) => !process.env[key]
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing Gmail configuration: ${missingVariables.join(', ')}`
    );
  }
};

// Create RFC 2822 email and encode it for Gmail API
const createRawEmail = ({ to, from, replyTo, subject, html }) => {
  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
    '',
    html,
  ];

  const message = messageParts.join('\r\n');

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

// Send email using Gmail REST API
export const sendMail = async ({ to, subject, html, replyTo }) => {
  validateGmailConfig();

  const raw = createRawEmail({
    to,
    from: `"ROINAX Global" <${process.env.GMAIL_USER}>`,
    replyTo,
    subject,
    html,
  });

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return response.data;
};

// Send OTP email
export const sendOtpEmail = async (
  email,
  otpCode,
  purpose = 'Verification'
) => {
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; background: #0d160f; color: #ffffff; padding: 30px; border-radius: 12px; max-width: 480px; margin: auto; border: 1px solid rgba(130, 209, 43, 0.35);">
      <h2 style="color: #82d12b; margin-top: 0; font-size: 22px;">
        ROINAX Global
      </h2>

      <p style="color: #d1ded5; font-size: 14px;">
        Your one-time security code for <strong>${purpose}</strong> is:
      </p>

      <div style="background: #142217; padding: 16px; border-radius: 8px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #82d12b; margin: 24px 0; border: 1px solid #2f7d16;">
        ${otpCode}
      </div>

      <p style="color: #7d8c82; font-size: 12px; line-height: 1.5;">
        This code expires in 10 minutes. If you did not request this,
        please disregard this email.
      </p>
    </div>
  `;

  return sendMail({
    to: email,
    subject: `ROINAX Global - ${purpose} Code`,
    html: htmlContent,
  });
};
