import { useEffect, useRef } from 'react';
import type { ProctorEventType, ProctorSessionView } from '@examnexus/shared';
import { apiPost } from '../../lib/api-client';

const HEARTBEAT_MS = 60_000;
const ROTATE_CHECK_MS = 30_000;
const EVENT_THROTTLE_MS = 30_000;
const ROTATE_BEFORE_MS = 2 * 60_000;

function stableDeviceId(): string {
  const existing = sessionStorage.getItem('examnexus.proctor.device');
  if (existing) return existing;
  const generated = globalThis.crypto?.randomUUID?.() ?? `browser-${Date.now()}`;
  sessionStorage.setItem('examnexus.proctor.device', generated);
  return generated;
}

/**
 * Candidate-side advisory proctoring client. It registers a server-issued,
 * short-lived session token, rotates it before expiry, sends heartbeats and
 * emits only advisory browser signals. Nothing here disqualifies a candidate.
 */
export function useCandidateProctoring(attemptId: string | null, active: boolean): void {
  const sessionRef = useRef<{ token: string; expiresAt: number } | null>(null);

  useEffect(() => {
    if (!attemptId || !active) {
      sessionRef.current = null;
      return;
    }

    let disposed = false;
    const lastSent = new Map<ProctorEventType, number>();

    const sendEvent = async (eventType: ProctorEventType, evidence?: Record<string, unknown>) => {
      const session = sessionRef.current;
      if (!session || disposed) return;
      const last = lastSent.get(eventType) ?? 0;
      if (Date.now() - last < EVENT_THROTTLE_MS) return;
      lastSent.set(eventType, Date.now());
      try {
        await apiPost(`/advanced/proctoring/attempts/${encodeURIComponent(attemptId)}/events`, {
          eventType,
          clientTime: new Date().toISOString(),
          sessionToken: session.token,
          evidence,
        });
      } catch {
        // Advisory signals must never interrupt the examination.
      }
    };

    const register = async () => {
      try {
        const view = await apiPost<ProctorSessionView>('/advanced/proctoring/sessions', {
          attemptId,
          deviceId: stableDeviceId(),
          platform: navigator.userAgent.slice(0, 60),
          clientVersion: 'web-1',
        });
        if (!disposed && view.sessionToken && view.sessionTokenExpiresAt) {
          sessionRef.current = {
            token: view.sessionToken,
            expiresAt: Date.parse(view.sessionTokenExpiresAt),
          };
        }
      } catch {
        // Proctoring is advisory; a failed registration must not block the exam.
      }
    };
    void register();

    const onVisibility = () => {
      void sendEvent(document.hidden ? 'TAB_HIDDEN' : 'RECONNECTED', { hidden: document.hidden });
    };
    const onBlur = () => void sendEvent('WINDOW_BLUR');
    const onFullscreen = () => {
      if (!document.fullscreenElement) void sendEvent('FULLSCREEN_EXIT');
    };
    const onOffline = () => void sendEvent('DISCONNECTED');
    const onOnline = () => void sendEvent('RECONNECTED');

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    const heartbeat = window.setInterval(async () => {
      const session = sessionRef.current;
      if (!session || disposed) return;
      try {
        await apiPost(`/advanced/proctoring/sessions/${encodeURIComponent(attemptId)}/heartbeat`, {
          sessionToken: session.token,
        });
      } catch {
        // A stale token is handled by rotation or re-registration on reload.
      }
    }, HEARTBEAT_MS);

    const rotate = window.setInterval(async () => {
      const session = sessionRef.current;
      if (!session || disposed || session.expiresAt - Date.now() > ROTATE_BEFORE_MS) return;
      try {
        const view = await apiPost<ProctorSessionView>(
          `/advanced/proctoring/sessions/${encodeURIComponent(attemptId)}/rotate`,
          { sessionToken: session.token },
        );
        if (view.sessionToken && view.sessionTokenExpiresAt) {
          sessionRef.current = {
            token: view.sessionToken,
            expiresAt: Date.parse(view.sessionTokenExpiresAt),
          };
        }
      } catch {
        sessionRef.current = null;
      }
    }, ROTATE_CHECK_MS);

    return () => {
      disposed = true;
      window.clearInterval(heartbeat);
      window.clearInterval(rotate);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      sessionRef.current = null;
    };
  }, [attemptId, active]);
}
