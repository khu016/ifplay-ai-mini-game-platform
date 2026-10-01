import { createRng, type Rng } from '@/core/rng';
import { createBus, type Bus } from '@/core/bus';
import { createClock, type Clock } from '@/core/clock';
import { createStore, type Store } from '@/core/store';
import { saveGame, loadGame, clearSave } from '@/core/save';
import { validateBundle, type GameBundle } from '@/core/schema';
import { moduleRegistry } from '@/modules/registry';
import { recordStats } from '@/core/stats';
import type { GameplayModule } from '@/modules/contract';
import type { ModuleContext } from '@/core/context';
import type { NormalizedInput } from '@/core/input';
import type { ViewModel, ModuleView } from '@/core/viewModel';

export class GameRuntime {
  readonly bundle: GameBundle;
  readonly module: GameplayModule<any, any>;
  readonly seed: number;
  readonly rng: Rng;
  private readonly bus: Bus;
  private readonly clock: Clock;
  private readonly store: Store<Record<string, unknown>>;
  private _paused = false;
  private _ended = false;
  private _destroyed = false;

  constructor(bundle: GameBundle, options: { seed?: number } = {}) {
    const vr = validateBundle(bundle);
    if (!vr.ok) throw new Error(`invalid GameBundle: ${JSON.stringify(vr.errors)}`);
    const mod = moduleRegistry[bundle.primaryModule.id];
    if (!mod) throw new Error(`unknown module: ${bundle.primaryModule.id}`);
    const cr = mod.validateConfig(bundle.primaryModule.config);
    if (!cr.ok) throw new Error(`invalid module config: ${JSON.stringify(cr.errors)}`);
    if (mod.validateBundle) {
      const br = mod.validateBundle(bundle.primaryModule.config, bundle);
      if (!br.ok) throw new Error(`invalid bundle for module: ${JSON.stringify(br.errors)}`);
    }

    this.bundle = bundle;
    this.module = mod;
    this.seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff);
    this.rng = createRng(this.seed);
    this.bus = createBus();
    this.clock = createClock();

    const initial = mod.createInitialState(bundle.primaryModule.config, this.seed, this.rng) as Record<string, unknown>;
    this.store = createStore(initial);

    this.bus.on((e) => {
      if (e.type === 'game:ended') {
        this._ended = true;
        if (this.module.scoreOf) {
          recordStats(this.bundle.manifest.id, this.module.scoreOf(this.store.get()));
        }
      }
    });
  }

  get state(): Record<string, unknown> {
    return this.store.get();
  }
  get paused(): boolean {
    return this._paused;
  }
  get ended(): boolean {
    return this._ended;
  }
  /** 当前玩法模块是否有基于时间的 tick（点击时机有，经营模拟没有）。 */
  get hasTick(): boolean {
    return typeof this.module.tick === 'function';
  }

  private ctx(): ModuleContext {
    return { rng: this.rng, bus: this.bus, clock: this.clock, bundle: this.bundle };
  }

  start(): void {
    this._paused = false;
  }
  pause(): void {
    this._paused = true;
  }
  resume(): void {
    this._paused = false;
  }
  restart(): void {
    this.rng.setState(this.seed);
    const fresh = this.module.createInitialState(this.bundle.primaryModule.config, this.seed, this.rng) as Record<string, unknown>;
    this.store.replace(fresh);
    this._ended = false;
    this._paused = false;
    this.save();
  }
  step(input: NormalizedInput): void {
    if (this._destroyed || this._paused || this._ended) return;
    this.module.reduce(this.store.get(), input, this.ctx());
    this.save();
  }
  tick(dt: number): void {
    if (this._destroyed || this._paused || this._ended) return;
    this.module.tick?.(this.store.get(), dt, this.ctx());
  }
  view(): ViewModel {
    const m: ModuleView = this.module.view(this.store.get(), this.bundle.primaryModule.config);
    return { ...m, title: this.bundle.manifest.name, subtitle: this.bundle.experience.goal };
  }
  save(): void {
    saveGame(this.bundle.manifest.id, {
      schemaVersion: this.bundle.saveSchema.version,
      seed: this.seed,
      rngState: this.rng.state(),
      state: this.module.serialize(this.store.get()),
      savedAt: Date.now(),
    });
  }
  load(): boolean {
    const data = loadGame(this.bundle.manifest.id);
    if (!data || data.schemaVersion !== this.bundle.saveSchema.version) return false;
    const restored = this.module.deserialize(data.state, this.bundle.primaryModule.config) as Record<string, unknown>;
    this.store.replace(restored);
    this.rng.setState(data.rngState);
    this._ended = false;
    this._paused = false;
    return true;
  }
  clearSave(): void {
    clearSave(this.bundle.manifest.id);
  }
  destroy(): void {
    this._destroyed = true;
  }
}

export function createGame(bundle: GameBundle, options?: { seed?: number }): GameRuntime {
  return new GameRuntime(bundle, options);
}
