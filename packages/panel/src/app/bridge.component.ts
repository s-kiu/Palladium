import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Api,
  BridgeCapability,
  BridgeEvent,
  BridgePlayer,
  BridgeSchema,
} from './api.service';

// The bridge page renders the schema, not a hand-kept list: every hook row,
// filter chip, action form and input field below comes from what the manifest
// declares and the agent reports live. A capability added to the manifest
// appears here — form included — with no change to this file.
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
      <p class="muted">
        Every id the bridge has seen, kept in the panel's database across restarts. Select one
        to target actions at it.
      </p>
      <table>
        <thead>
          <tr><th>Name</th><th>User id</th><th class="num">Joins</th><th class="num">First seen</th><th class="num">Last seen</th><th>Tags</th><th></th></tr>
        </thead>
        <tbody>
          @for (p of players(); track p.userid) {
            <tr [class.picked]="selected() === p.userid">
              <td>{{ p.name }} @if (p.online) { <span class="tag">online</span> }</td>
              <td class="mono">{{ p.userid }}</td>
              <td class="num">{{ p.joins }}</td>
              <td class="num">{{ date(p.firstSeen) }}</td>
              <td class="num">{{ date(p.lastSeen) }}</td>
              <td class="mono small-tags">{{ tagText(p) }}</td>
              <td class="actions">
                <button (click)="selected.set(p.userid)" [disabled]="selected() === p.userid">Select</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="muted">Nobody has connected while the bridge was running yet.</td></tr>
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
      @if (!selected()) {
        <p class="muted small-note">Player-targeted actions need a player — select one above.</p>
      } @else {
        <p class="small-note">Target: <b>{{ selectedName() }}</b> <span class="mono muted">{{ selected() }}</span></p>
      }
      @for (c of actionCaps(); track c.type) {
        <div class="action-row">
          <div class="row wrap">
            <span class="mono action-name">{{ c.type }}</span>
            <span class="tag" [class.warn-tag]="c.stability !== 'stable'">{{ c.stability }}</span>
            @if (c.target === 'player') { <span class="tag">targets player</span> }
            <span class="spacer"></span>
            <button
              class="primary"
              (click)="run(c)"
              [disabled]="busy() || !c.live || (c.target === 'player' && !selected())"
            >Run</button>
          </div>
          <p class="muted small-note">{{ c.summary }}</p>
          <div class="row wrap">
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
  `,
})
export class BridgeComponent implements OnInit, OnDestroy {
  private api = inject(Api);

  schema = signal<BridgeSchema | null>(null);
  events = signal<BridgeEvent[]>([]);
  players = signal<BridgePlayer[]>([]);
  filter = signal<Set<string>>(new Set());
  selected = signal<string>('');
  placeholder = signal('loading events…');
  busy = signal(false);

  inputs: Record<string, string> = {};
  boolInputs: Record<string, boolean> = {};
  results: Record<string, string> = {};

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

  selectedName = computed(
    () => this.players().find((p) => p.userid === this.selected())?.name ?? 'unknown',
  );

  ngOnInit(): void {
    this.refreshSchema();
    this.refreshEvents();
    this.refreshPlayers();
    this.timers.push(setInterval(() => this.refreshEvents(), 2000));
    this.timers.push(setInterval(() => this.refreshSchema(), 10000));
    this.timers.push(setInterval(() => this.refreshPlayers(), 5000));
  }
  ngOnDestroy(): void {
    for (const t of this.timers) clearInterval(t);
  }

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
    this.api.bridgeCall(c.type, c.target === 'player' ? this.selected() : null, data).subscribe({
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
