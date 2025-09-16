(async () => {
  console.log("Page injector: starting audio capture...");
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: false, audio: true });
    const options = { mimeType: 'audio/webm;codecs=opus' };
    const recorder = new MediaRecorder(stream, options);
    recorder.ondataavailable = async (event) => {
      if (!event.data || event.data.size === 0) return;
      const ab = await event.data.arrayBuffer();
      const base64 = arrayBufferToBase64(ab);
      if (window.sendAudioChunkToNode) {
        try {
          window.sendAudioChunkToNode(base64);
        } catch (e) {
          console.error('Error calling sendAudioChunkToNode', e);
        }
      } else {
        console.warn('sendAudioChunkToNode not available on window');
      }
    };
    recorder.start(1000);
    console.log("MediaRecorder started (audio/webm;codecs=opus).");
  } catch (err) {
    console.error("getDisplayMedia failed:", err);
  }
})();