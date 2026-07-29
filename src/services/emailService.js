import { Resend } from 'resend';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let resendClient = null;

const getResendClient = () => {
  if (!resendClient && config.email.apiKey) {
    resendClient = new Resend(config.email.apiKey);
  }
  return resendClient;
};

export const sendEmail = async ({ to, subject, html, text }) => {
  const client = getResendClient();
  if (!client) {
    logger.warn('Resend API key not configured, email not sent', { to, subject });
    if (config.env === 'development') {
      logger.info(`[DEV EMAIL] To: ${to}, Subject: ${subject}`);
      return { id: 'dev-mode', success: true };
    }
    throw new Error('Email service not configured');
  }

  try {
    const result = await client.emails.send({
      from: config.email.from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    });

    if (result.error) {
      const message = result.error.message || JSON.stringify(result.error);
      logger.error('Resend API error:', { to, subject, error: result.error });
      throw new Error(message);
    }

    logger.info('Email sent', { to, subject, id: result.data?.id });
    return result;
  } catch (error) {
    logger.error('Email send failed:', error);
    throw error;
  }
};

export const sendOtpEmail = async (email, otp, name) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a73e8;">Corizo Desk - Login OTP</h2>
      <p>Hello ${name || 'User'},</p>
      <p>Your one-time password for login is:</p>
      <div style="background: #f1f3f4; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; font-weight: bold; border-radius: 8px;">
        ${otp}
      </div>
      <p>This OTP expires in 5 minutes. Do not share it with anyone.</p>
      <p style="color: #666; font-size: 12px;">If you didn't request this, please contact your administrator.</p>
    </div>
  `;
  return sendEmail({
    to: email,
    subject: 'Your Corizo Desk Login OTP',
    html,
    text: `Your OTP is ${otp}. It expires in 5 minutes.`,
  });
};

export const sendAccountLockedEmail = async (email, name) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #d93025;">Account Locked</h2>
      <p>Hello ${name},</p>
      <p>Your account has been locked due to multiple failed login attempts.</p>
      <p>Please contact your Super Admin to unlock your account.</p>
    </div>
  `;
  return sendEmail({
    to: email,
    subject: 'Corizo Desk - Account Locked',
    html,
    text: 'Your account has been locked. Contact Super Admin to unlock.',
  });
};

export const sendFollowUpReminderEmail = async (email, name, followUps) => {
  const list = followUps
    .map((f) => `<li>${f.name} - ${new Date(f.scheduledDate).toLocaleString()}</li>`)
    .join('');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a73e8;">Follow-up Reminder</h2>
      <p>Hello ${name},</p>
      <p>You have upcoming follow-ups:</p>
      <ul>${list}</ul>
    </div>
  `;
  return sendEmail({
    to: email,
    subject: 'Corizo Desk - Follow-up Reminder',
    html,
    text: `You have ${followUps.length} upcoming follow-ups.`,
  });
};

export const sendLeadAssignedEmail = async (email, name, lead) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a73e8;">New Lead Assigned</h2>
      <p>Hello ${name},</p>
      <p>A new lead has been assigned to you:</p>
      <p><strong>${lead.leadId}</strong> - ${lead.name}</p>
      <p>Priority: ${lead.priority} | Status: ${lead.status}</p>
    </div>
  `;
  return sendEmail({
    to: email,
    subject: `Lead Assigned: ${lead.leadId}`,
    html,
    text: `Lead ${lead.leadId} assigned to you.`,
  });
};

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  employee: 'Employee',
};

export const sendAccountCreatedEmail = async ({
  email,
  name,
  role,
  departmentName,
  loginUrl,
  passwordMode = 'first_login',
  temporaryPassword,
}) => {
  let passwordInstructions = '';
  if (passwordMode === 'first_login') {
    passwordInstructions = `
      <p><strong>Getting started:</strong></p>
      <ol>
        <li>Visit the login page and sign in with your email using OTP verification.</li>
        <li>You will be prompted to create a secure password before accessing the dashboard.</li>
      </ol>
    `;
  } else if (passwordMode === 'hybrid') {
    passwordInstructions = `
      <p><strong>Getting started:</strong></p>
      <ol>
        <li>Visit the login page: <a href="${loginUrl}">${loginUrl}</a></li>
        <li>Sign in with your email using OTP verification.</li>
        <li>A temporary password has been set for your account. You must change it on first login.</li>
      </ol>
      <p style="color:#666;font-size:12px;">For security, your temporary password was shared separately by your administrator.</p>
    `;
  } else {
    passwordInstructions = `
      <p><strong>Getting started:</strong></p>
      <ol>
        <li>Visit the login page: <a href="${loginUrl}">${loginUrl}</a></li>
        <li>Sign in with your email using OTP verification.</li>
        <li>Use the password provided by your administrator when prompted.</li>
      </ol>
    `;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background: #F5BB04; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #3B3F42; margin: 0; font-size: 24px;">Welcome to Corizo Desk</h1>
      </div>
      <div style="padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Hello <strong>${name}</strong>,</p>
        <p>Your account has been created successfully. Here are your account details:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Role</td><td style="padding: 8px 0;"><strong>${ROLE_LABELS[role] || role}</strong></td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Department</td><td style="padding: 8px 0;"><strong>${departmentName || '—'}</strong></td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Email</td><td style="padding: 8px 0;"><strong>${email}</strong></td></tr>
        </table>
        ${passwordInstructions}
        <p style="margin-top: 24px;">
          <a href="${loginUrl}" style="background: #F5BB04; color: #3B3F42; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Login to Corizo Desk
          </a>
        </p>
        <p style="color: #666; font-size: 12px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
          If you did not expect this email, please contact your administrator immediately.
        </p>
      </div>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: 'Welcome to Corizo Desk — Your Account Has Been Created',
    html,
    text: `Hello ${name}, your Corizo Desk account has been created. Role: ${ROLE_LABELS[role]}. Department: ${departmentName}. Login: ${loginUrl}`,
  });
};
