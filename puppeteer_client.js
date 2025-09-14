const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const sttClient = require('./stt_client');
const djangoClient = require('./django_client');
const PAGE_SCRIPT = fs.readFileSync(path.join(__dirname, 'page_inject.js'), 'utf8');
module.exports = async function startBot() {
  const userDataDir = config.BOT_CHROME_PROFILE;
  console.log("Using Chrome profile:", userDataDir);
  const browser = await puppeteer.launch({
    headless: false, // headful required for getDisplayMedia reliability
    args: [
      `--user-data-dir=${userDataDir}`,
      '--use-fake-ui-for-media-stream',         // auto-allow getUserMedia/getDisplayMedia
      '--allow-http-screen-capture',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
  const page = await browser.newPage();
  // expose function for the page to call with audio chunks
  await page.exposeFunction('sendAudioChunkToNode', async (base64Chunk) => {
    try {
      // process: decode, convert, transcribe
      const transcript = await sttClient.processWebmChunk(base64Chunk, config.INTERVIEW_ID);
      if (transcript && transcript.trim().length > 0) {
        // send transcript to Django
        await djangoClient.sendTranscript(config.INTERVIEW_ID, transcript);
      }
    } catch (err) {
      console.error("Error processing chunk:", err);
    }
  });
  // navigate to Meet
  console.log("Opening Meet URL:", config.BOT_MEET_URL);
  await page.goto(config.BOT_MEET_URL, { waitUntil: 'networkidle2' });
  // Wait for page to be fully loaded (adjust selector checks as needed)
  await page.waitForTimeout(4000);
  // Inject the page side script that captures audio and streams blobs
  await page.evaluate(PAGE_SCRIPT);
  console.log("Injected capture script. Bot is now listening for audio...");
  // keep process alive
  // Note: you may want to add logic to monitor page/browser and restart on disconnect
};