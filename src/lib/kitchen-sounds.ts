/**
 * Kitchen alert tones — Web Audio, no asset files.
 *
 * Three distinct signatures so staff can tell what happened without looking at
 * the screen: a rising two-tone for a new order, three sharp beeps for a waiter
 * call, a falling two-tone for a bill request.
 *
 * The hard part is not the sound, it is being honest about whether it can play
 * at all. Browsers suspend the audio context until a user gesture, so a
 * wall-mounted kitchen tablet that nobody has touched since boot produces
 * silence. Every consumer must therefore be able to ask `audioReady()` and show
 * the truth, and must call `unlockAudio()` from a real gesture.
 */
type WindowWithWebAudioFallback = Window & {
  webkitAudioContext?: typeof window.AudioContext;
};

/** Resolved lazily — reading it at module scope throws where `window` is absent. */
function audioContextCtor(): typeof window.AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext || (window as WindowWithWebAudioFallback).webkitAudioContext;
}

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * True when a tone would actually be heard.
 *
 * Screens use this to show "Sound off — tap to enable" instead of an unmuted
 * speaker icon over a context the browser has suspended.
 */
export function audioReady(): boolean {
  const Ctor = audioContextCtor();
  if (!Ctor) return false;
  // Not yet created is fine — the first unlock will create it running.
  if (!audioCtx) return false;
  return audioCtx.state === 'running';
}

/**
 * Resume the audio context from a user gesture.
 *
 * Must be called from a real click/tap. Returns whether audio is running
 * afterwards, so a caller can tell the user it did not work rather than
 * silently continuing.
 */
export async function unlockAudio(): Promise<boolean> {
  const ctx = getAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

/**
 * Play a tone if we can.
 *
 * Returns false when nothing was heard, so the caller can surface it. Never
 * throws: these run inside realtime callbacks where an exception is unhandled.
 */
function withContext(play: (ctx: AudioContext) => void): boolean {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'running') return false;
  try {
    play(ctx);
    return true;
  } catch {
    return false;
  }
}

/** Rising C5 → E5. New order. */
export function playOrderAlert(): boolean {
  return withContext((ctx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523, ctx.currentTime);
    osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  });
}

/** Three sharp A5 beeps. A table needs someone. */
export function playWaiterCallAlert(): boolean {
  return withContext((ctx) => {
    for (let i = 0; i < 3; i += 1) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime + i * 0.15);
      gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.1);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.1);
    }
  });
}

/** Falling G5 → C5. A table wants to pay. */
export function playBillRequestAlert(): boolean {
  return withContext((ctx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(784, ctx.currentTime);
    osc.frequency.setValueAtTime(523, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  });
}

/**
 * A short confirmation tone for the "test sound" button.
 *
 * Being able to prove audio works before service starts is the whole point of
 * the button — a mute toggle that only flips a boolean proves nothing.
 */
export function playTestTone(): boolean {
  return withContext((ctx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  });
}
