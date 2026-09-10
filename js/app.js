document.addEventListener('DOMContentLoaded', () => {
  let socket;
  try {
    socket = typeof io !== 'undefined' ? io() : null;
  } catch (err) {
    console.error("Socket.IO yüklenirken hata:", err);
  }

  let currentRoomId = null;
  let currentUsername = null;
  let micOn = false;
  let cameraOn = false;
  let isSharingScreen = false;

  const lobbyView = document.getElementById('lobby-view');
  const roomView = document.getElementById('room-view');
  const inputUsername = document.getElementById('input-username');
  const inputRoomId = document.getElementById('input-room-id');
  const btnCreateRoom = document.getElementById('btn-create-room');
  const btnJoinRoom = document.getElementById('btn-join-room');

  const roomHeaderBadge = document.getElementById('room-header-badge');
  const headerRoomId = document.getElementById('header-room-id');
  const btnCopyLink = document.getElementById('btn-copy-link');
  const userBadge = document.getElementById('user-badge');
  const userBadgeName = document.getElementById('user-badge-name');
  const statusLiveBadge = document.getElementById('status-live-badge');

  const screenVideo = document.getElementById('screen-video');
  const screenPlaceholder = document.getElementById('screen-placeholder');
  const placeholderBtnShare = document.getElementById('placeholder-btn-share');
  const videoOverlayHeader = document.getElementById('video-overlay-header');
  const screenSharerName = document.getElementById('screen-sharer-name');
  const webcamGrid = document.getElementById('webcam-grid');

  const btnToggleMic = document.getElementById('btn-toggle-mic');
  const btnToggleCam = document.getElementById('btn-toggle-cam');
  const btnToggleScreen = document.getElementById('btn-toggle-screen');
  const btnScreenText = document.getElementById('btn-screen-text');
  const btnFullscreen = document.getElementById('btn-fullscreen');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const unreadChatDot = document.getElementById('unread-chat-dot');

  const volumeControlWrapper = document.getElementById('volume-control-wrapper');
  const btnMuteVolume = document.getElementById('btn-mute-volume');
  const volumeSlider = document.getElementById('volume-slider');

  const sidebar = document.getElementById('sidebar');
  const tabBtnChat = document.getElementById('tab-btn-chat');
  const tabBtnUsers = document.getElementById('tab-btn-users');
  const tabContentChat = document.getElementById('tab-content-chat');
  const tabContentUsers = document.getElementById('tab-content-users');
  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const usersList = document.getElementById('users-list');
  const userCount = document.getElementById('user-count');

  const roomUsersMap = new Map();

  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam && inputRoomId) {
    inputRoomId.value = roomParam.trim().toLowerCase();
  }

  const savedName = localStorage.getItem('valinor_username');
  if (savedName && inputUsername) {
    inputUsername.value = savedName;
  }

  let webrtc = null;
  if (socket && typeof WebRTCManager !== 'undefined') {
    webrtc = new WebRTCManager(socket, {
      onRemoteTrack: (peerSocketId, stream, track) => {
        if (track.kind === 'video') {
          const isScreen = track.label.toLowerCase().includes('screen') || track.label.toLowerCase().includes('display') || stream.getVideoTracks().some(t => t.label.toLowerCase().includes('screen'));
          if (isScreen) showScreenStream(stream, peerSocketId);
          else addOrUpdateWebcam(peerSocketId, stream);
        } else if (track.kind === 'audio') {
          attachAudioTrack(peerSocketId, stream);
        }
      },
      onScreenShareEnded: () => {
        isSharingScreen = false;
        updateScreenShareButton();
        if (socket) socket.emit('screen-share-status', { isSharing: false });
        hideScreenStream();
      },
      onPeerLeft: (peerSocketId) => removeWebcam(peerSocketId)
    });
  }

  function generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = 'valinor-';
    for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
  }

  function joinRoom(roomId, username) {
    username = (username || '').trim();
    if (!username) {
      username = 'İzleyici_' + Math.floor(Math.random() * 900 + 100);
    }

    roomId = (roomId || '').trim().toLowerCase();
    if (!roomId) {
      roomId = generateRoomId();
    }

    currentRoomId = roomId;
    currentUsername = username;
    localStorage.setItem('valinor_username', currentUsername);

    if (headerRoomId) headerRoomId.textContent = currentRoomId;
    if (userBadgeName) userBadgeName.textContent = currentUsername;

    if (roomHeaderBadge) roomHeaderBadge.classList.remove('hidden');
    if (userBadge) userBadge.classList.remove('hidden');

    if (lobbyView) lobbyView.classList.add('hidden');
    if (roomView) roomView.classList.remove('hidden');

    window.history.pushState({}, '', `?room=${currentRoomId}`);

    if (socket) {
      socket.emit('join-room', { roomId: currentRoomId, username: currentUsername });
    }
  }

  if (btnCreateRoom) {
    btnCreateRoom.addEventListener('click', (e) => {
      e.preventDefault();
      const rId = inputRoomId ? inputRoomId.value : '';
      const uName = inputUsername ? inputUsername.value : '';
      joinRoom(rId || generateRoomId(), uName);
    });
  }

  if (btnJoinRoom) {
    btnJoinRoom.addEventListener('click', (e) => {
      e.preventDefault();
      const rId = inputRoomId ? inputRoomId.value : '';
      const uName = inputUsername ? inputUsername.value : '';
      joinRoom(rId, uName);
    });
  }

  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', () => {
      navigator.clipboard.writeText(`${window.location.origin}?room=${currentRoomId}`).then(() => {
        const orig = btnCopyLink.innerHTML;
        btnCopyLink.innerHTML = `<i data-lucide="check" class="w-4 h-4 text-emerald-400"></i>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        setTimeout(() => { 
          btnCopyLink.innerHTML = orig; 
          if (typeof lucide !== 'undefined') lucide.createIcons(); 
        }, 2000);
      });
    });
  }

  if (btnToggleMic) {
    btnToggleMic.addEventListener('click', async () => {
      micOn = !micOn;
      updateMicButtonState();
      try {
        if (webrtc) await webrtc.toggleCameraAndMic(cameraOn, micOn);
        updateSelfWebcam();
        if (socket) socket.emit('media-status-update', { micOn, cameraOn });
      } catch (e) { micOn = false; updateMicButtonState(); }
    });
  }

  function updateMicButtonState() {
    if (!btnToggleMic) return;
    btnToggleMic.className = micOn ? 'flex items-center justify-center w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/40 transition' : 'flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 transition';
    btnToggleMic.innerHTML = `<i data-lucide="${micOn ? 'mic' : 'mic-off'}" class="w-5 h-5"></i>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  if (btnToggleCam) {
    btnToggleCam.addEventListener('click', async () => {
      cameraOn = !cameraOn;
      updateCamButtonState();
      try {
        if (webrtc) await webrtc.toggleCameraAndMic(cameraOn, micOn);
        updateSelfWebcam();
        if (socket) socket.emit('media-status-update', { micOn, cameraOn });
      } catch (e) { cameraOn = false; updateCamButtonState(); }
    });
  }

  function updateCamButtonState() {
    if (!btnToggleCam) return;
    btnToggleCam.className = cameraOn ? 'flex items-center justify-center w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-500/40 transition' : 'flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 transition';
    btnToggleCam.innerHTML = `<i data-lucide="${cameraOn ? 'video' : 'video-off'}" class="w-5 h-5"></i>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  const handleStartScreenShare = async () => {
    if (!isSharingScreen) {
      try {
        if (webrtc) {
          const stream = await webrtc.startScreenShare();
          isSharingScreen = true;
          updateScreenShareButton();
          showScreenStream(stream, socket ? socket.id : 'me', currentUsername);
          if (socket) socket.emit('screen-share-status', { isSharing: true });
        }
      } catch (err) {}
    } else { if (webrtc) webrtc.stopScreenShare(); }
  };

  if (btnToggleScreen) btnToggleScreen.addEventListener('click', handleStartScreenShare);
  if (placeholderBtnShare) placeholderBtnShare.addEventListener('click', handleStartScreenShare);

  function updateScreenShareButton() {
    if (btnToggleScreen) {
      btnToggleScreen.className = isSharingScreen ? 'flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white font-bold px-4 py-2 rounded-xl shadow-lg shadow-rose-600/20 transition active:scale-95 text-xs sm:text-sm' : 'flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-lg shadow-amber-500/20 transition active:scale-95 text-xs sm:text-sm';
    }
    if (btnScreenText) btnScreenText.textContent = isSharingScreen ? 'Paylaşımı Durdur' : 'Ekran Paylaş';
    if (statusLiveBadge) statusLiveBadge.classList.toggle('hidden', !isSharingScreen);
  }

  function showScreenStream(stream, sharerId, sharerName = 'Yayıncı') {
    if (screenPlaceholder) screenPlaceholder.classList.add('hidden');
    if (screenVideo) {
      screenVideo.classList.remove('hidden');
      screenVideo.srcObject = stream;
    }
    if (videoOverlayHeader) videoOverlayHeader.classList.remove('hidden');
    if (volumeControlWrapper) volumeControlWrapper.classList.remove('hidden');
    const user = roomUsersMap.get(sharerId);
    if (screenSharerName) screenSharerName.textContent = user ? user.username : sharerName;
  }

  function hideScreenStream() {
    if (screenVideo) {
      screenVideo.pause();
      screenVideo.srcObject = null;
      screenVideo.classList.add('hidden');
    }
    if (screenPlaceholder) screenPlaceholder.classList.remove('hidden');
    if (videoOverlayHeader) videoOverlayHeader.classList.add('hidden');
    if (volumeControlWrapper) volumeControlWrapper.classList.add('hidden');
    if (statusLiveBadge) statusLiveBadge.classList.add('hidden');
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      if (screenVideo) screenVideo.volume = e.target.value;
    });
  }

  if (btnMuteVolume) {
    btnMuteVolume.addEventListener('click', () => {
      if (!screenVideo) return;
      screenVideo.volume = screenVideo.volume > 0 ? 0 : 1;
      if (volumeSlider) volumeSlider.value = screenVideo.volume;
      btnMuteVolume.innerHTML = `<i data-lucide="${screenVideo.volume > 0 ? 'volume-2' : 'volume-x'}" class="w-4 h-4"></i>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    });
  }

  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      const cinemaContainer = document.getElementById('cinema-container');
      if (cinemaContainer) {
        if (!document.fullscreenElement) cinemaContainer.requestFullscreen();
        else document.exitFullscreen();
      }
    });
  }

  function updateSelfWebcam() {
    const myId = socket ? socket.id : 'me';
    if (!cameraOn && !micOn) { removeWebcam(myId); return; }
    let card = document.getElementById(`webcam-card-${myId}`);
    if (!card && webcamGrid) {
      card = document.createElement('div');
      card.id = `webcam-card-${myId}`;
      card.className = 'webcam-card valinor-glow-purple';
      card.innerHTML = `<video id="webcam-video-${myId}" autoplay playsinline muted></video><div class="user-label"><span class="truncate font-semibold text-amber-300">Sen (${currentUsername})</span><div class="flex items-center gap-1"><i id="mic-status-${myId}" data-lucide="${micOn ? 'mic' : 'mic-off'}" class="w-3 h-3 ${micOn ? 'text-emerald-400' : 'text-rose-400'}"></i></div></div>`;
      webcamGrid.appendChild(card);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    const videoElem = document.getElementById(`webcam-video-${myId}`);
    if (videoElem) {
      if (webrtc && webrtc.localCamStream && cameraOn) videoElem.srcObject = webrtc.localCamStream;
      else videoElem.srcObject = null;
    }
  }

  function addOrUpdateWebcam(peerSocketId, stream) {
    let card = document.getElementById(`webcam-card-${peerSocketId}`);
    const user = roomUsersMap.get(peerSocketId);
    if (!card && webcamGrid) {
      card = document.createElement('div');
      card.id = `webcam-card-${peerSocketId}`;
      card.className = 'webcam-card';
      card.innerHTML = `<video id="webcam-video-${peerSocketId}" autoplay playsinline></video><div class="user-label"><span class="truncate">${user ? user.username : 'Katılımcı'}</span><div class="flex items-center gap-1"><i id="mic-status-${peerSocketId}" data-lucide="mic-off" class="w-3 h-3 text-rose-400"></i></div></div>`;
      webcamGrid.appendChild(card);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    const elem = document.getElementById(`webcam-video-${peerSocketId}`);
    if (elem) elem.srcObject = stream;
  }

  function attachAudioTrack(peerSocketId, stream) {
    let audioElem = document.getElementById(`audio-elem-${peerSocketId}`);
    if (!audioElem) {
      audioElem = document.createElement('audio');
      audioElem.id = `audio-elem-${peerSocketId}`;
      audioElem.autoplay = true;
      document.body.appendChild(audioElem);
    }
    audioElem.srcObject = stream;
  }

  function removeWebcam(peerSocketId) {
    const card = document.getElementById(`webcam-card-${peerSocketId}`);
    if (card) card.remove();
    const audioElem = document.getElementById(`audio-elem-${peerSocketId}`);
    if (audioElem) audioElem.remove();
  }

  if (socket) {
    socket.on('room-users', (users) => {
      roomUsersMap.clear();
      users.forEach(u => { 
        roomUsersMap.set(u.socketId, u); 
        if (webrtc) webrtc.initiateOffer(u.socketId); 
      });
      roomUsersMap.set(socket.id, { socketId: socket.id, username: currentUsername, micOn, cameraOn, isSharingScreen });
      renderUsersList();
    });

    socket.on('user-joined', (userInfo) => {
      roomUsersMap.set(userInfo.socketId, userInfo);
      renderUsersList();
      addSystemMessage(`👋 <strong>${userInfo.username}</strong> sinema odasına katıldı.`);
    });

    socket.on('user-left', ({ socketId, username }) => {
      roomUsersMap.delete(socketId);
      if (webrtc) webrtc.closePeerConnection(socketId);
      renderUsersList();
      addSystemMessage(`🚪 <strong>${username}</strong> odadan ayrıldı.`);
    });

    socket.on('screen-share-updated', ({ socketId, username, isSharing }) => {
      if (socketId !== socket.id) {
        if (isSharing) addSystemMessage(`🎬 <strong>${username}</strong> ekran paylaşımını başlattı!`);
        else { addSystemMessage(`🔴 <strong>${username}</strong> ekran paylaşımını sonlandırdı.`); hideScreenStream(); }
      }
    });

    socket.on('media-status-changed', ({ socketId, micOn: pMic, cameraOn: pCam }) => {
      const user = roomUsersMap.get(socketId);
      if (user) {
        user.micOn = pMic; user.cameraOn = pCam;
        const micIcon = document.getElementById(`mic-status-${socketId}`);
        if (micIcon) { 
          micIcon.setAttribute('data-lucide', pMic ? 'mic' : 'mic-off'); 
          micIcon.className = `w-3 h-3 ${pMic ? 'text-emerald-400' : 'text-rose-400'}`; 
          if (typeof lucide !== 'undefined') lucide.createIcons(); 
        }
        renderUsersList();
      }
    });

    socket.on('chat-message', (data) => addChatMessage(data));
  }

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!chatInput) return;
      const msg = chatInput.value.trim();
      if (!msg) return;
      if (socket) socket.emit('chat-message', { message: msg });
      chatInput.value = '';
    });
  }

  document.querySelectorAll('.btn-emoji').forEach(btn => {
    btn.addEventListener('click', () => {
      if (chatInput) {
        chatInput.value += btn.textContent;
        chatInput.focus();
      }
    });
  });

  function addChatMessage({ senderId, username, message, time }) {
    if (!chatMessages) return;
    const isMe = socket ? (senderId === socket.id) : false;
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'}`;
    msgDiv.innerHTML = `<div class="flex items-center gap-1.5 mb-1 text-[10px] text-slate-400"><span class="font-bold ${isMe ? 'text-amber-400' : 'text-purple-400'}">${isMe ? 'Sen' : username}</span><span>•</span><span>${time}</span></div><div class="${isMe ? 'chat-bubble-me text-purple-100' : 'chat-bubble-other text-slate-200'} px-3 py-2 text-xs max-w-[85%] break-words">${escapeHTML(message)}</div>`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    if (sidebar && unreadChatDot && (sidebar.classList.contains('hidden') || (tabContentChat && tabContentChat.classList.contains('hidden')))) {
      unreadChatDot.classList.remove('hidden');
    }
  }

  function addSystemMessage(htmlContent) {
    if (!chatMessages) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'bg-slate-900/60 border border-slate-800 rounded-xl p-2.5 text-[11px] text-slate-300 leading-relaxed text-center';
    msgDiv.innerHTML = htmlContent;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function renderUsersList() {
    if (!usersList) return;
    usersList.innerHTML = '';
    if (userCount) userCount.textContent = roomUsersMap.size;
    roomUsersMap.forEach((user, sId) => {
      const isMe = socket ? (sId === socket.id) : false;
      const userCard = document.createElement('div');
      userCard.className = 'flex items-center justify-between bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl text-xs';
      userCard.innerHTML = `<div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg ${isMe ? 'bg-amber-500/20 text-amber-400' : 'bg-purple-500/20 text-purple-400'} flex items-center justify-center font-bold text-xs">${user.username.charAt(0).toUpperCase()}</div><div><div class="font-semibold text-slate-200">${escapeHTML(user.username)} ${isMe ? '<span class="text-[10px] text-amber-400">(Sen)</span>' : ''}</div><div class="text-[10px] text-slate-400">${user.isSharingScreen ? '🎥 Ekran Paylaşıyor' : 'İzleyici'}</div></div></div><div class="flex items-center gap-2"><i data-lucide="${user.micOn ? 'mic' : 'mic-off'}" class="w-3.5 h-3.5 ${user.micOn ? 'text-emerald-400' : 'text-rose-400'}"></i><i data-lucide="${user.cameraOn ? 'video' : 'video-off'}" class="w-3.5 h-3.5 ${user.cameraOn ? 'text-cyan-400' : 'text-slate-600'}"></i></div>`;
      usersList.appendChild(userCard);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  if (tabBtnChat) {
    tabBtnChat.addEventListener('click', () => {
      tabBtnChat.className = 'flex-1 py-3 px-4 text-xs font-bold tracking-wider uppercase flex items-center justify-center gap-2 border-b-2 border-amber-400 text-amber-400 transition';
      if (tabBtnUsers) tabBtnUsers.className = 'flex-1 py-3 px-4 text-xs font-bold tracking-wider uppercase flex items-center justify-center gap-2 border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition';
      if (tabContentChat) tabContentChat.classList.remove('hidden');
      if (tabContentUsers) tabContentUsers.classList.add('hidden');
      if (unreadChatDot) unreadChatDot.classList.add('hidden');
    });
  }

  if (tabBtnUsers) {
    tabBtnUsers.addEventListener('click', () => {
      tabBtnUsers.className = 'flex-1 py-3 px-4 text-xs font-bold tracking-wider uppercase flex items-center justify-center gap-2 border-b-2 border-amber-400 text-amber-400 transition';
      if (tabBtnChat) tabBtnChat.className = 'flex-1 py-3 px-4 text-xs font-bold tracking-wider uppercase flex items-center justify-center gap-2 border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition';
      if (tabContentUsers) tabContentUsers.classList.remove('hidden');
      if (tabContentChat) tabContentChat.classList.add('hidden');
    });
  }

  if (btnToggleSidebar) {
    btnToggleSidebar.addEventListener('click', () => {
      if (sidebar) sidebar.classList.toggle('hidden');
      if (unreadChatDot) unreadChatDot.classList.add('hidden');
    });
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
  }
});
