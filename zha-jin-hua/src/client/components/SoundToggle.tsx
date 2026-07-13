interface SoundToggleProps {
  enabled: boolean;
  onToggle(): void;
}

export function SoundToggle({ enabled, onToggle }: SoundToggleProps) {
  return (
    <button className="sound-toggle" type="button" aria-label={enabled ? '关闭声音' : '开启声音'} onClick={onToggle}>
      <span aria-hidden="true">{enabled ? '♪' : '♩'}</span>
      <small>{enabled ? '声音开' : '静音'}</small>
    </button>
  );
}
