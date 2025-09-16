const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const sttClient = require('./stt_client');
const djangoClient = require('./django_client');
const PAGE_SCRIPT = fs.readFileSync(path.join(__dirname, 'page_inject.js'), 'utf8');

module.exports = async function startBot() {
  let browser;
  let userDataDir;
  
  if (config.BOT_CHROME_PROFILE) {
    console.log("Using Chrome profile:", config.BOT_CHROME_PROFILE);
    userDataDir = config.BOT_CHROME_PROFILE;
  } else {
    userDataDir = path.join(os.tmpdir(), 'chrome-profile-' + Date.now());
    fs.mkdirSync(userDataDir, { recursive: true });
    console.log("Created temporary Chrome profile:", userDataDir);
    
    if (config.BOT_EMAIL && config.BOT_PASSWORD) {
      console.log("Setting up authenticated session...");
      
      browser = await puppeteer.launch({
        headless: false, 
        args: [
          `--user-data-dir=${userDataDir}`,
          '--use-fake-ui-for-media-stream',         
          '--allow-http-screen-capture',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--autoplay-policy=no-user-gesture-required'
        ]
      });
      
      const page = await browser.newPage();
      
      try {
        await page.goto('https://accounts.google.com/signin');
        
        await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
        await page.type('input[type="email"]', config.BOT_EMAIL);
        
        await page.evaluate(() => {
          const selectors = ['#identifierNext', 'button[aria-label="Next"]', 'button[jsname="LgbsSe"]'];
          for (const selector of selectors) {
            const button = document.querySelector(selector);
            if (button) {
              button.click();
              return true;
            }
          }
          return false;
        });
        
        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 10000 });
        await page.type('input[type="password"]', config.BOT_PASSWORD);
        
        await page.evaluate(() => {
          const selectors = ['#passwordNext', 'button[aria-label="Next"]', 'button[jsname="LgbsSe"]'];
          for (const selector of selectors) {
            const button = document.querySelector(selector);
            if (button) {
              button.click();
              return true;
            }
          }
          return false;
        });
        
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        console.log(" Logged in successfully");
        
        await page.goto('https://google.com');
        await page.waitForTimeout(3000);
        
        await browser.close();
      } catch (error) {
        console.error("Login process failed:", error.message);
        await page.screenshot({ path: 'login-error.png' });
        await browser.close();
        
        console.log("Continuing without login...");
      }
    }
  }
  
  browser = await puppeteer.launch({
    headless: false, 
    args: [
      `--user-data-dir=${userDataDir}`,
      '--use-fake-ui-for-media-stream',         
      '--allow-http-screen-capture',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
  
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  
  await page.exposeFunction('sendAudioChunkToNode', async (base64Chunk) => {
    try {
      const transcript = await sttClient.processWebmChunk(base64Chunk, config.INTERVIEW_ID);
      if (transcript && transcript.trim().length > 0) {
        console.log(`\n🎤 TRANSCRIPTION: ${transcript}\n`);
        await djangoClient.sendTranscript(config.INTERVIEW_ID, transcript);
      }
    } catch (err) {
      console.error("Error processing chunk:", err);
    }
  });

  console.log("Opening Meet URL:", config.BOT_MEET_URL);
  await page.goto(config.BOT_MEET_URL, { waitUntil: 'networkidle2' });
  
  await page.screenshot({ path: 'meet-debug.png' });
  console.log("Saved screenshot to meet-debug.png");
  
  const cantJoinText = await page.evaluate(() => {
    return document.body.innerText.includes("You can't join this video call");
  });
  
  if (cantJoinText) {
    console.error(" Bot cannot join the meeting. Possible reasons:");
    console.error("- The meeting is restricted to specific users");
    console.error("- The meeting URL is expired or invalid");
    console.error("- The bot account doesn't have permission to join");
    console.error("- The meeting hasn't started yet");
    
    try {
      await page.waitForSelector('button[aria-label="Return to home screen"]', { timeout: 5000 });
      await page.click('button[aria-label="Return to home screen"]');
      console.log("Returned to home screen");
    } catch (e) {
      console.log("Could not find return button");
    }
    
    return;
  }
  
  await new Promise(resolve => setTimeout(resolve, 5000))
  
  try {
    console.log("Attempting to join the meeting...");
    
    const joinClicked = await page.evaluate(() => {
      const selectors = [
        '[data-is-muted]', 
        '[aria-label*="Join now"]',
        '[aria-label*="Ask to join"]',
        'button[jsname*="Qx7uuf"]',
        'button[aria-label*="Join meeting"]',
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
      console.log(` Clicked join button using ${joinClicked.method}`);
    } else {
      throw new Error("Could not find join button");
    }
    
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    console.log(" Successfully joined the meeting");
    
    await page.screenshot({ path: 'meeting-joined.png' });
    console.log("Saved screenshot to meeting-joined.png");
    
  } catch (error) {
    console.error("Error joining the meeting:", error.message);
    await page.screenshot({ path: 'join-error.png' });
    console.log("Saved error screenshot to join-error.png");
    
    return;
  }
  
  await page.waitForTimeout(5000);
  
  await page.evaluate(PAGE_SCRIPT);
  console.log("Injected capture script. Bot is now listening for audio...");
  
  console.log("Bot is active. Press Ctrl+C to stop.");
};