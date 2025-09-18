const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('Display client connected');
  
  socket.on('disconnect', () => {
    console.log('Display client disconnected');
  });
});

function sendDataToDisplay(data) {
  io.emit('data-update', data);
}

const PORT = process.env.DISPLAY_PORT || 3000;
server.listen(PORT, () => {
  console.log(`Display server running on port ${PORT}`);
});

module.exports = { sendDataToDisplay };