require('dotenv').config();

module.exports = {
  DJANGO_API_URL: process.env.DJANGO_API_URL,
  GCP_CRED: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  BOT_CHROME_PROFILE: process.env.BOT_CHROME_PROFILE, 
  BOT_EMAIL: process.env.BOT_EMAIL,                   
  BOT_PASSWORD: process.env.BOT_PASSWORD,             
  BOT_MEET_URL: process.env.BOT_GOOGLE_MEET_URL,
  INTERVIEW_ID: process.env.INTERVIEW_ID || null,
  MEDIA_CHUNK_MS: Number(process.env.MEDIA_CHUNK_MS || 1000)
};