import { bundles, MODULE_LABELS, type BundleEntry } from '@/bundles';

export function SelectPage({ onSelect }: { onSelect: (b: BundleEntry) => void }) {
  return (
    <div className="page select">
      <h1>IfPlay · M1 试玩</h1>
      <p className="sub">选择一款样例游戏</p>
      <div className="game-list">
        {bundles.map((b) => (
          <button key={b.bundle.manifest.id} data-testid="game-card" className="game-card" onClick={() => onSelect(b)}>
            <span className="game-name">{b.bundle.manifest.name}</span>
            <span className="game-desc">{b.bundle.experience.playerRole}</span>
            <span className="game-goal">{b.bundle.experience.goal}</span>
            <span className="game-tag">{MODULE_LABELS[b.bundle.primaryModule.id]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
