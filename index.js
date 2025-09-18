const startBot = require('./puppeteer_client');
const sttClient = require('./stt_client');

let botInstance;

(async () => {
  try {
    botInstance = await startBot();
  } catch (err) {
    console.error("Fatal bot error:", err);
    process.exit(1);
  }
})();

process.on('SIGINT', async () => {
  console.log('[INFO] Received SIGINT, shutting down...');
  
  if (typeof sttClient.shutdownTranscription === 'function') {
    sttClient.shutdownTranscription();
  }

  if (botInstance && botInstance.stop) {
    await botInstance.stop();
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[INFO] Received SIGTERM, shutting down...');
  if (botInstance && botInstance.stop) {
    await botInstance.stop();
  }
  process.exit(0);
});