const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files from 'public' directory if it exists, otherwise from root directory
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
}
app.use(express.static(__dirname));

// Fallback handler to serve index.html regardless of folder structure
app.get('*', (req, res) => {
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  const rootIndex = path.join(__dirname, 'index.html');

  if (fs.existsSync(publicIndex)) {
    res.sendFile(publicIndex);
  } else if (fs.existsSync(rootIndex)) {
    res.sendFile(rootIndex);
  } else {
    res.status(404).send('index.html dosyası bulunamadı. Lütfen public/index.html dosyasını kontrol edin.');
  }
});

// Store active rooms and participants
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`[+] Yeni Bağlantı: ${socket.id}`);

  let currentRoomId = null;
  let currentUsername = null;

  socket.on('join-room', ({ roomId, username }) => {
    currentRoomId = roomId;
    currentUsername = username || `İzleyici_${socket.id.substring(0, 4)}`;

    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }

    const roomUsers = rooms.get(roomId);
    const userInfo = {
      socketId: socket.id,
      username: currentUsername,
      micOn: false,
      cameraOn: false,
      isSharingScreen: false
    };

    roomUsers.set(socket.id, userInfo);

    const existingUsers = Array.from(roomUsers.values()).filter(u => u.socketId !== socket.id);
    socket.emit('room-users', existingUsers);

    socket.to(roomId).emit('user-joined', userInfo);

    console.log(`[Room ${roomId}] ${currentUsername} (${socket.id}) odaya katıldı. Toplam: ${roomUsers.size}`);
  });

  // WebRTC Signaling
  socket.on('signal', ({ targetSocketId, signalData, type }) => {
    io.to(targetSocketId).emit('signal', {
      callerSocketId: socket.id,
      signalData,
      type
    });
  });

  socket.on('screen-share-status', ({ isSharing }) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const roomUsers = rooms.get(currentRoomId);
    const user = roomUsers.get(socket.id);
    if (user) {
      user.isSharingScreen = isSharing;
      io.to(currentRoomId).emit('screen-share-updated', {
        socketId: socket.id,
        username: currentUsername,
        isSharing
      });
    }
  });

  socket.on('media-status-update', ({ micOn, cameraOn }) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const roomUsers = rooms.get(currentRoomId);
    const user = roomUsers.get(socket.id);
    if (user) {
      user.micOn = micOn;
      user.cameraOn = cameraOn;
      socket.to(currentRoomId).emit('media-status-changed', {
        socketId: socket.id,
        micOn,
        cameraOn
      });
    }
  });

  socket.on('chat-message', ({ message }) => {
    if (!currentRoomId) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    io.to(currentRoomId).emit('chat-message', {
      senderId: socket.id,
      username: currentUsername,
      message,
      time
    });
  });

  socket.on('disconnect', () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const roomUsers = rooms.get(currentRoomId);
      roomUsers.delete(socket.id);

      if (roomUsers.size === 0) {
        rooms.delete(currentRoomId);
      } else {
        io.to(currentRoomId).emit('user-left', {
          socketId: socket.id,
          username: currentUsername
        });
      }
      console.log(`[-] [Room ${currentRoomId}] ${currentUsername} ayrıldı.`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  ======================================================
  🎬 VALINOR FILM - Birlikte Film İzleme Platformu 🎬
  ======================================================
  📍 Sunucu Yayında: Port ${PORT}
  🚀 Ekran Paylaşımı & Görüşme Hazır!
  ======================================================
  `);
});
