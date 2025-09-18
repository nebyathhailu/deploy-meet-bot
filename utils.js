const { SpeechClient } = require('@google-cloud/speech');
const { spawn } = require('child_process');
const config = require('./config');
const { sendTranscript } = require('./django_client.js');

const client = new SpeechClient();

const MIN_AUDIO_DURATION = 5; 
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
  speakerHistory: []
};

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
    const request = {
      audio: { content: pcmData.toString('base64') },
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: SAMPLE_RATE,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        enableSpeakerDiarization: true,
        diarizationSpeakerCount: 2,
        model: 'latest_long',
        useEnhanced: true,
      },
      interimResults: false,
    };

    console.log('Starting transcription with diarization...');
    const [response] = await client.recognize(request);
    
    if (response.results && response.results.length > 0) {
      console.log(`Found ${response.results.length} results`);
      
      let hasSpeakerTags = false;
      response.results.forEach((result, index) => {
        if (result.alternatives && result.alternatives[0] && result.alternatives[0].words) {
          const words = result.alternatives[0].words;
          if (words.length > 0 && words[0].speakerTag) {
            hasSpeakerTags = true;
            // console.log(`Result ${index + 1}: First word has speakerTag: ${words[0].speakerTag}`);
          }
        }
      });
      
      if (hasSpeakerTags) {
        const transcriptData = processDiarizationResults(response, conversationContext);
        if (transcriptData.fullTranscript) {
          console.log('Diarized transcript:', transcriptData.fullTranscript);
          await sendTranscript(interviewId, transcriptData);
          conversationContext = transcriptData.context;
          return;
        }
      } else {
        console.log('No speaker tags found in response');
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
        
        await sendTranscript(interviewId, {
          fullTranscript: transcript,
          currentQuestion: '',
          candidateAnswer: '',
          context: conversationContext
        });
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
  
  const speakerSegments = [];

  for (const result of response.results) {
    if (!result.alternatives || result.alternatives.length === 0) continue;
    
    const alternative = result.alternatives[0];
    
    if (!alternative.words || alternative.words.length === 0) {
      fullTranscript += alternative.transcript + ' ';
      continue;
    }

    let currentSegment = null;
    
    for (const word of alternative.words) {
      if (!word.speakerTag) {
        continue; 
      
      if (!currentSegment || currentSegment.speaker !== word.speakerTag) {
        if (currentSegment) {
          speakerSegments.push(currentSegment);
        }
        currentSegment = {
          speaker: word.speakerTag,
          text: word.word,
        };
      } else {
        currentSegment.text += ' ' + word.word;
      }
    }}

    
    if (currentSegment) {
      speakerSegments.push(currentSegment);
    }
  }

  if (speakerSegments.length > 0) {
    fullTranscript = '';
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
  }

  return {
    fullTranscript: fullTranscript.trim(),
    currentQuestion: currentQuestion.trim(),
    candidateAnswer: candidateAnswer.trim(),
    context: {
      previousSpeaker: speakerSegments.length > 0 ? speakerSegments[speakerSegments.length - 1].speaker : null,
      currentTurn: speakerSegments.length > 0 ? (speakerSegments[speakerSegments.length - 1].speaker === 1 ? 'question' : 'answer') : 'question',
      currentQuestion: currentQuestion.trim(),
      candidateAnswer: candidateAnswer.trim(),
      speakerHistory: speakerSegments
    }
  };
}

async function processWebmChunk(base64Chunk, interviewId) {
  try {
    const audioBuffer = Buffer.from(base64Chunk, 'base64');
    
    if (audioBuffer.length < 1000) {
      return { fullTranscript: '', currentQuestion: '', candidateAnswer: '' };
    }
    
    const request = {
      audio: { content: audioBuffer.toString('base64') },
      config: {
        encoding: 'WEBM_OPUS', 
        sampleRateHertz: 48000,
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
        console.log("WEBM transcript:", transcript);
        
        await sendTranscript(interviewId, {
          fullTranscript: transcript,
          currentQuestion: '',
          candidateAnswer: ''
        });

        return {
          fullTranscript: transcript,
          currentQuestion: '',
          candidateAnswer: ''
        };
      }
    }
  } catch (err) {
    console.error('WEBM STT error:', err);
  }
  
  return { fullTranscript: '', currentQuestion: '', candidateAnswer: '' };
}

let interviewId = config.INTERVIEW_ID;

setInterval(() => {
  const audioDuration = totalAudioBytes / BYTES_PER_SECOND;
  console.log(`Audio buffer: ${audioDuration.toFixed(1)}s`);
  
  if (audioDuration >= MIN_AUDIO_DURATION) {
    flushAndTranscribe(interviewId);
  }
}, 5000);

process.on('SIGINT', () => {
  console.log('\nStopping transcription...');
  ffmpeg.kill('SIGINT');
  process.exit();
});

module.exports = {
  processWebmChunk,
  flushAndTranscribe
};
