const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms and participants
// roomId -> Map(socketId -> { username, micOn, cameraOn, isSharingScreen })
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

    // Send existing users list to the newly joined user
    const existingUsers = Array.from(roomUsers.values()).filter(u => u.socketId !== socket.id);
    socket.emit('room-users', existingUsers);

    // Notify others in room that a user joined
    socket.to(roomId).emit('user-joined', userInfo);

    console.log(`[Room ${roomId}] ${currentUsername} (${socket.id}) odaya katıldı. Toplam: ${roomUsers.size}`);
  });

  // WebRTC Signaling
  socket.on('signal', ({ targetSocketId, signalData, type }) => {
    io.to(targetSocketId).emit('signal', {
      callerSocketId: socket.id,
      signalData,
      type // 'screen' or 'cam'
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
  📍 Sunucu Yayında: http://localhost:${PORT}
  🚀 Ekran Paylaşımı & Görüşme Hazır!
  ======================================================
  `);
});
