import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ApiToken, Status } from './api.service';
import { ChatComponent } from './chat.component';
import { ConsoleComponent } from './console.component';
import { SettingsComponent } from './settings.component';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule, ChatComponent, ConsoleComponent, SettingsComponent],
  template: `
    <div class="card">
      <div class="row spread">
        <h2>Server actions</h2>
        <span class="tag">{{ stateLabel() }}</span>
      </div>
      @if (op(); as o) {
        <div class="banner info opbanner">
          @if (o.phase === 'countdown') {
            <b>{{ opLabel(o.kind) }} in {{ secondsLeft(o.fireAt) }}s</b>
            @if (o.message) { <span class="muted">“{{ o.message }}”</span> }
          } @else {
            <b>{{ opLabel(o.kind) }} in progress</b>
            <span class="muted">{{
              o.kind === 'stop' ? 'shutting down…' : 'waiting for the server to come back…'
            }}</span>
          }
        </div>
      }
      @if (status()?.stopped) {
        <p class="muted">
          The server is stopped and stays stopped — pending updates or restores still run while
          it's down.
        </p>
        <div class="row">
          <button class="primary" (click)="start()">Start server</button>
        </div>
      } @else {
        <div class="row wrap">
          <button class="primary" (click)="open(restartDlg)" [disabled]="!!op()">Restart…</button>
          <button (click)="open(stopDlg)" [disabled]="!!op()">Stop…</button>
          <button (click)="saveWorld()" [disabled]="!!op()">Save world</button>
          <button (click)="open(broadcastDlg)">Broadcast…</button>
          <span class="spacer"></span>
          <button class="danger" (click)="kill()" [disabled]="!!op()" title="immediate kill — no warning, no save">
            Force kill
          </button>
        </div>
      }
      @if (feedback()) {
        <p class="muted small-note">{{ feedback() }}</p>
      }
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

    <div class="card">
      <div class="row spread">
        <h2>API tokens</h2>
        <span class="tag">{{ tokens().length }} active</span>
      </div>
      <p class="muted">
        Bearer credentials for programs using the bridge API — one header, no cookie jar,
        revocable here. Tokens can only call <code>/api/bridge/*</code>; read tokens cannot
        change anything in the game.
      </p>
      @if (newToken()) {
        <div class="banner info">
          <b>Copy it now — this is the only time it is shown:</b>
          <span class="mono">{{ newToken() }}</span>
        </div>
      }
      <div class="row wrap">
        <input [(ngModel)]="tokenName" name="token-name" placeholder="what will use it, e.g. discord-relay" />
        <label class="follow"><input type="checkbox" [(ngModel)]="tokenWrite" name="token-write" /> allow write</label>
        <button class="primary" (click)="createToken()" [disabled]="!tokenName">Create token</button>
      </div>
      @if (tokens().length) {
        <table>
          <thead>
            <tr><th>Name</th><th>Scopes</th><th class="num">Created</th><th class="num">Last used</th><th></th></tr>
          </thead>
          <tbody>
            @for (t of tokens(); track t.id) {
              <tr>
                <td>{{ t.name }}</td>
                <td class="mono">{{ t.scopes.join(', ') }}</td>
                <td class="num">{{ date(t.createdAt) }}</td>
                <td class="num">{{ t.lastUsedAt ? date(t.lastUsedAt) : 'never' }}</td>
                <td class="actions">
                  <button class="danger" (click)="revokeToken(t.id)">Revoke</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>

    <app-chat />
    <app-console />
    <app-settings />

    <dialog #restartDlg class="dlg">
      <h2>Restart server</h2>
      <p class="muted">Saves the world, warns players, and comes back up automatically.</p>
      <label>Warning (seconds)
        <input type="number" min="0" [(ngModel)]="waittime" name="restart-wait" />
      </label>
      <label>Message to players
        <input [(ngModel)]="message" name="restart-msg" placeholder="Server restarting shortly" />
      </label>
      <div class="row dlg-actions">
        <button (click)="restartDlg.close()">Cancel</button>
        <button class="primary" (click)="restart(restartDlg)">Restart</button>
      </div>
    </dialog>

    <dialog #stopDlg class="dlg">
      <h2>Stop server</h2>
      <p class="muted">
        Saves the world, warns players, then stays stopped until you press Start.
      </p>
      <label>Warning (seconds)
        <input type="number" min="0" [(ngModel)]="waittime" name="stop-wait" />
      </label>
      <label>Message to players
        <input [(ngModel)]="message" name="stop-msg" placeholder="Server shutting down" />
      </label>
      <div class="row dlg-actions">
        <button (click)="stopDlg.close()">Cancel</button>
        <button class="primary" (click)="stop(stopDlg)">Stop</button>
      </div>
    </dialog>

    <dialog #broadcastDlg class="dlg">
      <h2>Broadcast</h2>
      <p class="muted">Message shown to everyone currently online.</p>
      <label>Message
        <input [(ngModel)]="broadcastMsg" name="bc-msg" placeholder="e.g. restarting in 10 minutes" />
      </label>
      <div class="row dlg-actions">
        <button (click)="broadcastDlg.close()">Cancel</button>
        <button class="primary" (click)="broadcast(broadcastDlg)" [disabled]="!broadcastMsg">
          Send
        </button>
      </div>
    </dialog>
  `,
})
export class AdminComponent implements OnInit, OnDestroy {
  private api = inject(Api);
  status = signal<Status | null>(null);
  feedback = signal('');
  queryOutput = signal('');
  now = signal(Date.now());
  waittime = 30;
  message = '';
  broadcastMsg = '';
  private timer?: ReturnType<typeof setInterval>;
  private ticker?: ReturnType<typeof setInterval>;

  tokens = signal<ApiToken[]>([]);
  newToken = signal('');
  tokenName = '';
  tokenWrite = false;

  ngOnInit(): void {
    this.refresh();
    this.refreshTokens();
    this.timer = setInterval(() => this.refresh(), 5000);
    this.ticker = setInterval(() => this.now.set(Date.now()), 1000);
  }

  refreshTokens(): void {
    this.api.tokens().subscribe({ next: (r) => this.tokens.set(r.tokens), error: () => {} });
  }

  date(at: number): string {
    return new Date(at * 1000).toISOString().slice(0, 10);
  }

  createToken(): void {
    const scopes = this.tokenWrite ? ['read', 'write'] : ['read'];
    this.api.createToken(this.tokenName, scopes).subscribe({
      next: (r) => {
        this.newToken.set(r.token);
        this.tokenName = '';
        this.tokenWrite = false;
        this.refreshTokens();
      },
      error: () => this.feedback.set('token creation failed'),
    });
  }

  revokeToken(id: string): void {
    if (!confirm('Revoke this token? Anything using it stops working immediately.')) return;
    this.api.revokeToken(id).subscribe({
      next: () => this.refreshTokens(),
      error: () => this.feedback.set('revoke failed'),
    });
  }
  ngOnDestroy(): void {
    clearInterval(this.timer);
    clearInterval(this.ticker);
  }

  op() {
    return this.status()?.operation ?? null;
  }

  opLabel(kind: string): string {
    return kind === 'restart' ? 'Restart' : kind === 'stop' ? 'Stop' : 'Force kill';
  }

  secondsLeft(fireAt: number): number {
    return Math.max(0, Math.ceil((fireAt - this.now()) / 1000));
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

  open(dlg: HTMLDialogElement): void {
    this.feedback.set('');
    dlg.showModal();
  }

  private opts() {
    return { waittime: Number(this.waittime) || 0, message: this.message || undefined };
  }

  restart(dlg: HTMLDialogElement): void {
    dlg.close();
    this.api.lifecycle('restart', this.opts()).subscribe({
      next: (r) => this.done(r.note),
      error: () => this.feedback.set('restart failed'),
    });
  }

  stop(dlg: HTMLDialogElement): void {
    dlg.close();
    this.api.lifecycle('stop', this.opts()).subscribe({
      next: (r) => this.done(r.note),
      error: () => this.feedback.set('stop failed'),
    });
  }

  start(): void {
    this.api.lifecycle('start').subscribe({
      next: (r) => this.done(r.note),
      error: () => this.feedback.set('start failed'),
    });
  }

  kill(): void {
    if (!confirm('Force-kill the server RIGHT NOW? No warning, no save — progress since the last save is lost.')) return;
    this.api.lifecycle('kill').subscribe({
      next: (r) => this.done(r.note),
      error: () => this.feedback.set('failed — server offline?'),
    });
  }

  saveWorld(): void {
    this.api.console('save').subscribe({
      next: () => this.done('world save requested'),
      error: () => this.feedback.set('save failed — server offline?'),
    });
  }

  broadcast(dlg: HTMLDialogElement): void {
    const msg = this.broadcastMsg;
    dlg.close();
    this.api.console('announce', { message: msg }).subscribe({
      next: () => {
        this.broadcastMsg = '';
        this.done('broadcast sent');
      },
      error: () => this.feedback.set('broadcast failed — server offline?'),
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
