import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';

import { useSound } from '../src/client/game/useSound';

beforeEach(() => localStorage.clear());

it('starts muted and persists the user sound preference', () => {
  const { result } = renderHook(() => useSound());

  expect(result.current.enabled).toBe(false);
  act(() => result.current.toggle());
  expect(result.current.enabled).toBe(true);
  expect(localStorage.getItem('zjh-sound-enabled')).toBe('true');
});

it('silently ignores sound playback when Web Audio is unavailable', () => {
  const { result } = renderHook(() => useSound());
  act(() => result.current.toggle());

  expect(() => result.current.play('deal')).not.toThrow();
});
