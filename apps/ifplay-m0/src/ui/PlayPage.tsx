import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createGame, type GameRuntime } from '@/core/runtime';
import type { GameBundle } from '@/core/schema';
import type { ViewModel } from '@/core/viewModel';
import { renderViewModel } from './render';

export function PlayPage({ bundle, onBack }: { bundle: GameBundle; onBack: () => void }) {
  const runtimeRef = useRef<GameRuntime | null>(null);
  if (!runtimeRef.current) {
    const rt = createGame(bundle);
    rt.load(); // 有存档则恢复，无存档保持新开局
    runtimeRef.current = rt;
  }
  const runtime = runtimeRef.current;

  const [view, setView] = useState<ViewModel>(() => runtime.view());
  const pressStart = useRef<number | null>(null);

  const refresh = useCallback(() => setView(runtime.view()), [runtime]);

  const handleAction = useCallback(
    (id: string, params?: Record<string, string>) => {
      runtime.step({ kind: 'action', actionId: id, params });
      refresh();
    },
    [runtime, refresh],
  );

  const handlePress = useCallback(() => {
    if (pressStart.current === null) pressStart.current = performance.now();
    runtime.step({ kind: 'press' });
  }, [runtime]);

  const handleRelease = useCallback(() => {
    if (pressStart.current !== null) {
      const heldMs = performance.now() - pressStart.current;
      pressStart.current = null;
      runtime.step({ kind: 'release', heldMs });
      refresh();
    }
  }, [runtime, refresh]);

  // 点击时机模块的帧循环（经营模拟模块无 tick，不启动循环）
  useEffect(() => {
    if (!runtime.hasTick) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      runtime.tick(dt);
      refresh();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runtime, refresh]);

  const accent = bundle.uiLayout.theme.accent ?? '#7c5cff';

  return (
    <div className="page play" style={{ '--accent': accent } as CSSProperties}>
      <div className="play-header">
        <button className="btn" onClick={onBack}>
          ← 返回
        </button>
        <div className="play-title">
          <h2>{view.title}</h2>
          {view.subtitle && <p>{view.subtitle}</p>}
        </div>
      </div>
      <div className="controls">
        <button
          data-testid="btn-pause"
          className="btn"
          disabled={runtime.paused || runtime.ended}
          onClick={() => {
            runtime.pause();
            refresh();
          }}
        >
          暂停
        </button>
        <button
          data-testid="btn-resume"
          className="btn"
          disabled={!runtime.paused}
          onClick={() => {
            runtime.resume();
            refresh();
          }}
        >
          继续
        </button>
        <button
          data-testid="btn-restart"
          className="btn"
          onClick={() => {
            runtime.restart();
            refresh();
          }}
        >
          重新开始
        </button>
        <button data-testid="btn-save" className="btn" onClick={() => runtime.save()}>
          存档
        </button>
        <button
          data-testid="btn-load"
          className="btn"
          onClick={() => {
            runtime.load();
            refresh();
          }}
        >
          读档
        </button>
      </div>
      {renderViewModel(view, { onAction: handleAction, onPress: handlePress, onRelease: handleRelease })}
    </div>
  );
}
