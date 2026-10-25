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
import { useCallback, useEffect, useRef, useState } from 'react';

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

/**
 * New ticket, for the kitchen board: C5–E5–G5 twice, triangle wave, louder.
 *
 * The two-note sine chime above is pleasant and disappears under an
 * extraction hood. This one is built to be heard over a busy line — a
 * triangle wave carries further than a sine at the same volume — while
 * staying a different shape from the call (three equal beeps) and the bill
 * (falling), so nobody has to look up to know which it was.
 */
export function playNewOrderAlert(): boolean {
  return withContext((ctx) => {
    const notes = [523, 659, 784, 523, 659, 784];
    notes.forEach((freq, i) => {
      const start = ctx.currentTime + i * 0.13 + (i >= 3 ? 0.18 : 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, start + 0.12);
      osc.start(start);
      osc.stop(start + 0.13);
    });
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

/**
 * Buzz the phone, where the browser allows it.
 *
 * A waiter's phone is in an apron pocket on silent far more often than it is
 * in a hand with the volume up. Vibration is the alert that actually arrives.
 * iOS Safari has no Vibration API; this is then a silent no-op, which is why
 * it is never the only signal.
 */
export function vibrate(pattern: number | number[] = [200, 100, 200]): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

/**
 * Track whether alerts can be heard, and unlock them on the first tap.
 *
 * The same contract the kitchen board has always had, shared so the waiter
 * phone and the floor monitor stop each inventing their own: one audio context
 * for the whole tab, resumed from a real gesture, and an honest `unlocked`
 * flag the screen can show as "tap to enable sound".
 *
 * `click`, not `pointerdown`: unlocking hides the "tap to enable" chip, and on
 * pointerdown that layout shift happened between press and release, so the
 * first tap on the toolbar landed on nothing (see KitchenDisplay).
 */
export function useAudioUnlock(): { unlocked: boolean; unlock: () => Promise<boolean> } {
  const [unlocked, setUnlocked] = useState(() => audioReady());

  const unlock = useCallback(async () => {
    const ok = await unlockAudio();
    setUnlocked(ok);
    return ok;
  }, []);

  useEffect(() => {
    if (audioReady()) { setUnlocked(true); return; }
    const onGesture = () => {
      void unlockAudio().then((ok) => {
        setUnlocked(ok);
        if (ok) {
          window.removeEventListener('click', onGesture);
          window.removeEventListener('keyup', onGesture);
        }
      });
    };
    window.addEventListener('click', onGesture);
    window.addEventListener('keyup', onGesture);
    return () => {
      window.removeEventListener('click', onGesture);
      window.removeEventListener('keyup', onGesture);
    };
  }, []);

  return { unlocked, unlock };
}

/** How often an unanswered call or bill request chimes again. */
export const REMINDER_MS = 75_000;

/**
 * Chime again while something is still waiting.
 *
 * One chime per new call is easy to miss over a coffee grinder, and then the
 * table waits in silence until somebody happens to look. While anything stays
 * unresolved this repeats the alert every ~75 seconds — often enough that it
 * cannot be lost for long, rare enough not to become noise people tune out.
 */
export function useReminderChime(active: boolean, play: () => void, intervalMs = REMINDER_MS) {
  const playRef = useRef(play);
  useEffect(() => { playRef.current = play; }, [play]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => playRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}
