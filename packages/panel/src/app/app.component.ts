import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Api, authed } from './api.service';
import { LoginComponent } from './login.component';
import { DashboardComponent } from './dashboard.component';
import { PlayersComponent } from './players.component';
import { ModsComponent } from './mods.component';
import { BackupsComponent } from './backups.component';
import { AdminComponent } from './admin.component';
import { BridgeComponent } from './bridge.component';
import { PermissionsComponent } from './permissions.component';

type Tab = 'dashboard' | 'players' | 'mods' | 'backups' | 'palladium' | 'permissions' | 'admin';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    LoginComponent,
    DashboardComponent,
    PlayersComponent,
    ModsComponent,
    BackupsComponent,
    BridgeComponent,
    PermissionsComponent,
    AdminComponent,
  ],
  template: `
    @if (authed() === null) {
      <div class="center muted">loading…</div>
    } @else if (authed() === false) {
      <app-login />
    } @else {
      <header class="topbar">
        <span class="brand">Pal-Up</span>
        <nav>
          @for (t of tabs(); track t) {
            <button [class.active]="tab() === t" (click)="tab.set(t)">{{ t }}</button>
          }
        </nav>
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
          @case ('palladium') { <app-bridge /> }
          @case ('permissions') { <app-permissions /> }
          @case ('admin') { <app-admin /> }
        }
      </main>
    }
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  private api = inject(Api);
  authed = authed;
  tab = signal<Tab>('dashboard');
  // The bridge tab only means anything once the agent mod is loaded, so it
  // appears when the agent has announced itself and not before.
  private bridgeUp = signal(false);
  tabs = computed<Tab[]>(() => [
    'dashboard',
    'players',
    'mods',
    'backups',
    ...(this.bridgeUp() ? (['palladium', 'permissions'] as Tab[]) : []),
    'admin',
  ]);
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
        if (!s.available && (this.tab() === 'palladium' || this.tab() === 'permissions')) this.tab.set('dashboard');
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
