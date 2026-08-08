import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Api, BanEntry, Player } from './api.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-players',
  standalone: true,
  imports: [IconComponent, DecimalPipe, DatePipe],
  template: `
    <div class="card">
      <h2>Online players</h2>
      @if (players().length === 0) {
        <p class="muted">Nobody online right now.</p>
      } @else {
        <table>
          <thead>
            <tr><th>Name</th><th>Level</th><th>Ping</th><th>User ID</th><th></th></tr>
          </thead>
          <tbody>
            @for (p of players(); track p.userId) {
              <tr>
                <td>{{ p.name }}</td>
                <td>{{ p.level }}</td>
                <td>{{ p.ping | number: '1.0-0' }}</td>
                <td class="mono secret">{{ p.userId }}</td>
                <td class="actions">
                  <button (click)="kick(p)" title="Kick this player"><app-icon name="kick" /><span class="btn-label">kick</span></button>
                  <button class="danger" (click)="ban(p)" title="Ban this player"><app-icon name="ban" /><span class="btn-label">ban</span></button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      @if (feedback()) {
        <p class="muted">{{ feedback() }}</p>
      }
    </div>

    <div class="card">
      <h2>Banned players</h2>
      @if (bans().length === 0) {
        <p class="muted">No banned players.</p>
      } @else {
        <table>
          <thead>
            <tr><th>Name</th><th>User ID</th><th>Banned</th><th></th></tr>
          </thead>
          <tbody>
            @for (b of bans(); track b.userid) {
              <tr>
                <td>{{ b.name ?? '—' }}</td>
                <td class="mono">{{ b.userid }}</td>
                <td>{{ b.bannedAt ? (b.bannedAt | date: 'yyyy-MM-dd HH:mm') : '—' }}</td>
                <td class="actions">
                  <button (click)="unban(b)" title="Lift this ban"><app-icon name="unban" /><span class="btn-label">unban</span></button>
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p class="muted small-note">
          Includes bans issued in-game; names are known only for bans made from this panel.
        </p>
      }
    </div>
  `,
})
export class PlayersComponent implements OnInit, OnDestroy {
  private api = inject(Api);
  players = signal<Player[]>([]);
  bans = signal<BanEntry[]>([]);
  feedback = signal('');
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 5000);
  }
  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  refresh(): void {
    this.api.players().subscribe({
      next: (r) => this.players.set(r.players ?? []),
      error: () => this.players.set([]),
    });
    this.api.bans().subscribe({
      next: (r) => this.bans.set(r.bans ?? []),
      error: () => {},
    });
  }

  kick(p: Player): void {
    const message = prompt(`Kick ${p.name}? Message shown to the player:`, 'Kicked by admin');
    if (message === null) return;
    this.api.kick(p.userId, message).subscribe({
      next: () => this.feedback.set(`kicked ${p.name}`),
      error: () => this.feedback.set('kick failed'),
    });
  }

  ban(p: Player): void {
    const message = prompt(
      `BAN ${p.name}? This persists until unbanned. Message shown to the player:`,
      'Banned by admin',
    );
    if (message === null) return;
    this.api.ban(p.userId, message, p.name).subscribe({
      next: () => {
        this.feedback.set(`banned ${p.name} (${p.userId})`);
        this.refresh();
      },
      error: () => this.feedback.set('ban failed'),
    });
  }

  unban(b: BanEntry): void {
    if (!confirm(`Unban ${b.name ?? b.userid}?`)) return;
    this.api.unban(b.userid).subscribe({
      next: () => {
        this.feedback.set(`unbanned ${b.name ?? b.userid}`);
        this.refresh();
      },
      error: () => this.feedback.set('unban failed'),
    });
  }
}
