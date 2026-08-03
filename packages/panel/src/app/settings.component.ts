import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, SettingEntry, SettingsEditorState } from './api.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (state(); as s) {
      @if (hasPendingRestart()) {
        <div class="banner info">
          Saved settings differ from what the server is running — they apply on the next restart.
          <button (click)="restart()">Restart now</button>
        </div>
      }

      <div class="card">
        <div class="row spread">
          <h2>Server settings</h2>
          <input placeholder="search settings…" [(ngModel)]="search" name="search" class="searchbox" />
        </div>
        <p class="muted">
          Values here override <code>.env</code> (each row shows where its current value comes
          from) and apply on the next server restart. Passwords and the admin API stay
          <code>.env</code>-only by design.
        </p>

        @for (group of groups(); track group) {
          @if (entriesFor(group).length > 0) {
            <h3 class="group-title">{{ group }}</h3>
            <table class="settings">
              <tbody>
                @for (e of entriesFor(group); track e.key) {
                  <tr [class.edited]="isEdited(e.key)">
                    <td class="setting-name">
                      {{ e.key }}
                      @if (e.overridden && !isEdited(e.key)) { <span class="tag">panel</span> }
                      @if (e.source === 'env' && !e.overridden) { <span class="tag">.env</span> }
                      @if (e.pending) { <span class="tag warn-tag">restart pending</span> }
                    </td>
                    <td class="setting-input">
                      @if (e.type === 'bool') {
                        <select
                          [ngModel]="displayValue(e)"
                          (ngModelChange)="edit(e, $event)"
                          [name]="e.key"
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      } @else {
                        <input
                          [ngModel]="displayValue(e)"
                          (ngModelChange)="edit(e, $event)"
                          [name]="e.key"
                          [placeholder]="e.default ?? ''"
                        />
                      }
                    </td>
                    <td class="actions">
                      @if (e.overridden && !isRemoval(e.key)) {
                        <button (click)="resetOverride(e)" title="remove the panel override">reset</button>
                      }
                      @if (isRemoval(e.key)) {
                        <span class="muted">reverts to {{ e.source === 'env' ? '.env' : 'default' }}</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        }
      </div>

      <div class="card">
        <h2>Advanced</h2>
        <p class="muted">
          Any other <code>PalWorldSettings.ini</code> key, passed through verbatim — for options
          not covered above.
        </p>
        @for (a of s.advanced; track a.key) {
          <div class="row">
            <code class="advanced-key">{{ a.key }}</code>
            <input [ngModel]="advValue(a)" (ngModelChange)="editAdvanced(a.key, $event)" [name]="'adv-' + a.key" />
            <button (click)="removeAdvanced(a.key)">remove</button>
          </div>
        }
        <div class="row">
          <input placeholder="IniKey" [(ngModel)]="newKey" name="newkey" class="mono short-key" />
          <input placeholder="value (verbatim)" [(ngModel)]="newValue" name="newval" />
          <button (click)="addAdvanced()" [disabled]="!newKey">add</button>
        </div>
      </div>

      <div class="card apply-bar">
        <div class="row spread">
          <span [class]="changeCount() > 0 ? '' : 'muted'">
            {{ changeCount() > 0 ? changeCount() + ' unsaved change(s)' : 'no unsaved changes' }}
          </span>
          <div class="row">
            <button (click)="discard()" [disabled]="changeCount() === 0">Discard</button>
            <button class="primary" (click)="review()" [disabled]="changeCount() === 0 || busy()">
              Review & save
            </button>
          </div>
        </div>
        @if (feedback()) {
          <p class="muted small-note">{{ feedback() }}</p>
        }
      </div>
    } @else {
      <div class="center muted">loading settings…</div>
    }
  `,
})
export class SettingsComponent implements OnInit {
  private api = inject(Api);
  state = signal<SettingsEditorState | null>(null);
  edits = signal<Record<string, string | null>>({});
  feedback = signal('');
  busy = signal(false);
  search = '';
  newKey = '';
  newValue = '';

  groups = computed(() => {
    const seen: string[] = [];
    for (const e of this.state()?.editable ?? []) {
      if (!seen.includes(e.group)) seen.push(e.group);
    }
    return seen;
  });

  hasPendingRestart = computed(() => (this.state()?.editable ?? []).some((e) => e.pending));

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.api.settingsEditor().subscribe({
      next: (s) => this.state.set(s),
      error: () => this.feedback.set('could not load settings'),
    });
  }

  entriesFor(group: string): SettingEntry[] {
    const q = this.search.trim().toLowerCase();
    return (this.state()?.editable ?? []).filter(
      (e) =>
        e.group === group &&
        (!q || e.key.toLowerCase().includes(q) || e.envName.toLowerCase().includes(q)),
    );
  }

  isEdited(key: string): boolean {
    return key in this.edits();
  }
  isRemoval(key: string): boolean {
    return this.edits()[key] === null;
  }

  displayValue(e: SettingEntry): string {
    const pending = this.edits()[e.key];
    if (pending === null) return '';
    return pending !== undefined ? pending : e.value;
  }

  edit(e: SettingEntry, value: string): void {
    const next = { ...this.edits() };
    if (value === e.value) delete next[e.key];
    else next[e.key] = value;
    this.edits.set(next);
  }

  resetOverride(e: SettingEntry): void {
    this.edits.set({ ...this.edits(), [e.key]: null });
  }

  advValue(a: { key: string; value: string }): string {
    const pending = this.edits()[a.key];
    return pending !== undefined && pending !== null ? pending : a.value;
  }
  editAdvanced(key: string, value: string): void {
    this.edits.set({ ...this.edits(), [key]: value });
  }
  removeAdvanced(key: string): void {
    this.edits.set({ ...this.edits(), [key]: null });
  }
  addAdvanced(): void {
    const key = this.newKey.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      this.feedback.set('keys are letters, digits and underscores, starting with a letter');
      return;
    }
    this.edits.set({ ...this.edits(), [key]: this.newValue });
    this.newKey = '';
    this.newValue = '';
  }

  changeCount(): number {
    return Object.keys(this.edits()).length;
  }

  discard(): void {
    this.edits.set({});
    this.feedback.set('');
  }

  review(): void {
    const s = this.state();
    if (!s) return;
    const byKey = new Map(s.editable.map((e) => [e.key, e]));
    const lines = Object.entries(this.edits()).map(([key, value]) => {
      const cur = byKey.get(key)?.value ?? s.advanced.find((a) => a.key === key)?.value ?? '(unset)';
      return value === null ? `${key}: remove override (was ${cur})` : `${key}: ${cur} → ${value}`;
    });
    if (!confirm(`Apply ${lines.length} change(s)?\n\n${lines.join('\n')}\n\nThey take effect on the next server restart.`)) {
      return;
    }
    this.busy.set(true);
    this.api.saveSettings(this.edits()).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.state.set(updated);
        this.edits.set({});
        this.feedback.set('saved — restart the server to apply');
      },
      error: (err) => {
        this.busy.set(false);
        this.feedback.set(err?.error?.error ?? 'save failed');
      },
    });
  }

  restart(): void {
    if (!confirm('Restart the server now to apply the saved settings? Players get a 10 s warning.')) return;
    this.api.lifecycle('restart', { waittime: 10, message: 'Applying settings' }).subscribe({
      next: (r) => this.feedback.set(r.note),
      error: () => this.feedback.set('restart failed — server offline?'),
    });
  }
}
