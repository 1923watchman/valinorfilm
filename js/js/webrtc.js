/**
 * VALINOR FILM - WebRTC Manager (Ultra Reliable P2P Audio/Video Engine)
 */

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
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

      if (!pc) {
        pc = this.createPeerConnection(callerSocketId);
      }

      try {
        if (signalData.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));

          if (signalData.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.socket.emit('signal', {
              targetSocketId: callerSocketId,
              signalData: { sdp: pc.localDescription },
              type
            });
          }
        } else if (signalData.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
        }
      } catch (err) {
        console.warn('WebRTC Sinyal Hatası:', err);
      }
    });
  }

  createPeerConnection(peerSocketId) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.peerConnections.set(peerSocketId, pc);

    if (this.localCamStream) {
      this.localCamStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localCamStream);
      });
    }

    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localScreenStream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', {
          targetSocketId: peerSocketId,
          signalData: { candidate: event.candidate }
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      if (this.callbacks.onRemoteTrack) {
        this.callbacks.onRemoteTrack(peerSocketId, stream, event.track);
      }
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
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.socket.emit('signal', {
        targetSocketId: peerSocketId,
        signalData: { sdp: pc.localDescription }
      });
    } catch (e) {
      console.error("Offer oluşturma hatası:", e);
    }
  }

  async toggleCameraAndMic(enableCam, enableMic) {
    this.camEnabled = enableCam;
    this.micEnabled = enableMic;

    if (!enableCam && !enableMic) {
      if (this.localCamStream) {
        this.localCamStream.getTracks().forEach(t => t.stop());
        this.localCamStream = null;
      }
      this.syncTracksWithPeers();
      return null;
    }

    try {
      const constraints = {
        video: enableCam ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 30 } } : false,
        audio: enableMic ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (this.localCamStream) {
        this.localCamStream.getTracks().forEach(t => t.stop());
      }
      
      this.localCamStream = newStream;
      this.syncTracksWithPeers();

      return this.localCamStream;
    } catch (err) {
      console.error('Kamera/Mikrofon izni alınamadı:', err);
      throw err;
    }
  }

  syncTracksWithPeers() {
    this.peerConnections.forEach((pc, peerSocketId) => {
      const senders = pc.getSenders();

      const audioTrack = this.localCamStream ? this.localCamStream.getAudioTracks()[0] : null;
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

      if (audioSender) {
        audioSender.replaceTrack(audioTrack || null);
      } else if (audioTrack) {
        pc.addTrack(audioTrack, this.localCamStream);
      }

      const videoTrack = this.localCamStream ? this.localCamStream.getVideoTracks()[0] : null;
      const videoSender = senders.find(s => s.track && s.track.kind === 'video' && !s.track.label.toLowerCase().includes('screen'));

      if (videoSender) {
        videoSender.replaceTrack(videoTrack || null);
      } else if (videoTrack) {
        pc.addTrack(videoTrack, this.localCamStream);
      }

      this.initiateOffer(peerSocketId);
    });
  }

  async startScreenShare() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always",
          displaySurface: "browser",
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      this.localScreenStream = screenStream;
      this.isSharingScreen = true;

      screenStream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      this.peerConnections.forEach((pc, peerSocketId) => {
        screenStream.getTracks().forEach(track => {
          pc.addTrack(track, screenStream);
        });
        this.initiateOffer(peerSocketId);
      });

      return screenStream;
    } catch (err) {
      console.error('Ekran paylaşımı başlatılamadı:', err);
      throw err;
    }
  }

  stopScreenShare() {
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach(track => track.stop());
      this.localScreenStream = null;
    }
    this.isSharingScreen = false;

    if (this.callbacks.onScreenShareEnded) {
      this.callbacks.onScreenShareEnded();
    }
  }

  closePeerConnection(peerSocketId) {
    const pc = this.peerConnections.get(peerSocketId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerSocketId);
    }
    if (this.callbacks.onPeerLeft) {
      this.callbacks.onPeerLeft(peerSocketId);
    }
  }
}
