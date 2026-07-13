interface RaiseSheetProps {
  amounts: number[];
  multiplier: number;
  onChoose(amount: number): void;
  onClose(): void;
}

export function RaiseSheet({ amounts, multiplier, onChoose, onClose }: RaiseSheetProps) {
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label="选择加注" onMouseDown={(event) => event.stopPropagation()}>
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
    </div>
  );
}
