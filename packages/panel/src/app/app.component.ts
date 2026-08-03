import { Component, OnInit, inject, signal } from '@angular/core';
import { Api, authed } from './api.service';
import { LoginComponent } from './login.component';
import { DashboardComponent } from './dashboard.component';
import { PlayersComponent } from './players.component';
import { ModsComponent } from './mods.component';
import { BackupsComponent } from './backups.component';
import { ConsoleComponent } from './console.component';
import { AdminComponent } from './admin.component';
import { SettingsComponent } from './settings.component';

type Tab = 'dashboard' | 'players' | 'mods' | 'settings' | 'backups' | 'console' | 'admin';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    LoginComponent,
    DashboardComponent,
    PlayersComponent,
    ModsComponent,
    BackupsComponent,
    ConsoleComponent,
    AdminComponent,
    SettingsComponent,
  ],
  template: `
    @if (authed() === null) {
      <div class="center muted">loading…</div>
    } @else if (authed() === false) {
      <app-login />
    } @else {
      <header class="topbar">
        <span class="brand">pal-up</span>
        <nav>
          @for (t of tabs; track t) {
            <button [class.active]="tab() === t" (click)="tab.set(t)">{{ t }}</button>
          }
        </nav>
        <button class="ghost" (click)="logout()">sign out</button>
      </header>
      <main>
        @switch (tab()) {
          @case ('dashboard') { <app-dashboard /> }
          @case ('players') { <app-players /> }
          @case ('mods') { <app-mods /> }
          @case ('settings') { <app-settings /> }
          @case ('backups') { <app-backups /> }
          @case ('console') { <app-console /> }
          @case ('admin') { <app-admin /> }
        }
      </main>
    }
  `,
})
export class AppComponent implements OnInit {
  private api = inject(Api);
  authed = authed;
  tab = signal<Tab>('dashboard');
  tabs: Tab[] = ['dashboard', 'players', 'mods', 'settings', 'backups', 'console', 'admin'];

  ngOnInit(): void {
    this.api.session().subscribe({
      next: (s) => authed.set(s.authenticated),
      error: () => authed.set(false),
    });
  }

  logout(): void {
    this.api.logout().subscribe({
      next: () => authed.set(false),
      error: () => authed.set(false),
    });
  }
}
