import { useCallback, useEffect, useRef, useState } from 'react';

/** The numbers. Entering them wakes something up. */
export const NUMBERS = [4, 8, 15, 16, 23, 42] as const;

const CODE = NUMBERS.join('');
/** Longest input kept for matching and for the on-screen echo. */
const ECHO_LIMIT = 24;

/**
 * One input stream for both paths: physical keyboard digits and clicks on the
 * on-screen keys feed the same echo string, the screen prints it back like a
 * real terminal, and when the echo ends with the code the rabbit runs.
 */
export function useSequence(onMatch: () => void) {
  const [echo, setEcho] = useState('');
  const matchRef = useRef(onMatch);
  matchRef.current = onMatch;

  const feed = useCallback((chunk: string) => {
    setEcho((prev) => {
      const next = (prev + chunk).slice(-ECHO_LIMIT);
      if (next.endsWith(CODE)) {
        matchRef.current();
        return '';
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.length !== 1 || event.key < '0' || event.key > '9') return;
      feed(event.key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [feed]);

  /** Click path: whole numbers, e.g. clickNumber(15) feeds "15". */
  const clickNumber = useCallback((value: number) => feed(String(value)), [feed]);

  // How many of the sequence keys light up: the longest prefix of NUMBERS
  // whose concatenation is a suffix of what has been typed so far.
  let progress = 0;
  for (let k = NUMBERS.length; k >= 1; k -= 1) {
    if (echo.endsWith(NUMBERS.slice(0, k).join(''))) {
      progress = k;
      break;
    }
  }

  return { echo, progress, clickNumber };
}
