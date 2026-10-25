import { useEffect, useRef, useState } from 'react';

/**
 * Keep a wall-mounted staff screen awake.
 *
 * A kitchen tablet that dims after two minutes is a board nobody can read and,
 * worse, a tab the browser throttles: timers slow down, the socket drops, and
 * the "new order" chime arrives late or not at all. The Screen Wake Lock API
 * prevents that on Chrome/Android, Edge and Safari 16.4+.
 *
 * Two things make it fiddly, both handled here:
 *  - the lock is released whenever the tab is hidden (screen off, app switch)
 *    and must be asked for again when it comes back;
 *  - older tablets have no Wake Lock at all. There, a muted, invisible video
 *    playing in a loop keeps most of them awake (the technique NoSleep.js
 *    uses). It needs a tap to start, so it starts on the first one.
 *
 * The state is reported honestly so the screen can say "may sleep" instead of
 * pretending.
 */
export type WakeState = 'active' | 'fallback' | 'unsupported' | 'off';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', fn: () => void) => void;
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

/** A 1×1 canvas stream as an endless silent video. No asset to ship. */
function startFallbackVideo(): HTMLVideoElement | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const stream = (canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream }).captureStream?.(1);
    if (!ctx || !stream) return null;
    const video = document.createElement('video');
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0;';
    video.srcObject = stream;
    document.body.appendChild(video);
    // Something has to change for the stream to count as playing.
    let tick = 0;
    const id = window.setInterval(() => { tick = 1 - tick; ctx.fillStyle = tick ? '#000' : '#010101'; ctx.fillRect(0, 0, 1, 1); }, 1000);
    video.addEventListener('emptied', () => window.clearInterval(id));
    void video.play().catch(() => { /* needs a gesture; retried on the next tap */ });
    return video;
  } catch {
    return null;
  }
}

export function useWakeLock(enabled = true): WakeState {
  const [state, setState] = useState<WakeState>('off');
  const sentinel = useRef<WakeLockSentinelLike | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') { setState('off'); return; }
    let cancelled = false;
    const nav = navigator as NavigatorWithWakeLock;

    const request = async () => {
      if (document.visibilityState !== 'visible' || cancelled) return;
      if (nav.wakeLock) {
        try {
          if (sentinel.current && !sentinel.current.released) return;
          const lock = await nav.wakeLock.request('screen');
          if (cancelled) { void lock.release(); return; }
          sentinel.current = lock;
          lock.addEventListener('release', () => { if (!cancelled) setState((s) => (s === 'active' ? 'off' : s)); });
          setState('active');
          return;
        } catch {
          // Refused (battery saver, iframe, no gesture yet): fall through.
        }
      }
      if (!video.current) video.current = startFallbackVideo();
      if (video.current) {
        void video.current.play().then(() => { if (!cancelled) setState('fallback'); }).catch(() => {
          if (!cancelled) setState('unsupported');
        });
      } else {
        setState('unsupported');
      }
    };

    void request();
    const onVisible = () => { if (document.visibilityState === 'visible') void request(); };
    // A gesture unlocks both the API (some browsers) and the video fallback.
    const onGesture = () => { void request(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('click', onGesture);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('click', onGesture);
      if (sentinel.current && !sentinel.current.released) void sentinel.current.release().catch(() => {});
      sentinel.current = null;
      if (video.current) {
        video.current.pause();
        video.current.srcObject = null;
        video.current.remove();
        video.current = null;
      }
    };
  }, [enabled]);

  return state;
}
