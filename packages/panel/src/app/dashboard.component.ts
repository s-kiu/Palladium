import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Api, ConnectInfo, Status, fmtUptime } from './api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  template: `
    @if (status(); as s) {
      @if (s.build.updateAvailable) {
        <div class="banner warn">
          Game update available (build {{ s.build.installed }} → {{ s.build.latest }}).
          Updates can break mods until the mod loader catches up.
          <button (click)="applyUpdate()">Apply update now</button>
        </div>
      }
      @if (s.ue4ss.fallbackActive) {
        <div class="banner warn">
          Mod loader disabled automatically after {{ s.ue4ss.fastcrashCount }} rapid crashes —
          the server runs unmodded until a compatible UE4SS release is pinned.
        </div>
      }
      @if (s.pending.update || s.pending.restore) {
        <div class="banner info">
          Pending on next server start:
          {{ s.pending.update ? 'game update' : '' }}
          {{ s.pending.restore ? 'restore of ' + s.pending.restore : '' }}
        </div>
      }
      @if (feedback()) {
        <div class="banner info">{{ feedback() }}</div>
      }

      <div class="grid">
        <div class="card">
          <h2>Connect</h2>
          @if (connect(); as c) {
            @if (!c.online) {
              <p class="error">Server is offline or still starting — nobody can join right now.</p>
            } @else {
              <div class="kv"><span>Same network</span>
                <b class="mono copy" (click)="copy(lanAddress(c))" title="click to copy">{{ lanAddress(c) }}</b>
              </div>
              <div class="kv"><span>Internet</span>
                @if (c.publicIp) {
                  <b class="mono copy" (click)="copy(c.publicIp + ':' + c.publicPort)" title="click to copy">
                    {{ c.publicIp }}:{{ c.publicPort }}
                  </b>
                } @else {
                  <b class="muted">{{ c.lookupEnabled ? 'could not detect public IP' : 'lookup disabled' }}</b>
                }
              </div>
              <p class="muted small-note">
                In Palworld: Join Multiplayer Game → enter the address below the server list.
                For internet play, UDP {{ c.publicPort }} must be allowed in the firewall and
                forwarded by your router — that can't be verified from the server itself, so if
                friends can't join, check those two first.
              </p>
            }
          } @else {
            <p class="muted">checking…</p>
          }
        </div>

        <div class="card">
          <h2>Server</h2>
          <div class="kv"><span>Status</span>
            <b [class]="s.online ? 'ok' : (s.stopped ? 'muted' : 'error')">
              {{ s.online ? 'online' : (s.stopped ? 'stopped (by admin)' : 'offline / starting') }}
            </b>
          </div>
          <div class="kv"><span>Name</span><b>{{ s.info?.servername ?? '—' }}</b></div>
          <div class="kv"><span>Game version</span><b>{{ s.info?.version ?? '—' }}</b></div>
          <div class="kv"><span>Players</span>
            <b>{{ s.metrics?.currentplayernum ?? '—' }} / {{ s.metrics?.maxplayernum ?? '—' }}</b>
          </div>
          <div class="kv"><span>Server FPS</span><b>{{ s.metrics?.serverfps ?? '—' }}</b></div>
          <div class="kv"><span>Uptime</span><b>{{ uptime(s) }}</b></div>
        </div>

        <div class="card">
          <h2>Build</h2>
          <div class="kv"><span>Installed</span><b>{{ s.build.installed ?? '—' }}</b></div>
          <div class="kv"><span>Latest on Steam</span><b>{{ s.build.latest ?? 'unknown' }}</b></div>
          <div class="kv"><span>Update held</span><b>{{ s.build.held ? 'yes' : 'no' }}</b></div>
          @if (s.pending.lastResult) {
            <div class="kv"><span>Last action</span><b>{{ s.pending.lastResult }}</b></div>
          }
        </div>

        <div class="card">
          <h2>Mods</h2>
          <div class="kv"><span>Mod loader (UE4SS)</span>
            <b>{{ s.ue4ss.libInstalled ? (s.ue4ss.fallbackActive ? 'installed, fallback active' : 'installed') : 'not installed' }}</b>
          </div>
          <div class="kv"><span>Lua mods</span><b>{{ s.counts.luaMods }}</b></div>
          <div class="kv"><span>LogicMods</span><b>{{ s.counts.logicMods }}</b></div>
          <div class="kv"><span>.pak mods</span><b>{{ s.counts.paks }}</b></div>
          <div class="kv"><span>Backups</span><b>{{ s.counts.backups }}</b></div>
        </div>
      </div>
    } @else {
      <div class="center muted">loading status…</div>
    }
  `,
})
export class DashboardComponent implements OnInit, OnDestroy {
  private api = inject(Api);
  status = signal<Status | null>(null);
  connect = signal<ConnectInfo | null>(null);
  feedback = signal('');
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.refresh();
    this.refreshConnect();
    this.timer = setInterval(() => this.refresh(), 5000);
  }
  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  refresh(): void {
    this.api.status().subscribe({ next: (s) => this.status.set(s), error: () => {} });
  }

  refreshConnect(): void {
    this.api.connect().subscribe({ next: (c) => this.connect.set(c), error: () => {} });
  }

  lanAddress(c: ConnectInfo): string {
    return `${location.hostname}:${c.gamePort}`;
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text).then(
      () => this.flash(`copied: ${text}`),
      () => {},
    );
  }

  private flash(msg: string): void {
    this.feedback.set(msg);
    setTimeout(() => this.feedback.set(''), 2500);
  }

  uptime(s: Status): string {
    return fmtUptime(s.metrics?.uptime);
  }

  applyUpdate(): void {
    if (
      !confirm(
        'Apply the game update now?\n\nThe server shuts down gracefully (players get a 30 s warning), a backup is taken, the update installs, and the server comes back up. Mods may break until the mod loader supports the new build.',
      )
    )
      return;
    this.api.applyUpdate().subscribe({
      next: (r) => this.feedback.set(r.note),
      error: () => this.feedback.set('could not schedule the update'),
    });
  }
}
