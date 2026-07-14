import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface RaiseSheetProps {
  anchor: HTMLElement | null;
  amounts: number[];
  multiplier: number;
  onChoose(amount: number): void;
  onClose(): void;
}

export function RaiseSheet({ anchor, amounts, multiplier, onChoose, onClose }: RaiseSheetProps) {
  const [bottom, setBottom] = useState(8);

  useLayoutEffect(() => {
    const updatePosition = () => {
      if (!anchor) return;
      setBottom(Math.max(8, window.innerHeight - anchor.getBoundingClientRect().top + 8));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [anchor]);

  return createPortal(
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="bottom-sheet" role="dialog" aria-label="选择加注" style={{ bottom }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <h2>加注到</h2>
        <p>看牌玩家实际支付两倍筹码</p>
        <div className="raise-grid">
          {amounts.map((amount) => (
            <button type="button" key={amount} onClick={() => onChoose(amount)}>
              <strong>{amount}</strong>
              <small>支付 {amount * multiplier}</small>
            </button>
          ))}
        </div>
        <button className="sheet-cancel" type="button" onClick={onClose}>取消</button>
      </section>
    </div>,
    document.body,
  );
}
