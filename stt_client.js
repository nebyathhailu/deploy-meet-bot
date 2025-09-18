const { SpeechClient } = require('@google-cloud/speech');
const { spawn } = require('child_process');
const config = require('./config');
const { sendTranscript } = require('./django_client.js');

const client = new SpeechClient();

const MIN_AUDIO_DURATION = 10; 
const SAMPLE_RATE = 16000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;

let audioBuffers = [];
let totalAudioBytes = 0;

const ffmpeg = spawn('ffmpeg', [
  '-f', 'pulse',
  '-i', 'default',
  '-ar', SAMPLE_RATE.toString(),
  '-ac', '1',
  '-acodec', 'pcm_s16le', 
  '-f', 's16le',
  '-y',
  'pipe:1'
], {
  stdio: ['ignore', 'pipe', 'pipe']
});

ffmpeg.stderr.on('data', (data) => {
  // console.log('FFmpeg:', data.toString());
});

ffmpeg.stdout.on('data', (chunk) => {
  totalAudioBytes += chunk.length;
  audioBuffers.push(chunk);
  // console.log(`Audio received: ${chunk.length} bytes, total: ${totalAudioBytes} bytes`);
});

ffmpeg.on('error', (error) => {
  console.error('FFmpeg error:', error);
});

let conversationContext = {
  previousSpeaker: null,
  currentTurn: 'question',
  currentQuestion: '',
  candidateAnswer: '',
  speakerHistory: [],
  fullConversation: ''
};

let lastTranscriptSent = Date.now();
const TRANSCRIPT_INTERVAL_MS = 30000; 

async function flushAndTranscribe(interviewId) {
  const audioDuration = totalAudioBytes / BYTES_PER_SECOND;
  
  if (audioDuration < MIN_AUDIO_DURATION) {
    // console.log(`Not enough audio: ${audioDuration.toFixed(1)}s < ${MIN_AUDIO_DURATION}s`);
    return;
  }
  
  const pcmData = Buffer.concat(audioBuffers);
  // console.log(`Transcribing ${(audioDuration).toFixed(1)}s of audio (${pcmData.length} bytes)`);
  
  const keepBytes = 2 * BYTES_PER_SECOND;
  if (pcmData.length > keepBytes) {
    const recentAudio = pcmData.slice(pcmData.length - keepBytes);
    audioBuffers = [recentAudio];
    totalAudioBytes = recentAudio.length;
  } else {
    audioBuffers = [];
    totalAudioBytes = 0;
  }
  
  try {
    const diarizationConfig = {
      enableSpeakerDiarization: true,
      maxSpeakerCount: 2,
    };

    const request = {
      audio: { content: pcmData.toString('base64') },
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: SAMPLE_RATE,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        diarizationConfig: diarizationConfig,
        model: 'latest_long',
        useEnhanced: true,
      },
      interimResults: false,
    };

    console.log('Starting transcription with diarization...');
    const [response] = await client.recognize(request);

    // const wordsInfo = response.results.alternatives[0].words;
    // wordsInfo.forEach(a => console.log(` word: ${a.word}, speakerTag: ${a.speakerTag}`));

    
    if (response.results && response.results.length > 0) {
      console.log(`Found ${response.results.length} results`);
      
      const lastResult = response.results[response.results.length - 1];
      if (lastResult.alternatives && lastResult.alternatives[0] && 
          lastResult.alternatives[0].words && lastResult.alternatives[0].words.length > 0) {
        
        const words = lastResult.alternatives[0].words;
        console.log("speaker: ", words[0].speakerTag);
        
        if (words[0].speakerTag !== undefined) {
          const transcriptData = processDiarizationResults(response, conversationContext);
          if (transcriptData.fullTranscript) {
            console.log('Diarized transcript:', transcriptData.fullTranscript);
            conversationContext = transcriptData.context;
            
            checkAndSendTranscript(interviewId);
            return;
          }
        } else {
          console.log('No speaker tags found in response');
        }
      } else {
        console.log('No words with speaker tags in response');
      }
    }
  } catch (diarizationError) {
    console.error('Diarization failed:', diarizationError.message);
  }
  
  console.log('Falling back to regular transcription...');
  await transcribeWithoutDiarization(pcmData, interviewId);
}

async function transcribeWithoutDiarization(pcmData, interviewId) {
  try {
    const request = {
      audio: { content: pcmData.toString('base64') },
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: SAMPLE_RATE,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
      },
    };

    const [response] = await client.recognize(request);
    
    if (response.results && response.results.length > 0) {
      const transcript = response.results
        .map(r => r.alternatives[0]?.transcript || '')
        .join(' ')
        .trim();

      if (transcript) {
        console.log('Regular transcript:', transcript);
        
        const isQuestion = transcript.includes('?') ||  /^(what|how|why|when|where|who|can you|do you|are you|tell me|describe|explain)/i.test(transcript);
        
        const currentSpeaker = isQuestion ? 1 : (conversationContext.previousSpeaker === 1 ? 2 : 1);
        
        conversationContext = {
          ...conversationContext,
          previousSpeaker: currentSpeaker,
          currentTurn: isQuestion ? 'question' : 'answer',
          currentQuestion: isQuestion ? transcript : conversationContext.currentQuestion,
          candidateAnswer: !isQuestion ? transcript : conversationContext.candidateAnswer,
          speakerHistory: [
            ...conversationContext.speakerHistory,
            { speaker: currentSpeaker, text: transcript, timestamp: new Date().toISOString() }
          ],
          fullConversation: conversationContext.fullConversation + ` [Speaker ${currentSpeaker}]: ${transcript}`
        };
        
        checkAndSendTranscript(interviewId);
      }
    }
  } catch (error) {
    console.error('Regular transcription failed:', error.message);
  }
}

function processDiarizationResults(response, context) {
  let fullTranscript = '';
  let currentQuestion = context.currentQuestion || '';
  let candidateAnswer = context.candidateAnswer || '';
  
  const lastResult = response.results[response.results.length - 1];
  
  if (!lastResult.alternatives || !lastResult.alternatives[0]) {
    return {
      fullTranscript: '',
      currentQuestion: '',
      candidateAnswer: '',
      context: context
    };
  }
  
  const words = lastResult.alternatives[0].words || [];
  const speakerSegments = [];
  
  let currentSegment = null;
  
  for (const word of words) {
    if (!word.speakerTag) continue;
    
    if (!currentSegment || currentSegment.speaker !== word.speakerTag) {
      if (currentSegment) {
        speakerSegments.push(currentSegment);
      }
      currentSegment = {
        speaker: word.speakerTag,
        text: word.word,
        startTime: word.startTime,
        endTime: word.endTime
      };
    } else {
      currentSegment.text += ' ' + word.word;
      currentSegment.endTime = word.endTime;
    }
  }
  
  if (currentSegment) {
    speakerSegments.push(currentSegment);
  }
  
  for (const segment of speakerSegments) {
    const speakerText = segment.text.trim();
    if (speakerText) {
      fullTranscript += `[Speaker ${segment.speaker}]: ${speakerText} `;
      
      if (segment.speaker === 1) {
        currentQuestion = currentQuestion ? currentQuestion + ' ' + speakerText : speakerText;
      } else if (segment.speaker === 2) {
        candidateAnswer = candidateAnswer ? candidateAnswer + ' ' + speakerText : speakerText;
      }
    }
  }
  
  const updatedContext = {
    ...context,
    previousSpeaker: speakerSegments.length > 0 ? speakerSegments[speakerSegments.length - 1].speaker : null,
    currentTurn: speakerSegments.length > 0 ? (speakerSegments[speakerSegments.length - 1].speaker === 1 ? 'question' : 'answer') : 'question',
    currentQuestion: currentQuestion.trim(),
    candidateAnswer: candidateAnswer.trim(),
    speakerHistory: [...context.speakerHistory, ...speakerSegments],
    fullConversation: context.fullConversation + ' ' + fullTranscript
  };
  
  return {
    fullTranscript: fullTranscript.trim(),
    currentQuestion: currentQuestion.trim(),
    candidateAnswer: candidateAnswer.trim(),
    context: updatedContext
  };
}

async function processWebmChunk(base64Chunk, interviewId) {
  try {
    const audioBuffer = Buffer.from(base64Chunk, 'base64');
    
    if (audioBuffer.length < 1000) {
      return { fullTranscript: '', currentQuestion: '', candidateAnswer: '' };
    }
    
    const diarizationConfig = {
      enableSpeakerDiarization: true,
      maxSpeakerCount: 2,
    };

    const request = {
      audio: { content: audioBuffer.toString('base64') },
      config: {
        encoding: 'WEBM_OPUS', 
        sampleRateHertz: 48000,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        diarizationConfig: diarizationConfig,
        model: 'latest_long',
        useEnhanced: true,
      },
    };

    const [response] = await client.recognize(request);
    
    if (response.results && response.results.length > 0) {
      const transcriptData = processDiarizationResults(response, conversationContext);
      if (transcriptData.fullTranscript) {
        console.log("WEBM diarized transcript:", transcriptData.fullTranscript);
        
        conversationContext = transcriptData.context;
        
        checkAndSendTranscript(interviewId);

        return {
          fullTranscript: transcriptData.fullTranscript,
          currentQuestion: transcriptData.currentQuestion,
          candidateAnswer: transcriptData.candidateAnswer
        };
      }
    }
  } catch (err) {
    console.error('WEBM STT error:', err);
  }
  
  return { fullTranscript: '', currentQuestion: '', candidateAnswer: '' };
}

function checkAndSendTranscript(interviewId) {
  const now = Date.now();
  if (now - lastTranscriptSent >= TRANSCRIPT_INTERVAL_MS) {
    sendAccumulatedTranscript(interviewId);
    lastTranscriptSent = now;
  }
}

async function sendAccumulatedTranscript(interviewId) {
  if (!conversationContext.fullConversation.trim()) {
    console.log('No transcript to send');
    return;
  }

  console.log('Sending accumulated transcript...');
  
  try {
    await sendTranscript(interviewId, {
      fullTranscript: conversationContext.fullConversation,
      currentQuestion: conversationContext.currentQuestion,
      candidateAnswer: conversationContext.candidateAnswer,
      context: conversationContext
    });
    
    console.log('Transcript sent successfully');
  } catch (error) {
    console.error('Error sending transcript:', error);
  }
}

let interviewId = config.INTERVIEW_ID;

setInterval(() => {
  const audioDuration = totalAudioBytes / BYTES_PER_SECOND;
  console.log(`Audio buffer: ${audioDuration.toFixed(1)}s`);
  
  if (audioDuration >= MIN_AUDIO_DURATION) {
    flushAndTranscribe(interviewId);
  }
}, 5000);

setInterval(() => {
  sendAccumulatedTranscript(interviewId);
}, TRANSCRIPT_INTERVAL_MS);

process.on('SIGINT', () => {
  console.log('\nStopping transcription...');
  ffmpeg.kill('SIGINT');
  process.exit();
});

module.exports = {
  processWebmChunk,
  flushAndTranscribe
};