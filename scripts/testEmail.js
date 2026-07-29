import dotenv from 'dotenv';
dotenv.config();
import { Resend } from 'resend';

const client = new Resend(process.env.RESEND_API_KEY);
const result = await client.emails.send({
  from: process.env.EMAIL_FROM,
  to: ['abbashaider14@proton.me'],
  subject: 'Corizo Desk - Test OTP',
  html: '<p>Test email from Corizo Desk</p>',
});

console.log(JSON.stringify(result, null, 2));
