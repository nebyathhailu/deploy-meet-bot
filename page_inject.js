(async () => {
  console.log("Page injector: starting audio capture...");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: 'default' },
      video: false
    });
    const options = { mimeType: 'audio/webm;codecs=opus' };
    const recorder = new MediaRecorder(stream, options);
    
   let lastBase64Chunk = null;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result.split(',')[1]; 

          if (base64String !== lastBase64Chunk) {
            lastBase64Chunk = base64String; 
            window.sendAudioChunkToNode(base64String); 
          }
        };
        reader.onerror = (error) => {
          console.error('Error reading blob:', error);
        };
        reader.readAsDataURL(e.data); 
      }
    };

    recorder.start(1000);
    console.log("MediaRecorder started (audio/webm;codecs=opus).");
  } catch (err) {
    console.error("getUserMedia failed:", err);
  }
})();