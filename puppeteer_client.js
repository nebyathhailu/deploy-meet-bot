const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const sttClient = require('./stt_client');
const djangoClient = require('./django_client');
const PAGE_SCRIPT = fs.readFileSync(path.join(__dirname, 'page_inject.js'), 'utf8');
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  success: (msg) => console.log(`\u2705 ${msg}`),
};
module.exports = async function startBot() {
  let browser;
  let userDataDir;
  if (config.BOT_CHROME_PROFILE) {
    log.info(`Using Chrome profile: ${config.BOT_CHROME_PROFILE}`);
    userDataDir = config.BOT_CHROME_PROFILE;
  } else {
    userDataDir = path.join(os.tmpdir(), 'chrome-profile-' + Date.now());
    fs.mkdirSync(userDataDir, { recursive: true });
    log.info(`Created temporary Chrome profile: ${userDataDir}`);
  }
  browser = await puppeteer.launch({
    headless: false,
    args: [
      `--user-data-dir=${userDataDir}`,
      '--use-fake-ui-for-media-stream',
      '--allow-http-screen-capture',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--allow-file-access-from-files',
      '--use-pulseaudio',
    ]
  });
  const page = await browser.newPage();
  page.on('console', msg => log.info(`PAGE LOG: ${msg.text()}`));
  page.on('pageerror', error => log.error(`PAGE ERROR: ${error.message}`));

let conversationState = {
  fullTranscript: '',
  currentQuestion: '',
  candidateAnswer: ''
};

await page.exposeFunction('sendAudioChunkToNode', async (base64Chunk) => {
  try {
    const transcriptData = await sttClient.processWebmChunk(base64Chunk, config.INTERVIEW_ID);
    
    if (transcriptData.fullTranscript) {
      conversationState.fullTranscript += (conversationState.fullTranscript ? ' ' : '') + transcriptData.fullTranscript;
      
      if (transcriptData.currentQuestion) {
        conversationState.currentQuestion = transcriptData.currentQuestion;
        conversationState.candidateAnswer = '';
      }
      
      if (transcriptData.candidateAnswer) {
        conversationState.candidateAnswer += (conversationState.candidateAnswer ? ' ' : '') + transcriptData.candidateAnswer;
      }
      
      log.success(`TRANSCRIPTION: ${transcriptData.fullTranscript}`);
      console.log("About to send transcript to Django..."); 
      
      const response = await djangoClient.sendTranscript(
        config.INTERVIEW_ID, 
        {
          fullTranscript: conversationState.fullTranscript,
          currentQuestion: conversationState.currentQuestion,
          candidateAnswer: conversationState.candidateAnswer
        }
      );
      
      if (response) {
        console.log("Transcript sent successfully.");
      } else {
        console.warn("Failed to send transcript.");
      }
    } else {
    }
  } catch (err) {
    log.error(`Error processing chunk: ${err}`);
  }
});

  log.info(`Opening Meet URL: ${config.BOT_MEET_URL}`);
  await page.goto(config.BOT_MEET_URL, { waitUntil: 'networkidle2' });
  // await page.screenshot({ path: 'meet-debug.png' });
  // log.info("Saved screenshot to meet-debug.png");
  const cantJoinText = await page.evaluate(() => {
    return document.body.innerText.includes("You can't join this video call");
  });
  if (cantJoinText) {
    log.error("Bot cannot join the meeting. Possible reasons:");
    log.error("- Meeting restricted / expired / bot lacks permission");
    try {
      await page.waitForSelector('button[aria-label="Return to home screen"]', { timeout: 5000 });
      await page.click('button[aria-label="Return to home screen"]');
      log.info("Returned to home screen");
    } catch {
      log.warn("Could not find return button");
    }
    return;
  }
  await new Promise(resolve => setTimeout(resolve, 5000))
  try {
    log.info("Attempting to join the meeting...");
    const joinClicked = await page.evaluate(() => {
      const selectors = [
        'button[jsname="Qx7uuf"][aria-label="Join now"]',
        'button[jsname="Qx7uuf"]',
        'button[jscontroller="0626Fe"]',
        'button[data-idom-class*="QJgqC"]',
        'button[data-tooltip-enabled="true"]',
        'button[class*="UywwFc-LgbsSe"]',
        '[aria-label*="Join now"]',
        '[aria-label*="Ask to join"]',
        '[aria-label*="Join meeting"]',
        'button[data-testid*="join"]'
      ];
      for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button) {
          button.click();
          return { success: true, method: `selector: ${selector}` };
        }
      }
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const button of buttons) {
        if (button.textContent.toLowerCase().includes('join')) {
          button.click();
          return { success: true, method: 'text content' };
        }
      }
      return { success: false, method: 'none' };
    });
    if (joinClicked.success) {
      log.success(`Clicked join button using ${joinClicked.method}`);
    } else {
      throw new Error("Could not find join button");
    }
    log.success("Successfully joined the meeting");
    // await page.screenshot({ path: 'meeting-joined.png' });
    // log.info("Saved screenshot to meeting-joined.png");
  } catch (error) {
    log.error(`Error joining the meeting: ${error.message}`);
    await page.screenshot({ path: 'join-error.png' });
    log.info("Saved error screenshot to join-error.png");
    return;
  }
  await new Promise(resolve => setTimeout(resolve, 5000))
  try {
    await page.evaluate(PAGE_SCRIPT);
    log.success("Injected capture script. Bot is now listening for audio...");
  } catch (err) {
    log.error(`Failed to inject capture script: ${err.message}`);
  }
  log.info("Bot is active. Press Ctrl+C to stop.");
};