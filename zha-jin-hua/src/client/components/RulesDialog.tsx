interface RulesDialogProps {
  onClose(): void;
}

export function RulesDialog({ onClose }: RulesDialogProps) {
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="rules-dialog" role="dialog" aria-modal="true" aria-label="玩法规则" onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" type="button" aria-label="关闭规则" onClick={onClose}>×</button>
        <p className="eyebrow">三张定胜负</p>
        <h2>玩法规则</h2>
        <ol className="hand-ranking">
          <li><b>1</b><span><strong>豹子</strong><small>三张点数相同</small></span><em>AAA</em></li>
          <li><b>2</b><span><strong>同花顺</strong><small>同花色且连续</small></span><em>QKA</em></li>
          <li><b>3</b><span><strong>同花</strong><small>同花色，不连续</small></span><em>AK9</em></li>
          <li><b>4</b><span><strong>顺子</strong><small>点数连续</small></span><em>789</em></li>
          <li><b>5</b><span><strong>对子</strong><small>两张点数相同</small></span><em>QQ8</em></li>
          <li><b>6</b><span><strong>单张</strong><small>依次比较最大牌</small></span><em>A95</em></li>
        </ol>
        <p className="rules-note">A23 为最小顺子，QKA 为最大顺子。看牌后跟注与加注成本按双倍计算；比牌平局时发起者淘汰。</p>
      </section>
    </div>
  );
}
