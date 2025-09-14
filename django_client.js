const axios = require('axios');
const config = require('./config');
module.exports.sendTranscript = async (interviewId, transcriptText) => {
  try {
    const payload = {
      interview_id: interviewId,
      transcript_text: transcriptText
    };
    const res = await axios.post(config.DJANGO_API_URL, payload, { timeout: 10000 });
    if (res.status >= 200 && res.status < 300) {
      console.log("Transcript delivered:", transcriptText.slice(0,80));
      return res.data;
    } else {
      console.warn("Non-OK from Django:", res.status, res.data);
      return null;
    }
  } catch (err) {
    console.error("Error sending transcript to Django:", err.message);
    return null;
  }
};











