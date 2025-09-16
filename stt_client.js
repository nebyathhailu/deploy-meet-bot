const fs = require('fs');
const os = require('os');
const path = require('path');
const { SpeechClient } = require('@google-cloud/speech');
const { spawn } = require('child_process');
const client = new SpeechClient();
async function webmBase64ToWavBuffer(base64) {
  const webmBuffer = Buffer.from(base64, 'base64');
  const tmpIn = path.join(os.tmpdir(), `chunk-${Date.now()}.webm`);
  const tmpOut = path.join(os.tmpdir(), `chunk-${Date.now()}.wav`);
  fs.writeFileSync(tmpIn, webmBuffer);
  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-i', tmpIn,
      '-ar', '16000',
      '-ac', '1',
      '-vn',
      '-f', 'wav',
      tmpOut
    ]);
    ff.stderr.on('data', data => {
      console.log('ffmpeg:', data.toString());
    });
    ff.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg exit ' + code));
    });
  });
  const wavBuffer = fs.readFileSync(tmpOut);
  try { fs.unlinkSync(tmpIn); } catch(e) {}
  try { fs.unlinkSync(tmpOut); } catch(e) {}
  return wavBuffer;
}
async function transcribeWavBuffer(wavBuffer) {
  const audioBytes = wavBuffer.toString('base64');
  const request = {
    audio: { content: audioBytes },
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'en-US',
      enableAutomaticPunctuation: true
    }
  };
  const [response] = await client.recognize(request);
  if (!response || !response.results) return '';
  const transcripts = response.results.map(r => r.alternatives[0].transcript).join(' ');
  return transcripts;
}
module.exports.processWebmChunk = async function (base64Chunk, interviewId) {
  try {
    const wavBuffer = await webmBase64ToWavBuffer(base64Chunk);
    const text = await transcribeWavBuffer(wavBuffer);
    return text;
  } catch (err) {
    console.error("STT error:", err);
    return '';
  }
};