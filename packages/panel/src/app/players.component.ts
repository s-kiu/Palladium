import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api, Player } from './api.service';

@Component({
  selector: 'app-players',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
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
                <td class="mono">{{ p.userId }}</td>
                <td class="actions">
                  <button (click)="kick(p)">kick</button>
                  <button class="danger" (click)="ban(p)">ban</button>
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
      <h2>Unban</h2>
      <div class="row">
        <input placeholder="steam_00000000000000000" [(ngModel)]="unbanId" name="unban" class="mono" />
        <button (click)="unban()" [disabled]="!unbanId">Unban</button>
      </div>
      <p class="muted">User IDs appear in the table above while a player is online — note them before banning.</p>
    </div>
  `,
})
export class PlayersComponent implements OnInit, OnDestroy {
  private api = inject(Api);
  players = signal<Player[]>([]);
  feedback = signal('');
  unbanId = '';
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
    this.api.ban(p.userId, message).subscribe({
      next: () => this.feedback.set(`banned ${p.name} (${p.userId})`),
      error: () => this.feedback.set('ban failed'),
    });
  }

  unban(): void {
    this.api.unban(this.unbanId.trim()).subscribe({
      next: () => {
        this.feedback.set(`unbanned ${this.unbanId.trim()}`);
        this.unbanId = '';
      },
      error: () => this.feedback.set('unban failed'),
    });
  }
}
