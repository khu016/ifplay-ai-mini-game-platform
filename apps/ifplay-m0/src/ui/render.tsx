import type { ActionButton, ViewModel } from '@/core/viewModel';
import { DragMergeBoard } from './DragMergeBoard';

interface Handlers {
  onAction: (id: string, params?: Record<string, string>) => void;
  onPress: () => void;
  onRelease: () => void;
}

function ActionList({ actions, onAction }: { actions: ActionButton[]; onAction: Handlers['onAction'] }) {
  return (
    <div className="actions">
      {actions.map((a) => (
        <button key={a.id} className="btn action-btn" disabled={a.disabled} onClick={() => onAction(a.id, a.params)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

export function renderViewModel(vm: ViewModel, h: Handlers) {
  if (vm.scene === 'result') {
    return (
      <div className="result" data-testid="result">
        <h3>{vm.result?.title}</h3>
        <p className="result-summary">{vm.result?.summary}</p>
        <div className="stats">
          {vm.stats.map((s) => (
            <div key={s.label} className="stat">
              <span className="stat-label">{s.label}</span>
              <span className="stat-value">{s.value}</span>
            </div>
          ))}
        </div>
        <div className="log open">
          {vm.log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="gameplay">
      <div className="stats" data-testid="stats">
        {vm.stats.map((s) => (
          <div key={s.label} className="stat">
            <span className="stat-label">{s.label}</span>
            <span className="stat-value">{s.value}</span>
          </div>
        ))}
      </div>

      {vm.meters.length > 0 && (
        <div className="meters">
          {vm.meters.map((m) => (
            <div key={m.label} className="meter">
              <span className="meter-label">{m.label}</span>
              <div className="meter-bar">
                <div
                  className="meter-fill"
                  style={{ width: `${Math.max(0, Math.min(100, (m.value / m.max) * 100))}%` }}
                />
              </div>
              <span className="meter-value">
                {Math.round(m.value)}/{Math.round(m.max)}
              </span>
            </div>
          ))}
        </div>
      )}

      {vm.message && (
        <div className="message" data-testid="message">
          {vm.message}
        </div>
      )}

      {vm.inputMode === 'tap' && vm.tapZone && (
        <div className="tap-area">
          <div
            data-testid="tap-zone"
            className="tap-zone"
            onPointerDown={h.onPress}
            onPointerUp={h.onRelease}
            onPointerLeave={h.onRelease}
          >
            <div className="tap-track">
              {vm.tapZone.window && (
                <div
                  className="tap-window"
                  style={{
                    left: `${vm.tapZone.window.start * 100}%`,
                    width: `${(vm.tapZone.window.end - vm.tapZone.window.start) * 100}%`,
                  }}
                />
              )}
              {vm.tapZone.marker !== undefined && (
                <div className="tap-marker" style={{ left: `${vm.tapZone.marker * 100}%` }} />
              )}
            </div>
          </div>
          <p className="tap-hint">{vm.tapZone.hint}</p>
        </div>
      )}

      {vm.inputMode === 'drag' && vm.dragZone && (
        <DragMergeBoard zone={vm.dragZone} onAction={h.onAction} />
      )}

      {vm.queue.length > 0 && (
        <div className="queue">
          <h4>排队顾客</h4>
          {vm.queue.map((q) => (
            <div key={q.id} className="queue-item">
              <span className="queue-name">{q.name}</span>
              <span className="queue-detail">{q.detail}</span>
              {q.action && (
                <button className="btn" onClick={() => h.onAction(q.action!.id, q.action!.params)}>
                  {q.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {vm.panel && (
        <div className="panel" data-testid="panel">
          <h4>{vm.panel.title}</h4>
          <p className="panel-body">{vm.panel.body}</p>
          <div className="actions">
            {vm.panel.actions.map((a) => (
              <button key={a.id} className="btn" disabled={a.disabled} onClick={() => h.onAction(a.id, a.params)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <ActionList actions={vm.actions} onAction={h.onAction} />

      {vm.log.length > 0 && (
        <details className="log">
          <summary>事件记录</summary>
          {vm.log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </details>
      )}
    </div>
  );
}
