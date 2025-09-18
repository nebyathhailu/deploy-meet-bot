const io = require('socket.io-client');

class DisplayClient {
  constructor(serverUrl = 'http://localhost:3001') {
    this.socket = io(serverUrl);
    this.connected = false;
    
    this.socket.on('connect', () => {
      console.log('Connected to display server');
      this.connected = true;
    });
    
    this.socket.on('disconnect', () => {
      console.log('Disconnected from display server');
      this.connected = false;
    });
  }

  sendTranscript(transcriptData) {
    if (this.connected) {
      this.socket.emit('transcript-data', transcriptData);
    } else {
      console.warn('Display client not connected, skipping transcript update');
    }
  }
}

module.exports = DisplayClient;