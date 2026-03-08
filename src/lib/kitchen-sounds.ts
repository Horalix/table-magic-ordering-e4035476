// [UX] Kitchen sound alert utility using Web Audio API — no external files needed
const AudioContext = window.AudioContext || (window as any).webkitAudioContext;

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

// [PSYCH] Distinct tones for different alert types so staff can distinguish without looking
export function playOrderAlert() {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  // Two-tone chime: C5 → E5
  osc.type = 'sine';
  osc.frequency.setValueAtTime(523, ctx.currentTime);       // C5
  osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15); // E5
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.4);
}

export function playWaiterCallAlert() {
  const ctx = getAudioContext();
  // Three quick beeps
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime + i * 0.15); // A5
    gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.15);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.1);
    osc.start(ctx.currentTime + i * 0.15);
    osc.stop(ctx.currentTime + i * 0.15 + 0.1);
  }
}

export function playBillRequestAlert() {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  // Gentle descending tone: G5 → C5
  osc.type = 'sine';
  osc.frequency.setValueAtTime(784, ctx.currentTime);       // G5
  osc.frequency.setValueAtTime(523, ctx.currentTime + 0.2); // C5
  gain.gain.setValueAtTime(0.25, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.5);
}
