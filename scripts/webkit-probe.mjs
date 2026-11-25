import { webkit } from 'playwright';
const b = await webkit.launch();
const ctx = await b.newContext({ permissions: ['camera', 'microphone'] }).catch(() => b.newContext());
const p = await ctx.newPage();
p.on('console', m => console.log('console', m.type(), m.text()));
await p.goto('https://dixxxvhb.github.io/holler/');
const r = await p.evaluate(async () => {
  const out = { mr: typeof MediaRecorder, cap: typeof HTMLCanvasElement.prototype.captureStream, worklet: typeof AudioWorkletNode,
    mp4: typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4'), webgl: !!document.createElement('canvas').getContext('webgl') };
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    out.gum = s.getTracks().map(t => t.kind).join(',');
    const c = document.createElement('canvas'); c.width = 540; c.height = 960; const g = c.getContext('webgl', { preserveDrawingBuffer: true });
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = s; await v.play();
    let n = 0; const tick = () => { g.clearColor(Math.random(), .3, .2, 1); g.clear(g.COLOR_BUFFER_BIT); if (n++ < 200) requestAnimationFrame(tick); }; tick();
    const ac = new AudioContext(); const dest = ac.createMediaStreamDestination(); ac.createMediaStreamSource(s).connect(dest);
    const rec = new MediaRecorder(new MediaStream([c.captureStream(30).getVideoTracks()[0], dest.stream.getAudioTracks()[0]]));
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data); rec.start(500);
    await new Promise(r => setTimeout(r, 2500)); rec.stop(); await new Promise(r => rec.onstop = r);
    const blob = new Blob(chunks, { type: rec.mimeType });
    out.rec = { mime: rec.mimeType, bytes: blob.size };
    const url = URL.createObjectURL(blob); const pv = document.createElement('video'); pv.muted = true; pv.src = url;
    await new Promise((res, rej) => { pv.onloadeddata = res; pv.onerror = () => rej(new Error('play err ' + pv.error?.code)); setTimeout(res, 4000); });
    out.playback = { w: pv.videoWidth, h: pv.videoHeight, ready: pv.readyState };
  } catch (e) { out.err = String(e); }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
