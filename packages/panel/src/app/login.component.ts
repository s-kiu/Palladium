import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, authed } from './api.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="center">
      <form class="card login" (ngSubmit)="submit()">
        <h1>pal-up</h1>
        <p class="muted">Sign in with the server's admin password.</p>
        <input
          type="password"
          name="password"
          placeholder="admin password"
          [(ngModel)]="password"
          autocomplete="current-password"
          autofocus
        />
        <button type="submit" [disabled]="busy()">{{ busy() ? '…' : 'Sign in' }}</button>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
      </form>
    </div>
  `,
})
export class LoginComponent {
  private api = inject(Api);
  password = '';
  busy = signal(false);
  error = signal('');

  submit(): void {
    if (!this.password || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.login(this.password).subscribe({
      next: () => {
        this.busy.set(false);
        authed.set(true);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err?.error?.error ?? 'login failed');
      },
    });
  }
}
