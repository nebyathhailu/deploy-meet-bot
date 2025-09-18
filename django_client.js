// const axios = require('axios');
const config = require('./config');
const DisplayClient = require('./display-client');

const displayClient = new DisplayClient();

module.exports.sendTranscript = async (interviewId, transcriptData) => {
  try {
    // console.log("Sending transcript to Django:", { interviewId, transcriptData }); 

    // console.log("Sending to display server:", transcriptData); 
    displayClient.sendTranscript({
      transcript: transcriptData.fullTranscript,
      current_question: transcriptData.currentQuestion,
      candidate_answer: transcriptData.candidateAnswer,
      timestamp: new Date().toISOString()
    });

    const payload = {
      transcript: transcriptData.fullTranscript,
      current_question: transcriptData.currentQuestion,
      candidate_answer: transcriptData.candidateAnswer,
    };

    console.log({ payload });

    // The AbortController and signal are used to handle the timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const url = `${config.DJANGO_API_URL}${interviewId}/realtime-analysis/`;
    // const url = 'https://webhook.site/bee68b83-3888-476f-b769-ad73f4683bbd';
    

    const res = await fetch(url, {
      method: 'POST', 
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token 596c834a459bd4c72fc193e7e3e3284d99aa39f9` 
      },
      body: JSON.stringify(payload), 
      signal: controller.signal 
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      console.log("Transcript delivered to Django:", transcriptData.fullTranscript.slice(0, 80));
      return await res.json();
    } else {
      // const errorData = await res.text();
      const errorData = await res.json().catch(() => null);
      console.warn("Non-OK from Django:", res.status, errorData);
      return null;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error("Fetch request timed out.");
    } else {
      console.error("Error sending transcript to Django:", err.message);
    }
    return null;
  }
};
