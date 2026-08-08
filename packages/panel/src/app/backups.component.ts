import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Api, BackupEntry, fmtBytes } from './api.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-backups',
  standalone: true,
  imports: [IconComponent, DatePipe],
  template: `
    <div class="card">
      <div class="row spread">
        <h2>World backups</h2>
        <button (click)="create()" [disabled]="busy()">
          {{ busy() ? 'backing up…' : 'Back up now' }}
        </button>
      </div>
      <p class="muted">
        Snapshots of the whole world (saves + generated config). Restoring stops the server
        gracefully, snapshots the current world first, swaps in the backup, and starts again.
      </p>
      @if (backups().length === 0) {
        <p class="muted">No backups yet.</p>
      } @else {
        <table>
          <thead>
            <tr><th>Archive</th><th>Kind</th><th>Created</th><th>Size</th><th></th></tr>
          </thead>
          <tbody>
            @for (b of backups(); track b.name) {
              <tr>
                <td class="mono">{{ b.name }}</td>
                <td><span class="tag">{{ b.tag }}</span></td>
                <td>{{ b.mtime | date: 'yyyy-MM-dd HH:mm' }}</td>
                <td class="num">{{ size(b) }}</td>
                <td class="actions">
                  <button class="danger" (click)="restore(b)" title="Restore this snapshot"><app-icon name="restore" /><span class="btn-label">restore</span></button>
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
  `,
})
export class BackupsComponent implements OnInit {
  private api = inject(Api);
  backups = signal<BackupEntry[]>([]);
  busy = signal(false);
  feedback = signal('');

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.api.backups().subscribe({
      next: (r) => this.backups.set(r.backups),
      error: () => {},
    });
  }

  size(b: BackupEntry): string {
    return fmtBytes(b.sizeBytes);
  }

  create(): void {
    this.busy.set(true);
    this.feedback.set('');
    this.api.createBackup().subscribe({
      next: (r) => {
        this.busy.set(false);
        this.feedback.set(`created ${r.name}`);
        this.refresh();
      },
      error: (err) => {
        this.busy.set(false);
        this.feedback.set(err?.error?.error ?? 'backup failed');
      },
    });
  }

  restore(b: BackupEntry): void {
    if (
      !confirm(
        `Restore "${b.name}"?\n\nThe server shuts down (players get a 10 s warning), the CURRENT world is snapshotted as a pre-restore backup, the archive is restored, and the server starts again. Everyone online will be disconnected.`,
      )
    )
      return;
    this.api.restore(b.name).subscribe({
      next: (r) => this.feedback.set(r.note),
      error: () => this.feedback.set('could not schedule the restore'),
    });
  }
}
