interface HomeScreenProps {
  onSolo(): void;
  onOnline(): void;
  onRules(): void;
}

export function HomeScreen({ onSolo, onOnline, onRules }: HomeScreenProps) {
  return (
    <main className="home-screen">
      <div className="home-mark" aria-hidden="true">
        <span>金</span>
      </div>
      <section className="home-copy" aria-labelledby="game-title">
        <p className="eyebrow">三张之间 · 胆识为先</p>
        <h1 id="game-title">金局</h1>
        <p className="home-subtitle">炸金花</p>
        <p className="home-description">一副牌，三张定局。与三位风格不同的对手过招，或邀请朋友进入实时牌桌。</p>
      </section>
      <nav className="home-actions" aria-label="游戏模式">
        <button className="mode-button mode-button-primary" type="button" aria-label="单机对战" onClick={onSolo}>
          <span className="mode-index">壹</span>
          <span><strong>单机对战</strong><small>你与三位 AI 玩家</small></span>
          <span aria-hidden="true">→</span>
        </button>
        <button className="mode-button" type="button" aria-label="联网房间" onClick={onOnline}>
          <span className="mode-index">贰</span>
          <span><strong>联网房间</strong><small>输入房间码与好友同桌</small></span>
          <span aria-hidden="true">→</span>
        </button>
      </nav>
      <button className="text-button" type="button" onClick={onRules}>玩法规则</button>
      <p className="virtual-note">仅使用游戏内虚拟筹码</p>
    </main>
  );
}
