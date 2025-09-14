const startBot = require('./puppeteer_client');
(async () => {
  try {
    await startBot();
  } catch (err) {
    console.error("Fatal bot error:", err);
    process.exit(1);
  }
})();