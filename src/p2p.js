// Direct play: the host's browser runs the group (see room.js) and friends connect to it over WebRTC data
// channels. The PRIDA server is only used to introduce the browsers (a few small messages), so its tiny free CPU
// no longer sits between the players. Both ends return an object that looks like a WebSocket to main.js.
import { Room } from './room.js';

const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
class Link {
  constructor() {
    this.readyState = 0;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    this.direct = true;
  }
  _open() {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.onopen?.();
  }
  _message(text) {
    if (this.readyState === 1) this.onmessage?.({ data: text });
  }
  _close(reason = '', code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.cleanup?.();
    this.onclose?.({ code, reason });
  }
  close() {
    this._close('Left the group.');
  }
}
function signalURL(endpoint, code, role) {
  const url = new URL(endpoint);
  url.search = '';
  url.searchParams.set('signal', code);
  url.searchParams.set('role', role);
  return url.href;
}
// States go on the unreliable channel (a late state is useless); everything else must arrive.
const isState = (text) => text.startsWith('{"type":"state"');

// ——— Host ———
export function hostGroup({ endpoint, code, kind, params }) {
  const link = new Link(),
    room = new Room(code, kind),
    peers = new Map();
  let selfId = null,
    signal = null,
    closed = false;
  link.room = room;
  link.send = (text) => {
    if (link.readyState !== 1) return;
    try {
      room.message(selfId, JSON.parse(text));
    } catch {}
  };
  const loop = { send: (text) => queueMicrotask(() => link._message(text)) };
  const drop = (gid) => {
    const peer = peers.get(gid);
    if (!peer) return;
    peers.delete(gid);
    if (peer.member) room.leave(peer.member);
    try {
      peer.pc.close();
    } catch {}
  };
  const connectSignal = () => {
    if (closed) return;
    signal = new WebSocket(signalURL(endpoint, code, 'host'));
    signal.onmessage = async (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === 'guest-leave') {
        const peer = peers.get(m.gid);
        if (peer && !peer.member) drop(m.gid);
        return;
      }
      if (!m.from || !m.data) return;
      let peer = peers.get(m.from);
      if (!peer && m.data.sdp) {
        const pc = new RTCPeerConnection({ iceServers: ICE });
        peer = { pc, channels: {}, member: null, gid: m.from };
        peers.set(m.from, peer);
        pc.onicecandidate = (ev) => ev.candidate && signal?.readyState === 1 && signal.send(JSON.stringify({ to: m.from, data: { ice: ev.candidate } }));
        pc.onconnectionstatechange = () => ['failed', 'closed', 'disconnected'].includes(pc.connectionState) && setTimeout(() => {
          if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) drop(peer.gid);
        }, pc.connectionState === 'disconnected' ? 5000 : 0);
        pc.ondatachannel = (ev) => {
          const ch = ev.channel;
          peer.channels[ch.label] = ch;
          ch.onmessage = (msg) => {
            let data;
            try {
              data = JSON.parse(msg.data);
            } catch {
              return;
            }
            if (data.type === 'hello' && !peer.member) {
              const conn = {
                  send: (text) => {
                    const c = isState(text) && peer.channels.fast?.readyState === 'open' ? peer.channels.fast : peer.channels.rel;
                    if (c?.readyState === 'open' && c.bufferedAmount < 262144) c.send(text);
                  },
                },
                res = room.join(conn, data);
              if (res.error) {
                peer.channels.rel?.send(JSON.stringify({ type: 'refused', message: res.error }));
                setTimeout(() => drop(peer.gid), 500);
              } else peer.member = res.id;
            } else if (peer.member) room.message(peer.member, data);
          };
        };
      }
      if (!peer) return;
      try {
        if (m.data.sdp) {
          await peer.pc.setRemoteDescription(m.data.sdp);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          signal.send(JSON.stringify({ to: m.from, data: { sdp: peer.pc.localDescription } }));
        } else if (m.data.ice) await peer.pc.addIceCandidate(m.data.ice);
      } catch {}
    };
    signal.onclose = (e) => {
      if (closed) return;
      if (e.code === 4001) {
        link._close('That group code is already in use. Create the group again.');
        return;
      }
      // The introduction server went to sleep or restarted: the group keeps playing; reconnect for new joins.
      setTimeout(connectSignal, 3000);
    };
  };
  link.cleanup = () => {
    closed = true;
    try {
      signal?.close();
    } catch {}
    for (const gid of [...peers.keys()]) drop(gid);
    room.close();
  };
  setTimeout(() => {
    link._open();
    const res = room.join(loop, params);
    selfId = res.id;
    connectSignal();
  }, 0);
  return link;
}

// ——— Guest ———
export function joinGroup({ endpoint, code, params, timeout = 15000 }) {
  const link = new Link(),
    pc = new RTCPeerConnection({ iceServers: ICE }),
    rel = pc.createDataChannel('rel', { ordered: true }),
    fast = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }),
    signal = new WebSocket(signalURL(endpoint, code, 'guest'));
  let lastInput = null;
  const timer = setTimeout(
    () =>
      link._close(
        'Could not connect directly to the host (a network in between blocks it). Try again, or turn off “Direct connection” to play through the server.',
      ),
    timeout,
  );
  link.send = (text) => {
    if (link.readyState !== 1) return;
    if (text.startsWith('{"type":"input"') && fast.readyState === 'open') {
      // Inputs travel unreliably; one-shot presses are repeated in the next two packets so a lost one is harmless.
      try {
        const m = JSON.parse(text),
          i = m.input;
        for (const k of ['jump', 'interact', 'heal', 'reload']) if (lastInput?.[k] > 0) i[k] = true;
        lastInput = Object.fromEntries(['jump', 'interact', 'heal', 'reload'].map((k) => [k, i[k] ? 2 : Math.max(0, (lastInput?.[k] || 0) - 1)]));
        fast.send(JSON.stringify(m));
      } catch {}
      return;
    }
    if (rel.readyState === 'open') rel.send(text);
  };
  const receive = (e) => {
    if (typeof e.data !== 'string') return;
    if (e.data.startsWith('{"type":"refused"')) {
      try {
        link._close(JSON.parse(e.data).message);
      } catch {}
      return;
    }
    link._message(e.data);
  };
  rel.onmessage = fast.onmessage = receive;
  rel.onopen = () => {
    clearTimeout(timer);
    rel.send(JSON.stringify({ type: 'hello', ...params }));
    link._open();
    // The introduction is done; the server is no longer needed.
    setTimeout(() => signal.close(), 2000);
  };
  rel.onclose = () => link._close('The host left the group.');
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') link._close('The direct connection to the host was lost.');
  };
  pc.onicecandidate = (ev) => ev.candidate && signal.readyState === 1 && signal.send(JSON.stringify({ data: { ice: ev.candidate } }));
  signal.onmessage = async (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    try {
      if (m.type === 'joined') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signal.send(JSON.stringify({ data: { sdp: pc.localDescription } }));
      } else if (m.data?.sdp) await pc.setRemoteDescription(m.data.sdp);
      else if (m.data?.ice) await pc.addIceCandidate(m.data.ice);
    } catch {}
  };
  signal.onclose = (e) => {
    if (link.readyState === 0 && e.code === 4004) link._close('No group with that code. Check the code with your friend.');
  };
  link.cleanup = () => {
    clearTimeout(timer);
    try {
      signal.close();
    } catch {}
    try {
      pc.close();
    } catch {}
  };
  return link;
}
