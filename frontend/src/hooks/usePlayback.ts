import { useEffect, useState } from 'react';

/** Steps through a time series at a fixed tick so the map and charts stay in sync. */
export function usePlayback(total: number, tickMs = 400) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || total === 0) return;
    const id = window.setInterval(() => {
      setStep((s) => {
        if (s + 1 >= total) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, tickMs);
    return () => window.clearInterval(id);
  }, [playing, total, tickMs]);

  return { step, setStep, playing, togglePlay: () => setPlaying((p) => !p) };
}
