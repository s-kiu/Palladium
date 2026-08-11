import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Api, authed } from './api.service';
import { LoginComponent } from './login.component';
import { DashboardComponent } from './dashboard.component';
import { PlayersComponent } from './players.component';
import { ModsComponent } from './mods.component';
import { BackupsComponent } from './backups.component';
import { AdminComponent } from './admin.component';
import { PermissionsComponent } from './permissions.component';
import { streamerMode, toggleStreamerMode } from './streamer';

type Tab = 'dashboard' | 'players' | 'mods' | 'backups' | 'palladium' | 'admin';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    LoginComponent,
    DashboardComponent,
    PlayersComponent,
    ModsComponent,
    BackupsComponent,
    PermissionsComponent,
    AdminComponent,
  ],
  host: { '[class.streamer-mode]': 'streamer()' },
  template: `
    @if (authed() === null) {
      <div class="center muted">loading…</div>
    } @else if (authed() === false) {
      <app-login />
    } @else {
      <header class="topbar">
        <span class="brand">Pal-Up<span class="brand-sub">the server</span></span>
        <nav>
          @for (t of coreTabs; track t) {
            <button [class.active]="tab() === t" (click)="tab.set(t)">{{ t }}</button>
          }
          <button [class.active]="tab() === 'admin'" (click)="tab.set('admin')">admin</button>
          @if (bridgeUp()) {
            <!-- Two products, one panel: Pal-Up is the server around the game,
                 Palladium is the framework inside it. One page covers the
                 framework — the studio, which is also what the docs site
                 serves to operators who cannot run Pal-Up at all. It sits at
                 the end because it is the other product, not another Pal-Up
                 page. -->
            <span class="navgroup">
              <span class="navgroup-label">Palladium</span>
              <button [class.active]="tab() === 'palladium'" (click)="tab.set('palladium')">studio</button>
            </span>
          }
        </nav>
        <button
          class="ghost signout streamer-toggle"
          [class.on]="streamer()"
          (click)="toggleStreamer()"
          [title]="streamer()
            ? 'Hidden: addresses, tokens, player ids and the log are covered. Click to show them.'
            : 'Hide addresses, tokens, player ids and the log — for screenshots and streams.'"
        >
          @if (streamer()) {
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.4 5.2A9.6 9.6 0 0 1 12 5c5 0 9 4.5 9 7a11 11 0 0 1-2.4 3.5" />
              <path d="M6.2 6.8A11.4 11.4 0 0 0 3 12c0 2.5 4 7 9 7a9.8 9.8 0 0 0 3.4-.6" />
            </svg>
          } @else {
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7z" />
              <circle cx="12" cy="12" r="2.6" />
            </svg>
          }
          <span>{{ streamer() ? 'hidden' : 'hide' }}</span>
        </button>
        <button class="ghost signout" (click)="logout()" title="sign out">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
            <path d="M10 17l-5-5 5-5" />
            <path d="M5 12h11" />
          </svg>
          <span>sign out</span>
        </button>
      </header>
      <main>
        @switch (tab()) {
          @case ('dashboard') { <app-dashboard /> }
          @case ('players') { <app-players /> }
          @case ('mods') { <app-mods /> }
          @case ('backups') { <app-backups /> }
          @case ('palladium') { <app-permissions /> }
          @case ('admin') { <app-admin /> }
        }
      </main>
    }
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  private api = inject(Api);
  authed = authed;
  // The class rides the whole app so every page redacts; the switch sits in
  // the top bar beside sign out, where a control that changes what the whole
  // panel shows belongs.
  streamer = streamerMode;
  toggleStreamer = toggleStreamerMode;
  tab = signal<Tab>('dashboard');
  // The Palladium group only means anything once the agent mod is loaded, so
  // it appears when the agent has announced itself and not before.
  bridgeUp = signal(false);
  coreTabs: Tab[] = ['dashboard', 'players', 'mods', 'backups'];
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.api.session().subscribe({
      next: (s) => {
        authed.set(s.authenticated);
        if (s.authenticated) {
          this.probeBridge();
          this.timer = setInterval(() => this.probeBridge(), 15000);
        }
      },
      error: () => authed.set(false),
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  private probeBridge(): void {
    this.api.bridgeStatus().subscribe({
      next: (s) => {
        this.bridgeUp.set(s.available);
        if (!s.available && this.tab() === 'palladium') this.tab.set('dashboard');
      },
      error: () => this.bridgeUp.set(false),
    });
  }

  logout(): void {
    this.api.logout().subscribe({
      next: () => authed.set(false),
      error: () => authed.set(false),
    });
  }
}
