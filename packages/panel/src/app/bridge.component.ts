import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, BridgeEvent, BridgePlayer, BridgeStatus } from './api.service';

// The bridge page. Everything on it is driven by what the agent reports about
// itself — the hook list, the event-type filters and the available actions all
// come from the running mod, so adding a hook needs no change here.
@Component({
  selector: 'app-bridge',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="card">
      <div class="row spread">
        <h2>Bridge agent</h2>
        <span class="tag">{{ status()?.agent }} {{ status()?.version }}</span>
      </div>
      <p class="muted">
        Engine hooks the mod registered on this server run. A hook that fails costs its own
        event type and nothing else — the rest keep working.
      </p>
      <table>
        <thead>
          <tr><th>Event</th><th>Hooked function</th><th>Status</th></tr>
        </thead>
        <tbody>
          @for (h of status()?.hooks ?? []; track h.target) {
            <tr>
              <td>{{ h.hook }}</td>
              <td class="mono">{{ h.target }}</td>
              <td><span class="tag" [class.warn-tag]="!h.ok">{{ h.ok ? 'live' : 'not registered' }}</span></td>
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
        view; the list of types is whatever the agent has published so far.
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
            <span class="evt-type" [attr.data-type]="e.type">{{ e.type }}</span>
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
        Every id the bridge has seen, kept across restarts. Select one to act on it.
      </p>
      <table>
        <thead>
          <tr><th>Name</th><th>User id</th><th class="num">Joins</th><th class="num">First seen</th><th class="num">Last seen</th><th></th></tr>
        </thead>
        <tbody>
          @for (p of players(); track p.userid) {
            <tr [class.picked]="selected() === p.userid">
              <td>{{ p.name }} @if (p.online) { <span class="tag">online</span> }</td>
              <td class="mono">{{ p.userid }}</td>
              <td class="num">{{ p.joins }}</td>
              <td class="num">{{ date(p.firstSeen) }}</td>
              <td class="num">{{ date(p.lastSeen) }}</td>
              <td class="actions">
                <button (click)="selected.set(p.userid)" [disabled]="selected() === p.userid">Select</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="muted">Nobody has connected while the bridge was running yet.</td></tr>
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Send to the game</h2>
      <p class="muted">
        Executed by the mod inside the game. Only works while the target player is online.
        The same actions are available over the API at <code>POST /api/bridge/actions</code>.
      </p>
      @if (!selected()) {
        <p class="muted small-note">Select a player above first.</p>
      } @else {
        <p class="small-note">Target: <b>{{ selectedName() }}</b> <span class="mono muted">{{ selected() }}</span></p>
        @if (has('give_item')) {
          <div class="row wrap">
            <input [(ngModel)]="item" name="item" placeholder="item id, e.g. PalSphere" />
            <input class="short" type="number" min="1" [(ngModel)]="count" name="count" />
            <button class="primary" (click)="giveItem()" [disabled]="!item || busy()">Give item</button>
          </div>
        }
        @if (has('message')) {
          <div class="row wrap">
            <input [(ngModel)]="message" name="message" placeholder="private message to this player" />
            <button (click)="sendMessage()" [disabled]="!message || busy()">Send message</button>
          </div>
        }
      }
      @if (feedback()) {
        <p class="small-note" [class.muted]="!failed()" [class.err]="failed()">{{ feedback() }}</p>
      }
    </div>
  `,
})
export class BridgeComponent implements OnInit, OnDestroy {
  private api = inject(Api);

  status = signal<BridgeStatus | null>(null);
  events = signal<BridgeEvent[]>([]);
  players = signal<BridgePlayer[]>([]);
  filter = signal<Set<string>>(new Set());
  selected = signal<string>('');
  placeholder = signal('loading events…');
  feedback = signal('');
  failed = signal(false);
  busy = signal(false);

  item = '';
  count = 1;
  message = '';

  private cursor = 0;
  private timers: ReturnType<typeof setInterval>[] = [];

  // Bounded so a long-running session cannot grow the view without limit.
  private static readonly KEEP = 500;

  // Types the agent has actually published, so a hook added later shows up as a
  // filter without touching this file.
  types = computed(() => {
    const seen = new Set(this.status()?.eventTypes ?? []);
    for (const e of this.events()) seen.add(e.type);
    return [...seen].sort();
  });

  shown = computed(() => {
    const wanted = this.filter();
    const all = this.events();
    return wanted.size ? all.filter((e) => wanted.has(e.type)) : all;
  });

  selectedName = computed(
    () => this.players().find((p) => p.userid === this.selected())?.name ?? 'unknown',
  );

  ngOnInit(): void {
    this.refreshStatus();
    this.refreshEvents();
    this.refreshPlayers();
    this.timers.push(setInterval(() => this.refreshEvents(), 2000));
    this.timers.push(setInterval(() => this.refreshStatus(), 10000));
    this.timers.push(setInterval(() => this.refreshPlayers(), 5000));
  }
  ngOnDestroy(): void {
    for (const t of this.timers) clearInterval(t);
  }

  has(action: string): boolean {
    return (this.status()?.actions ?? []).includes(action);
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

  // One line per event kind. Unknown kinds fall back to their raw fields, so a
  // new event type is readable here before this switch learns about it.
  summary(e: BridgeEvent): string {
    switch (e.type) {
      case 'chat': return `${e.player}: ${e.message}`;
      case 'join': return `${e.player} joined${e.initial ? ' (first time this run)' : ''}`;
      case 'leave': return `${e.player} left`;
      case 'death': return e.killer ? `${e.player} was killed by ${e.killer}` : `${e.player} died`;
      case 'capture': return `${e.player} caught ${e.pal}`;
      case 'action': return `${e.action} → ${e.ok ? 'ok' : 'failed'}: ${e.detail}`;
      case 'hook': return `${e.hook} on ${e.target} — ${e.ok ? 'registered' : 'failed'}`;
      case 'ready': return `${e.agent} v${e.version} loaded`;
      default:
        return Object.entries(e)
          .filter(([k]) => !['v', 'at', 'type'].includes(k))
          .map(([k, val]) => `${k}=${val}`)
          .join(' ');
    }
  }

  refreshStatus(): void {
    this.api.bridgeStatus().subscribe({ next: (s) => this.status.set(s), error: () => {} });
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

  giveItem(): void {
    this.send('give_item', { userid: this.selected(), item: this.item, count: Number(this.count) || 1 });
  }

  sendMessage(): void {
    this.send('message', { userid: this.selected(), text: this.message });
  }

  private send(action: string, params: Record<string, unknown>): void {
    this.busy.set(true);
    this.feedback.set('');
    this.api.bridgeAction(action, params).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.failed.set(!r.ok);
        this.feedback.set(`${action}: ${r.ok ? 'ok' : 'failed'} — ${r.detail}`);
        if (r.ok && action === 'message') this.message = '';
      },
      error: (err) => {
        this.busy.set(false);
        this.failed.set(true);
        this.feedback.set(`${action} failed — ${err?.error?.error ?? 'the game did not answer'}`);
      },
    });
  }
}
