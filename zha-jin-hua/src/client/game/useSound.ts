import { useCallback, useEffect, useRef, useState } from 'react';

export type SoundCue = 'deal' | 'chip' | 'flip' | 'win';

export interface SoundController {
  enabled: boolean;
  toggle(): void;
  play(cue: SoundCue): void;
}

const SOUND_KEY = 'zjh-sound-enabled';
const FREQUENCIES: Record<SoundCue, number> = {
  deal: 320,
  chip: 520,
  flip: 410,
  win: 660,
};

type AudioContextConstructor = new () => AudioContext;

export function useSound(): SoundController {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(SOUND_KEY) === 'true');
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(() => () => {
    void contextRef.current?.close().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current;
      localStorage.setItem(SOUND_KEY, String(next));
      return next;
    });
  }, []);

  const play = useCallback((cue: SoundCue) => {
    if (!enabled) return;
    try {
      const audioWindow = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
      const Context = window.AudioContext ?? audioWindow.webkitAudioContext;
      if (!Context) return;
      const context = contextRef.current ?? new Context();
      contextRef.current = context;
      if (context.state === 'suspended') void context.resume().catch(() => undefined);

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = cue === 'win' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(FREQUENCIES[cue], context.currentTime);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(cue === 'win' ? 0.12 : 0.055, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (cue === 'win' ? 0.35 : 0.12));
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + (cue === 'win' ? 0.36 : 0.13));
    } catch {
      // Audio is optional and must never interrupt gameplay.
    }
  }, [enabled]);

  return { enabled, toggle, play };
}
