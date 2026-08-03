import { Component, OnInit, inject, signal } from '@angular/core';
import { Api, ModEntry, PakEntry, fmtBytes } from './api.service';

@Component({
  selector: 'app-mods',
  standalone: true,
  template: `
    <div class="card">
      <h2>Lua mods (UE4SS)</h2>
      <p class="muted">
        Loaded according to <code>mods.txt</code>. Toggles take effect on the next server restart.
        Add mods by dropping folders into <code>./mods</code> and restarting.
      </p>
      @if (mods().length === 0) {
        <p class="muted">No entries yet — the list appears after the first modded server start.</p>
      } @else {
        <table>
          <thead>
            <tr><th>Mod</th><th>Source</th><th>State</th><th></th></tr>
          </thead>
          <tbody>
            @for (m of mods(); track m.name) {
              <tr>
                <td>{{ m.name }}</td>
                <td><span class="tag">{{ m.user ? 'yours' : 'bundled' }}</span></td>
                <td>
                  <b [class]="m.enabled ? 'ok' : 'muted'">{{ m.enabled ? 'enabled' : 'disabled' }}</b>
                  @if (m.user && m.disabledMarker && m.enabled) {
                    <span class="muted"> (disables on restart)</span>
                  }
                  @if (m.user && !m.disabledMarker && !m.enabled) {
                    <span class="muted"> (enables on restart)</span>
                  }
                </td>
                <td class="actions">
                  @if (m.user) {
                    <button (click)="toggle(m)">
                      {{ m.disabledMarker ? 'enable' : 'disable' }}
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>

    <div class="card">
      <h2>LogicMods</h2>
      @if (logicmods().length === 0) {
        <p class="muted">None — drop <code>.pak</code> LogicMods into <code>./logicmods</code>.</p>
      } @else {
        <table>
          <tbody>
            @for (f of logicmods(); track f.name) {
              <tr><td>{{ f.name }}</td><td class="num">{{ size(f) }}</td></tr>
            }
          </tbody>
        </table>
      }
    </div>

    <div class="card">
      <h2>Loose .pak mods</h2>
      @if (paks().length === 0) {
        <p class="muted">None — drop <code>.pak</code> files into <code>./paks</code>.</p>
      } @else {
        <table>
          <tbody>
            @for (f of paks(); track f.name) {
              <tr><td>{{ f.name }}</td><td class="num">{{ size(f) }}</td></tr>
            }
          </tbody>
        </table>
      }
    </div>
    @if (feedback()) {
      <p class="muted">{{ feedback() }}</p>
    }
  `,
})
export class ModsComponent implements OnInit {
  private api = inject(Api);
  mods = signal<ModEntry[]>([]);
  logicmods = signal<PakEntry[]>([]);
  paks = signal<PakEntry[]>([]);
  feedback = signal('');

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.api.mods().subscribe({
      next: (r) => {
        this.mods.set(r.mods);
        this.logicmods.set(r.logicmods);
        this.paks.set(r.paks);
      },
      error: () => {},
    });
  }

  size(f: PakEntry): string {
    return fmtBytes(f.sizeBytes);
  }

  toggle(m: ModEntry): void {
    this.api.toggleMod(m.name, !m.disabledMarker).subscribe({
      next: (r) => {
        this.feedback.set(`${m.name}: ${r.note}`);
        this.refresh();
      },
      error: () => this.feedback.set('toggle failed'),
    });
  }
}
