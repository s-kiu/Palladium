import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Status } from './api.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="card">
      <div class="row spread">
        <h2>Server control</h2>
        <span class="tag">{{ stateLabel() }}</span>
      </div>

      @if (status()?.stopped) {
        <p class="muted">
          The server is stopped and stays stopped — the container is parked and waits.
          Pending updates or restores still run while it's down.
        </p>
        <div class="row">
          <button class="primary" (click)="start()">Start server</button>
          @if (feedback()) { <span class="muted">{{ feedback() }}</span> }
        </div>
      } @else {
        <p class="muted">
          Restart and Stop are graceful: the world is saved, players get the countdown, then the
          server goes down — Restart brings it right back, Stop keeps it down until you press
          Start.
        </p>
        <div class="row wrap">
          <input class="short" type="number" min="0" [(ngModel)]="waittime" name="wait" />
          <span class="muted">seconds warning</span>
          <input placeholder="countdown message (optional)" [(ngModel)]="message" name="msg" />
        </div>
        <div class="row wrap">
          <button class="primary" (click)="restart()">Restart</button>
          <button (click)="stop()">Stop</button>
          <button (click)="save()">Save world now</button>
          <span style="flex:1"></span>
          <button class="danger" (click)="kill()" title="immediate kill — no save, no warning">
            Force kill
          </button>
        </div>
        @if (feedback()) { <p class="muted small-note">{{ feedback() }}</p> }
        <p class="muted small-note">
          Force kill is for an unresponsive server only: no warning, no save — progress since the
          last save is lost, and the container starts it fresh right away.
        </p>
      }
    </div>

    <div class="grid">
      <div class="card">
        <h2>Broadcast</h2>
        <p class="muted">Message shown to everyone currently online.</p>
        <div class="row">
          <input placeholder="e.g. restarting in 10 minutes" [(ngModel)]="broadcastMsg" name="bmsg" />
          <button class="primary" (click)="broadcast()" [disabled]="!broadcastMsg">Send</button>
        </div>
        @if (broadcastResult()) {
          <p class="muted small-note">{{ broadcastResult() }}</p>
        }
      </div>

      <div class="card">
        <h2>More commands</h2>
        <p class="muted">
          Kick, ban and unban live on the <b>players</b> tab next to the player list. That is the
          complete vanilla admin surface — item spawning, teleports and other cheats require
          mods. In-game, admins can authenticate with
          <code>/AdminPassword &lt;password&gt;</code> in chat and use <code>/Kick</code>,
          <code>/Ban</code>, <code>/Broadcast</code>, <code>/Save</code>, <code>/ShutDown</code>.
        </p>
      </div>
    </div>

    <div class="card">
      <div class="row spread">
        <h2>Server state</h2>
        <div class="row">
          <button (click)="query('info')">info</button>
          <button (click)="query('metrics')">metrics</button>
          <button (click)="query('settings')">settings</button>
        </div>
      </div>
      @if (queryOutput()) {
        <pre class="logview small">{{ queryOutput() }}</pre>
      } @else {
        <p class="muted">Read-only views of what the server reports about itself.</p>
      }
    </div>
  `,
})
export class AdminComponent implements OnInit, OnDestroy {
  private api = inject(Api);
  status = signal<Status | null>(null);
  feedback = signal('');
  broadcastResult = signal('');
  queryOutput = signal('');
  broadcastMsg = '';
  message = '';
  waittime = 30;
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 5000);
  }
  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  refresh(): void {
    this.api.status().subscribe({ next: (s) => this.status.set(s), error: () => {} });
  }

  stateLabel(): string {
    const s = this.status();
    if (!s) return '…';
    if (s.stopped) return 'stopped';
    return s.online ? 'running' : 'starting / offline';
  }

  private opts() {
    return { waittime: Number(this.waittime) || 0, message: this.message || undefined };
  }

  restart(): void {
    if (!confirm(`Save and restart with a ${this.waittime}s warning?`)) return;
    this.api.lifecycle('restart', this.opts()).subscribe({
      next: (r) => this.done(r.note),
      error: () => this.feedback.set('failed'),
    });
  }

  stop(): void {
    if (!confirm(`Save and stop with a ${this.waittime}s warning? The server stays down until you press Start.`)) return;
    this.api.lifecycle('stop', this.opts()).subscribe({
      next: (r) => this.done(r.note),
      error: () => this.feedback.set('failed'),
    });
  }

  start(): void {
    this.api.lifecycle('start').subscribe({
      next: (r) => this.done(r.note),
      error: () => this.feedback.set('failed'),
    });
  }

  kill(): void {
    if (!confirm('Force-kill the server RIGHT NOW? No warning, no save — progress since the last save is lost.')) return;
    this.api.lifecycle('kill').subscribe({
      next: (r) => this.done(r.note),
      error: () => this.feedback.set('failed — server offline?'),
    });
  }

  save(): void {
    this.api.console('save').subscribe({
      next: () => this.done('world save requested'),
      error: () => this.feedback.set('failed — server offline?'),
    });
  }

  broadcast(): void {
    this.api.console('announce', { message: this.broadcastMsg }).subscribe({
      next: () => {
        this.broadcastResult.set('sent');
        this.broadcastMsg = '';
      },
      error: () => this.broadcastResult.set('failed — server offline?'),
    });
  }

  query(what: string): void {
    this.api.console(what).subscribe({
      next: (r) =>
        this.queryOutput.set(
          typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2),
        ),
      error: () => this.queryOutput.set('failed — server offline?'),
    });
  }

  private done(note: string): void {
    this.feedback.set(note);
    setTimeout(() => this.refresh(), 1500);
  }
}
