// Real peer-to-peer voice over WebRTC. The game server only relays
// signaling (SDP offers/answers and ICE candidates); audio flows directly
// between browsers. Configure TURN on the server for restrictive networks.
export class Voice extends EventTarget {
  constructor(net, getIceServers, getMyId) {
    super();
    this.getMyId = getMyId;
    this.net = net;
    this.getIceServers = getIceServers;
    this.peers = new Map(); // id -> { pc, audio, analyser, state }
    this.stream = null;
    this.active = false;
    this.muted = false;
    this.joining = false;
    this.error = null;
    this.speaking = new Set();
    this.ctx = null;
    this.localAnalyser = null;

    net.addEventListener('voice_peers', (e) => e.detail.peers.forEach((id) => this.callPeer(id)));
    net.addEventListener('signal', (e) => this.onSignal(e.detail.from, e.detail.data));
    net.addEventListener('voice_left', (e) => this.dropPeer(e.detail.id));
    net.addEventListener('status', (e) => {
      if (e.detail === 'online' && this.active) {
        // Re-announce after reconnecting; peers are rebuilt from scratch.
        [...this.peers.keys()].forEach((id) => this.dropPeer(id));
        this.net.send({ t: 'voice_join', muted: this.muted });
      }
    });
    this.meterTimer = setInterval(() => this.meter(), 120);
  }

  changed() { this.dispatchEvent(new Event('change')); }

  get supported() {
    return Boolean(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);
  }

  async join() {
    if (this.active || this.joining) return;
    this.error = null;
    if (!window.isSecureContext) {
      this.error = 'Voice needs a secure page (https:// or localhost). Open the game over HTTPS to talk.';
      return this.changed();
    }
    if (!this.supported) {
      this.error = 'This browser does not support WebRTC voice.';
      return this.changed();
    }
    this.joining = true; this.changed();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (err) {
      this.joining = false;
      this.error = err.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser\'s site settings and try again.'
        : err.name === 'NotFoundError' ? 'No microphone was found on this device.'
        : `Could not open the microphone (${err.name}).`;
      return this.changed();
    }
    this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    this.localAnalyser = this.analyse(this.stream);
    this.active = true; this.joining = false;
    this.applyMute();
    this.net.send({ t: 'voice_join', muted: this.muted });
    this.changed();
  }

  leave() {
    if (!this.active) return;
    this.active = false;
    [...this.peers.keys()].forEach((id) => this.dropPeer(id));
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null; this.localAnalyser = null;
    this.speaking.clear();
    this.net.send({ t: 'voice_leave' });
    this.changed();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyMute();
    if (this.active) this.net.send({ t: 'voice_mute', muted: this.muted });
    this.changed();
  }

  applyMute() { this.stream?.getAudioTracks().forEach((t) => { t.enabled = !this.muted; }); }

  makePeer(id) {
    const pc = new RTCPeerConnection({ iceServers: this.getIceServers() });
    const peer = { pc, audio: null, analyser: null, state: 'connecting' };
    this.peers.set(id, peer);
    this.stream?.getTracks().forEach((t) => pc.addTrack(t, this.stream));
    pc.onicecandidate = (e) => { if (e.candidate) this.net.send({ t: 'signal', to: id, data: { candidate: e.candidate } }); };
    pc.ontrack = (e) => {
      if (!peer.audio) {
        peer.audio = new Audio();
        peer.audio.autoplay = true;
        peer.audio.playsInline = true;
        document.body.appendChild(peer.audio);
      }
      peer.audio.srcObject = e.streams[0];
      peer.audio.play().catch(() => { this.error = 'Tap anywhere to enable incoming audio.'; this.changed(); document.addEventListener('click', () => { peer.audio?.play(); this.error = null; this.changed(); }, { once: true }); });
      peer.analyser = this.analyse(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === 'failed') {
        this.error = 'Voice could not connect peer-to-peer on this network. The server needs a TURN relay (set TURN_URL) for strict NATs.';
      } else if (pc.connectionState === 'connected') this.error = null;
      this.changed();
    };
    return peer;
  }

  async callPeer(id) {
    if (!this.active) return;
    this.dropPeer(id);
    const { pc } = this.makePeer(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.net.send({ t: 'signal', to: id, data: { sdp: pc.localDescription } });
    this.changed();
  }

  async onSignal(from, data) {
    if (!this.active) return;
    try {
      if (data.sdp) {
        if (data.sdp.type === 'offer') {
          const existing = this.peers.get(from);
          // Glare (both sides offered at once): the lower id keeps its own offer.
          if (existing && existing.pc.signalingState === 'have-local-offer' && this.getMyId() < from) return;
          this.dropPeer(from);
          const { pc } = this.makePeer(from);
          await pc.setRemoteDescription(data.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.net.send({ t: 'signal', to: from, data: { sdp: pc.localDescription } });
          this.changed();
        } else {
          await this.peers.get(from)?.pc.setRemoteDescription(data.sdp);
        }
      } else if (data.candidate) {
        await this.peers.get(from)?.pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (err) {
      console.warn('voice signal error', err);
    }
  }

  dropPeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch {}
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    this.peers.delete(id);
    this.speaking.delete(id);
    this.changed();
  }

  analyse(stream) {
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      return { an, buf: new Uint8Array(an.fftSize) };
    } catch { return null; }
  }

  level(a) {
    if (!a) return 0;
    a.an.getByteTimeDomainData(a.buf);
    let sum = 0;
    for (const v of a.buf) { const d = (v - 128) / 128; sum += d * d; }
    return Math.sqrt(sum / a.buf.length);
  }

  meter() {
    if (!this.active) return;
    const next = new Set();
    if (!this.muted && this.level(this.localAnalyser) > 0.04) next.add('me');
    for (const [id, p] of this.peers) if (this.level(p.analyser) > 0.03) next.add(id);
    const changed = next.size !== this.speaking.size || [...next].some((x) => !this.speaking.has(x));
    this.speaking = next;
    if (changed) this.dispatchEvent(new Event('speaking'));
  }

  peerState(id) { return this.peers.get(id)?.state || null; }
}
