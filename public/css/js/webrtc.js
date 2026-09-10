const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

class WebRTCManager {
  constructor(socket, callbacks) {
    this.socket = socket;
    this.callbacks = callbacks || {};
    this.peerConnections = new Map();
    this.localCamStream = null;
    this.localScreenStream = null;
    this.micEnabled = false;
    this.camEnabled = false;
    this.isSharingScreen = false;
    this.setupSocketListeners();
  }

  setupSocketListeners() {
    this.socket.on('signal', async ({ callerSocketId, signalData, type }) => {
      let pc = this.peerConnections.get(callerSocketId);
      if (!pc) pc = this.createPeerConnection(callerSocketId);

      if (signalData.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
        if (signalData.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.socket.emit('signal', { targetSocketId: callerSocketId, signalData: { sdp: pc.localDescription }, type });
        }
      } else if (signalData.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate)); } catch (e) {}
      }
    });
  }

  createPeerConnection(peerSocketId) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.peerConnections.set(peerSocketId, pc);

    if (this.localCamStream) {
      this.localCamStream.getTracks().forEach(track => pc.addTrack(track, this.localCamStream));
    }
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach(track => pc.addTrack(track, this.localScreenStream));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', { targetSocketId: peerSocketId, signalData: { candidate: event.candidate } });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      if (this.callbacks.onRemoteTrack) this.callbacks.onRemoteTrack(peerSocketId, stream, event.track);
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        this.closePeerConnection(peerSocketId);
      }
    };
    return pc;
  }

  async initiateOffer(peerSocketId) {
    const pc = this.createPeerConnection(peerSocketId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.socket.emit('signal', { targetSocketId: peerSocketId, signalData: { sdp: pc.localDescription } });
  }

  async toggleCameraAndMic(enableCam, enableMic) {
    this.camEnabled = enableCam;
    this.micEnabled = enableMic;

    if (!enableCam && !enableMic) {
      if (this.localCamStream) {
        this.localCamStream.getTracks().forEach(t => t.stop());
        this.localCamStream = null;
      }
      this.updatePeerTracks();
      return null;
    }

    try {
      const constraints = {
        video: enableCam ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 30 } } : false,
        audio: enableMic ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false
      };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (this.localCamStream) this.localCamStream.getTracks().forEach(t => t.stop());
      this.localCamStream = newStream;
      this.updatePeerTracks();
      return this.localCamStream;
    } catch (err) { throw err; }
  }

  async startScreenShare() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always", displaySurface: "browser", frameRate: { ideal: 60, max: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      this.localScreenStream = screenStream;
      this.isSharingScreen = true;
      screenStream.getVideoTracks()[0].onended = () => this.stopScreenShare();
      this.updatePeerTracks();
      return screenStream;
    } catch (err) { throw err; }
  }

  stopScreenShare() {
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach(track => track.stop());
      this.localScreenStream = null;
    }
    this.isSharingScreen = false;
    this.updatePeerTracks();
    if (this.callbacks.onScreenShareEnded) this.callbacks.onScreenShareEnded();
  }

  updatePeerTracks() {
    this.peerConnections.forEach((pc, peerSocketId) => {
      const senders = pc.getSenders();
      senders.forEach(sender => pc.removeTrack(sender));
      if (this.localCamStream) this.localCamStream.getTracks().forEach(track => pc.addTrack(track, this.localCamStream));
      if (this.localScreenStream) this.localScreenStream.getTracks().forEach(track => pc.addTrack(track, this.localScreenStream));
      this.initiateOffer(peerSocketId);
    });
  }

  closePeerConnection(peerSocketId) {
    const pc = this.peerConnections.get(peerSocketId);
    if (pc) { pc.close(); this.peerConnections.delete(peerSocketId); }
    if (this.callbacks.onPeerLeft) this.callbacks.onPeerLeft(peerSocketId);
  }
}
