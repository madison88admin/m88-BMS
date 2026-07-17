import { useEffect, useRef } from 'react';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const WARNING_MS = 60 * 1000; // Show warning 1 minute before timeout
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'mousemove', 'scroll', 'click'];

export function useIdleTimeout(onTimeout: () => void, onWarning?: () => void) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  useEffect(() => {
    const resetTimer = () => {
      lastActivityRef.current = Date.now();

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);

      // Warning timer
      if (onWarning) {
        warningRef.current = setTimeout(() => {
          onWarning();
        }, IDLE_TIMEOUT_MS - WARNING_MS);
      }

      // Logout timer
      timeoutRef.current = setTimeout(() => {
        onTimeout();
      }, IDLE_TIMEOUT_MS);
    };

    // Reset on any user activity
    ACTIVITY_EVENTS.forEach(event => {
      window.addEventListener(event, resetTimer, { passive: true });
    });

    // Reset on API calls (visibility change means user came back)
    window.addEventListener('focus', resetTimer);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resetTimer();
    });

    // Initial timer
    resetTimer();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
      ACTIVITY_EVENTS.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
      window.removeEventListener('focus', resetTimer);
    };
  }, [onTimeout, onWarning]);

  return lastActivityRef;
}
