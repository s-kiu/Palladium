import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Api,
  BridgeCapability,
  BridgeEvent,
  BridgePlayer,
  BridgeSchema,
} from './api.service';

// One option shape feeds every picker: players, items, pal species, traits.
interface PickOption {
  value: string;
  label: string;
  sub?: string;
  tier?: number;
  online?: boolean;
  element?: string[] | null;
  variant?: string;
  seenMin?: number;
  seenMax?: number;
  unlisted?: boolean;
}

// The bridge page renders the schema, not a hand-kept list: every hook row,
// filter chip, action form and picker below comes from what the manifest
// declares and the agent reports live. A capability added to the manifest
// appears here — form, target field and pickers included — with no change to
// this file.
@Component({
  selector: 'app-bridge',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="card">
      <div class="row spread">
        <h2>Bridge agent</h2>
        <span class="tag">{{ agentLabel() }}</span>
      </div>
      <p class="muted">
        Engine hooks the mod registered on this server run. A hook that fails costs its own
        event type and nothing else — the rest keep working.
      </p>
      <table>
        <thead>
          <tr><th>Event</th><th>Source</th><th>Stability</th><th>Status</th></tr>
        </thead>
        <tbody>
          @for (c of eventCaps(); track c.type) {
            <tr>
              <td class="mono">{{ c.type }}</td>
              <td class="mono">{{ c.source?.hook ?? c.runtime }}</td>
              <td><span class="tag" [class.warn-tag]="c.stability !== 'stable'">{{ c.stability }}</span></td>
              <td><span class="tag" [class.warn-tag]="!c.live">{{ c.live ? 'live' : 'not registered' }}</span></td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="row spread">
        <h2>Events</h2>
        <span class="tag">{{ shown().length }} of {{ events().length }}</span>
      </div>
      <p class="muted">
        Live stream for this server run, refreshed every 2 seconds. Click a type to narrow the
        view. Action results travel the same stream as the <code>result</code> kind.
      </p>
      <div class="row wrap chips">
        <button class="chip" [class.on]="!filter().size" (click)="clearFilter()">all</button>
        @for (t of types(); track t) {
          <button class="chip" [class.on]="filter().has(t)" (click)="toggle(t)">{{ t }}</button>
        }
      </div>
      <div class="logview small chatlog">
        @for (e of shown(); track $index) {
          <div class="chatline">
            <span class="chat-time">{{ time(e.at) }}</span>
            <span class="evt-type" [attr.data-type]="chipOf(e)">{{ chipOf(e) }}</span>
            <span class="chat-text">{{ summary(e) }}</span>
          </div>
        } @empty {
          <span class="muted">{{ placeholder() }}</span>
        }
      </div>
    </div>

    <div class="card">
      <div class="row spread">
        <h2>Players</h2>
        <span class="tag">{{ players().length }} known</span>
      </div>
      <p class="muted">Every id the bridge has seen, kept in the panel's database across restarts.</p>
      <table>
        <thead>
          <tr><th>Name</th><th>User id</th><th class="num">Joins</th><th class="num">First seen</th><th class="num">Last seen</th><th>Tags</th></tr>
        </thead>
        <tbody>
          @for (p of players(); track p.userid) {
            <tr>
              <td>{{ p.name }} @if (p.online) { <span class="tag">online</span> }</td>
              <td class="mono">{{ p.userid }}</td>
              <td class="num">{{ p.joins }}</td>
              <td class="num">{{ date(p.firstSeen) }}</td>
              <td class="num">{{ date(p.lastSeen) }}</td>
              <td class="mono small-tags">{{ tagText(p) }}</td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="muted">Nobody has connected while the bridge was running yet.</td></tr>
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="row spread">
        <h2>Send to the game</h2>
        <span class="tag">POST /api/bridge/call</span>
      </div>
      <p class="muted">
        One form per capability the schema declares — nothing here is hand-written per action.
        The same calls work from any language with an API token (admin page).
      </p>
      @for (c of actionCaps(); track c.type) {
        <div class="action-row">
          <div class="row wrap">
            <span class="mono action-name">{{ c.type }}</span>
            <span class="tag" [class.warn-tag]="c.stability !== 'stable'">{{ c.stability }}</span>
            <span class="spacer"></span>
            <button class="primary" (click)="run(c)" [disabled]="busy() || !c.live">Run</button>
          </div>
          <p class="muted small-note">{{ c.summary }}</p>
          <div class="row wrap">
            @if (c.target === 'player') {
              <span class="pickwrap">
                <input
                  [(ngModel)]="targets[c.type]"
                  [name]="c.type + '.target'"
                  placeholder="target player (required)"
                />
                <button class="pickbtn" title="pick a player" (click)="openPlayerPicker(c.type)">☰</button>
              </span>
            }
            @for (p of paramList(c); track p.name) {
              @if (p.spec.type === 'bool') {
                <label class="follow">
                  <input
                    type="checkbox"
                    [(ngModel)]="boolInputs[c.type + '.' + p.name]"
                    [name]="c.type + '.' + p.name"
                  />
                  {{ p.name }}
                </label>
              } @else if (p.spec.picker) {
                <span class="pickwrap">
                  <input
                    [(ngModel)]="inputs[c.type + '.' + p.name]"
                    [name]="c.type + '.' + p.name"
                    [placeholder]="placeholderFor(p)"
                  />
                  <button class="pickbtn" title="pick from the list" (click)="openCatalogPicker(p.spec.picker!, c.type + '.' + p.name)">☰</button>
                </span>
              } @else {
                <input
                  [class.short]="p.spec.type === 'int' || p.spec.type === 'number'"
                  [type]="p.spec.type === 'int' || p.spec.type === 'number' ? 'number' : 'text'"
                  [(ngModel)]="inputs[c.type + '.' + p.name]"
                  [name]="c.type + '.' + p.name"
                  [placeholder]="placeholderFor(p)"
                />
              }
            }
          </div>
          @if (results[c.type]; as r) {
            <p class="small-note mono" [class.muted]="!r.startsWith('failed')" [class.err]="r.startsWith('failed')">{{ r }}</p>
          }
        </div>
      }
    </div>

    <dialog #pickerDlg class="dlg picker-dlg">
      <div class="row spread">
        <h2>{{ pickerTitle() }}</h2>
        <button class="ghost" (click)="closePicker()">✕</button>
      </div>
      <input
        [(ngModel)]="pickerSearch"
        name="picker-search"
        placeholder="type to search…"
        (ngModelChange)="pickerQuery.set($event)"
        autocomplete="off"
      />
      @if (pickerKind() === 'pal') {
        <div class="row wrap chips">
          <button class="chip" [class.on]="!palElement()" (click)="palElement.set(null)">any element</button>
          @for (el of PAL_ELEMENTS; track el) {
            <button class="chip" [class.on]="palElement() === el" (click)="palElement.set(el)">
              @if (el !== 'unknown') { <span class="el-dot el-{{ el.toLowerCase() }}"></span> }
              {{ el }}
            </button>
          }
        </div>
        <div class="row wrap pal-filters">
          <select [(ngModel)]="palVariant" name="pal-variant" (ngModelChange)="palVariantSig.set($event)">
            <option value="all">all variants</option>
            @for (v of PAL_VARIANTS; track v) { <option [value]="v">{{ v }}</option> }
          </select>
          <input
            class="short"
            type="number"
            min="1"
            max="100"
            [(ngModel)]="palLevel"
            name="pal-level"
            placeholder="level"
            (ngModelChange)="setPalLevel($event)"
          />
          <button class="chip" [class.on]="palSeenOnly()" (click)="palSeenOnly.set(!palSeenOnly())">
            seen on this server
          </button>
          <span class="muted small-note">level and “seen” come from spawns observed here — a modded mob appears once one has spawned</span>
        </div>
      }
      <div class="pick-list">
        @for (o of pickerShown(); track o.value) {
          <button
            class="pick-item"
            [class.picked]="pickerChosen().has(o.value)"
            (click)="choose(o)"
          >
            <span class="pick-label">
              @if (o.tier !== undefined) { <span class="tier-dot tier-{{ tierClass(o.tier) }}"></span> }
              @for (el of o.element ?? []; track el) { <span class="el-dot el-{{ el.toLowerCase() }}" [title]="el"></span> }
              {{ o.label }}
              @if (o.unlisted) { <span class="tag warn-tag">unlisted</span> }
              @if (o.online) { <span class="tag">online</span> }
              @if (pickerChosen().has(o.value)) { <span class="tag">selected</span> }
            </span>
            <span class="pick-sub">{{ o.sub }}</span>
          </button>
        } @empty {
          <p class="muted">nothing matches</p>
        }
        @if (pickerTruncated()) {
          <p class="muted small-note">…{{ pickerTruncated() }} more — keep typing to narrow.</p>
        }
      </div>
      @if (pickerMulti()) {
        <div class="row dlg-actions">
          <button (click)="closePicker()">Cancel</button>
          <button class="primary" (click)="applyMulti()">Use {{ pickerChosen().size }} selected</button>
        </div>
      }
    </dialog>
  `,
})
export class BridgeComponent implements OnInit, OnDestroy {
  private api = inject(Api);
  @ViewChild('pickerDlg') pickerDlg?: ElementRef<HTMLDialogElement>;

  schema = signal<BridgeSchema | null>(null);
  events = signal<BridgeEvent[]>([]);
  players = signal<BridgePlayer[]>([]);
  filter = signal<Set<string>>(new Set());
  placeholder = signal('loading events…');
  busy = signal(false);

  inputs: Record<string, string> = {};
  boolInputs: Record<string, boolean> = {};
  targets: Record<string, string> = {};
  results: Record<string, string> = {};

  private catalogs: {
    item: PickOption[];
    pal: PickOption[];
    traits: PickOption[];
  } = { item: [], pal: [], traits: [] };

  // ── picker state ───────────────────────────────────────────────────────────
  pickerTitle = signal('');
  pickerKind = signal('');
  pickerQuery = signal('');
  pickerSearch = '';
  pickerMulti = signal(false);
  readonly PAL_ELEMENTS = ['Neutral', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Ground', 'Dark', 'Dragon', 'unknown'];
  readonly PAL_VARIANTS = ['normal', 'boss', 'raid', 'gym', 'predator', 'summon'];
  palElement = signal<string | null>(null);
  palVariant = 'all';
  palVariantSig = signal('all');
  palLevel = '';
  palLevelSig = signal('');
  palSeenOnly = signal(false);
  pickerChosen = signal<Set<string>>(new Set());
  private pickerOptions = signal<PickOption[]>([]);
  private pickerWrite: (value: string) => void = () => {};
  private static readonly PICKER_PAGE = 150;

  pickerFiltered = computed(() => {
    const q = this.pickerQuery().toLowerCase().trim();
    let all = this.pickerOptions();
    if (this.pickerKind() === 'pal') {
      const el = this.palElement();
      if (el === 'unknown') all = all.filter((o) => !o.element?.length);
      else if (el) all = all.filter((o) => o.element?.includes(el));
      const variant = this.palVariantSig();
      if (variant !== 'all') all = all.filter((o) => o.variant === variant);
      if (this.palSeenOnly()) all = all.filter((o) => o.seenMin !== undefined);
      const lv = Number(this.palLevelSig());
      if (this.palLevelSig() !== '' && Number.isFinite(lv)) {
        all = all.filter((o) => o.seenMin !== undefined && lv >= o.seenMin! && lv <= (o.seenMax ?? o.seenMin!));
      }
    }
    if (!q) return all;
    return all.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.sub ?? '').toLowerCase().includes(q),
    );
  });
  pickerShown = computed(() => this.pickerFiltered().slice(0, BridgeComponent.PICKER_PAGE));
  pickerTruncated = computed(() =>
    Math.max(0, this.pickerFiltered().length - BridgeComponent.PICKER_PAGE),
  );

  private cursor = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private static readonly KEEP = 500;

  eventCaps = computed(() =>
    (this.schema()?.capabilities ?? []).filter((c) => c.kind === 'event'),
  );
  actionCaps = computed(() =>
    (this.schema()?.capabilities ?? []).filter((c) => c.kind !== 'event'),
  );

  agentLabel = computed(() => {
    const a = this.schema()?.agent;
    return a?.ready ? `${a.name} ${a.version}` : 'agent not loaded';
  });

  types = computed(() => {
    const seen = new Set(this.eventCaps().map((c) => c.type));
    for (const e of this.events()) seen.add(this.chipOf(e));
    return [...seen].sort();
  });

  shown = computed(() => {
    const wanted = this.filter();
    const all = this.events();
    return wanted.size ? all.filter((e) => wanted.has(this.chipOf(e))) : all;
  });

  ngOnInit(): void {
    this.refreshSchema();
    this.refreshEvents();
    this.refreshPlayers();
    this.api.bridgeCatalog().subscribe({
      next: (c) => {
        this.catalogs = {
          item: c.items.map((i) => ({ value: i.id, label: i.name, sub: i.id })),
          pal: c.pals.map((p) => ({
            value: p.id,
            label: p.name,
            sub: p.id + (p.seen ? ` · seen lv ${p.seen.min}–${p.seen.max} ×${p.seen.count}` : ''),
            element: p.element,
            variant: p.variant,
            seenMin: p.seen?.min,
            seenMax: p.seen?.max,
            unlisted: p.unlisted,
          })),
          traits: c.traits.map((t) => ({ value: t.id, label: t.name, sub: t.effect, tier: t.tier })),
        };
      },
      error: () => {},
    });
    this.timers.push(setInterval(() => this.refreshEvents(), 2000));
    this.timers.push(setInterval(() => this.refreshSchema(), 10000));
    this.timers.push(setInterval(() => this.refreshPlayers(), 5000));
  }
  ngOnDestroy(): void {
    for (const t of this.timers) clearInterval(t);
  }

  // ── pickers ────────────────────────────────────────────────────────────────
  openPlayerPicker(capType: string): void {
    this.pickerKind.set('player');
    this.openPicker(
      'Pick a player',
      this.players().map((p) => ({
        value: p.userid,
        label: p.name,
        sub: p.userid,
        online: p.online,
      })),
      false,
      (v) => (this.targets[capType] = v),
    );
  }

  openCatalogPicker(kind: string, inputKey: string): void {
    const titles: Record<string, string> = {
      item: 'Pick an item',
      pal: 'Pick a pal',
      traits: 'Pick traits',
    };
    const options = (this.catalogs as Record<string, PickOption[]>)[kind] ?? [];
    const multi = kind === 'traits';
    if (multi) {
      const current = (this.inputs[inputKey] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      this.pickerChosen.set(new Set(current));
    }
    this.pickerKind.set(kind);
    // The world keeps reporting new species (mods included); refresh the pal
    // catalog on open so they are pickable without a page reload.
    if (kind === 'pal') this.refreshCatalog();
    this.openPicker(titles[kind] ?? 'Pick', options, multi, (v) => (this.inputs[inputKey] = v));
  }

  private refreshCatalog(): void {
    this.api.bridgeCatalog().subscribe({
      next: (c) => {
        this.catalogs.pal = c.pals.map((p) => ({
          value: p.id,
          label: p.name,
          sub: p.id + (p.seen ? ` · seen lv ${p.seen.min}–${p.seen.max} ×${p.seen.count}` : ''),
          element: p.element,
          variant: p.variant,
          seenMin: p.seen?.min,
          seenMax: p.seen?.max,
          unlisted: p.unlisted,
        }));
        if (this.pickerKind() === 'pal') this.pickerOptions.set(this.catalogs.pal);
      },
      error: () => {},
    });
  }

  private openPicker(
    title: string,
    options: PickOption[],
    multi: boolean,
    write: (value: string) => void,
  ): void {
    this.pickerTitle.set(title);
    this.pickerOptions.set(options);
    this.pickerMulti.set(multi);
    if (!multi) this.pickerChosen.set(new Set());
    this.pickerWrite = write;
    this.pickerSearch = '';
    this.pickerQuery.set('');
    this.palElement.set(null);
    this.palVariant = 'all';
    this.palVariantSig.set('all');
    this.palLevel = '';
    this.palLevelSig.set('');
    this.palSeenOnly.set(false);
    this.pickerDlg?.nativeElement.showModal();
  }

  choose(option: PickOption): void {
    if (this.pickerMulti()) {
      this.pickerChosen.update((prev) => {
        const next = new Set(prev);
        if (next.has(option.value)) next.delete(option.value);
        else next.add(option.value);
        return next;
      });
      return;
    }
    this.pickerWrite(option.value);
    this.closePicker();
  }

  applyMulti(): void {
    this.pickerWrite([...this.pickerChosen()].join(','));
    this.closePicker();
  }

  closePicker(): void {
    this.pickerDlg?.nativeElement.close();
  }

  tierClass(tier: number): string {
    return tier < 0 ? 'neg' : String(Math.min(4, Math.max(1, tier)));
  }

  setPalLevel(value: unknown): void {
    this.palLevelSig.set(value === null || value === undefined ? '' : String(value));
  }

  // ── table / stream helpers ─────────────────────────────────────────────────
  chipOf(e: BridgeEvent): string {
    return e.kind === 'result' ? 'result' : e.type;
  }

  paramList(c: BridgeCapability): { name: string; spec: NonNullable<BridgeCapability['params']>[string] }[] {
    return Object.entries(c.params ?? {}).map(([name, spec]) => ({ name, spec }));
  }

  placeholderFor(p: { name: string; spec: { required?: boolean; default?: unknown } }): string {
    const bits = [p.name];
    if (p.spec.required) bits.push('(required)');
    else if (p.spec.default !== undefined) bits.push(`(default ${p.spec.default})`);
    return bits.join(' ');
  }

  toggle(type: string): void {
    this.filter.update((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }
  clearFilter(): void {
    this.filter.set(new Set());
  }

  time(at: number): string {
    return new Date(at * 1000).toTimeString().slice(0, 8);
  }
  date(at: number): string {
    return at ? new Date(at * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—';
  }
  tagText(p: BridgePlayer): string {
    const entries = Object.entries(p.tags ?? {});
    return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(' ') : '—';
  }

  // One line per event. Unknown types fall back to raw fields, so a capability
  // added to the manifest is readable here before anyone writes a pretty case.
  summary(e: BridgeEvent): string {
    const who = e.subject?.name ?? e.subject?.id ?? '';
    if (e.kind === 'result') {
      return `${e.type} → ${e.ok ? 'ok' : `failed (${e.error ?? ''})`} ${this.flat(e.data)}`;
    }
    switch (e.type) {
      case 'player.chat': return `${who}: ${e.data['message']}`;
      case 'player.join':
        return `${who} joined${e.data['firstEver'] ? ' — first time ever' : ''} (join #${e.data['joins'] ?? '?'})`;
      case 'player.leave': return `${who} left`;
      case 'player.respawn': return `${who} respawned`;
      case 'player.death': {
        const killer = e.data['killer'] as { name?: string } | undefined;
        return killer?.name ? `${who} was killed by ${killer.name}` : `${who} died`;
      }
      case 'npc.spawn':
        return `${e.data['species']} lv${e.data['level']}${e.data['rare'] ? ' (rare)' : ''} spawned`;
      case 'bridge.ready': return `${e.data['agent']} v${e.data['version']} loaded`;
      case 'bridge.hook':
        return `${e.data['hook']} — ${e.data['ok'] ? 'registered' : 'failed'}`;
      default: return `${who} ${this.flat(e.data)}`.trim();
    }
  }

  private flat(data: Record<string, unknown>): string {
    return Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`)
      .join(' ');
  }

  refreshSchema(): void {
    this.api.bridgeSchema().subscribe({ next: (s) => this.schema.set(s), error: () => {} });
  }

  refreshPlayers(): void {
    this.api.bridgePlayers().subscribe({ next: (r) => this.players.set(r.players), error: () => {} });
  }

  refreshEvents(): void {
    this.api.bridgeEvents(this.cursor, 500).subscribe({
      next: (r) => {
        // The event file is emptied when the server boots, so a cursor that
        // moved backwards means a new run: drop what belongs to the old one.
        if (r.cursor < this.cursor) this.events.set([]);
        this.cursor = r.cursor;
        if (r.events.length) {
          this.events.update((prev) => [...prev, ...r.events].slice(-BridgeComponent.KEEP));
        }
        this.placeholder.set('(nothing published this server run yet)');
      },
      error: () => this.placeholder.set('(events unavailable)'),
    });
  }

  run(c: BridgeCapability): void {
    const target = (this.targets[c.type] ?? '').trim();
    if (c.target === 'player' && !target) {
      this.results[c.type] = 'failed (pick a target player first)';
      return;
    }
    const data: Record<string, unknown> = {};
    for (const p of this.paramList(c)) {
      const key = `${c.type}.${p.name}`;
      if (p.spec.type === 'bool') {
        if (this.boolInputs[key]) data[p.name] = true;
      } else {
        const raw = (this.inputs[key] ?? '').trim();
        if (raw !== '') data[p.name] = raw;
      }
    }
    this.busy.set(true);
    this.results[c.type] = 'running…';
    this.api.bridgeCall(c.type, c.target === 'player' ? target : null, data).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.results[c.type] = r.ok
          ? `ok ${this.flat(r.data)}`
          : `failed (${r.error ?? 'unknown'})`;
        if (c.type.endsWith('_tag')) this.refreshPlayers();
      },
      error: (err) => {
        this.busy.set(false);
        this.results[c.type] = `failed (${err?.error?.error ?? 'no answer from the game'})`;
      },
    });
  }
}
