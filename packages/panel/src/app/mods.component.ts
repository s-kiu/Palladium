import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Api, CollectionEntry, FrameworkMod, ModEntry, ModLogLine, PakEntry, ScriptModEntry, fmtBytes } from './api.service';

@Component({
  selector: 'app-mods',
  standalone: true,
  template: `
    <div class="card">
      <h2>Palladium mods</h2>
      <p class="muted">
        Loaded by Palladium inside the game from a <code>mod.lua</code> in <code>./mods</code>.
        Adding, removing or switching one takes a server restart — Palladium reads its list once,
        at boot. This list is what Palladium reported when it last started, plus anything on disk
        it has not seen yet.
      </p>
      @if (frameworkPending()) {
        <div class="banner info">
          Changes are waiting on a restart:
          {{ frameworkPending() }}. Restart the server from
          <b>Admin → Server actions</b> to apply them.
        </div>
      }
      @if (framework().length === 0) {
        <p class="muted">
          None — a mod folder with a <code>mod.lua</code> appears here after the next restart.
        </p>
      } @else {
        <table>
          <thead>
            <tr><th>Mod</th><th>Handles</th><th>Owns</th><th>Commands</th><th></th></tr>
          </thead>
          <tbody>
            @for (m of framework(); track m.name) {
              <tr>
                <td>
                  {{ m.name }} <span class="muted">{{ m.version }}</span>
                  @if (m.disabled) { <span class="tag warn-tag">disabled</span> }
                  @if (m.description) { <div class="muted">{{ m.description }}</div> }
                  @if (m.pending) { <div class="muted">installed — loads on the next server restart</div> }
                  @if (m.disabled && m.ok) {
                    <div class="muted">still running — stops at the next server restart</div>
                  }
                  @if (m.disabled && !m.ok && !m.pending) {
                    <div class="muted">not loaded, because it is switched off</div>
                  }
                  @if (!m.ok && !m.pending && !m.disabled) { <div class="error">{{ m.error }}</div> }
                  @for (w of m.warnings ?? []; track w) { <div class="error">{{ w }}</div> }
                </td>
                <td>
                  @for (e of m.events; track e) { <div><code>{{ e }}</code></div> }
                  @if (m.events.length === 0) { <span class="muted">nothing</span> }
                </td>
                <td>
                  @for (p of m.permissions; track p.node) {
                    <div><code>{{ p.node }}</code> <span class="muted">{{ p.default }}</span></div>
                  }
                  @if (m.permissions.length === 0) { <span class="muted">no permissions</span> }
                </td>
                <td>
                  @for (c of m.commands; track c) { <div><code>{{ c }}</code></div> }
                  @if (m.commands.length === 0) { <span class="muted">none</span> }
                </td>
                <td class="actions">
                  <button (click)="toggleFramework(m)">{{ m.disabled ? 'enable' : 'disable' }}</button>
                  <button (click)="showFrameworkLogs(m)">{{ logsFor() === m.name ? 'hide' : 'logs' }}</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      @if (logsFor() && logsSource() === 'agent') {
        <h3>{{ logsFor() }}</h3>
        <p class="muted small-note">
          What this mod wrote through <code>pal.log</code>, plus what Palladium said about it —
          read from the agent's own log inside the game, newest last.
        </p>
        @if (logLines().length === 0) {
          <p class="muted">Nothing logged since the server last started.</p>
        } @else {
          <pre class="logview small">{{ logText() }}</pre>
        }
      }
    </div>

    <div class="card">
      <h2>Stored data</h2>
      <p class="muted">
        Every collection Palladium and its mods declared. <b>data</b> lives in the agent's log and is
        edited here or through <code>data.*</code>; <b>config</b> is a file you can open and edit by
        hand.
      </p>
      @if (collections().length === 0) {
        <p class="muted">Nothing declared yet — collections appear once the agent has started.</p>
      } @else {
        <table>
          <thead>
            <tr><th>Collection</th><th>Holds</th><th>Records</th><th></th></tr>
          </thead>
          <tbody>
            @for (c of collections(); track c.name) {
              <tr>
                <td>
                  <code>{{ c.name }}</code>
                  @if (c.description) { <div class="muted">{{ c.description }}</div> }
                  @if (c.file) { <div class="muted">{{ c.file }}</div> }
                </td>
                <td>
                  @for (f of fieldsOf(c); track f) { <div><code>{{ f }}</code></div> }
                  @if (fieldsOf(c).length === 0) { <span class="muted">no declared shape</span> }
                </td>
                <td class="num">{{ c.count }}</td>
                <td class="actions">
                  <button (click)="showRecords(c)">{{ recordsFor() === c.name ? 'hide' : 'records' }}</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      @if (recordsFor()) {
        <h3>{{ recordsFor() }}</h3>
        @if (recordRows().length === 0) {
          <p class="muted">Empty.</p>
        } @else {
          <pre class="logview small">{{ recordText() }}</pre>
        }
      }
    </div>

    <div class="card">
      <h2>Script mods</h2>
      <p class="muted">
        Declared by a <code>mod.json</code> in <code>./mods</code> and run by the panel, so they
        start and stop without restarting the game server. Their permission nodes are registered
        from the manifest and appear on the permissions page.
      </p>
      @if (script().length === 0) {
        <p class="muted">
          None yet — a mod folder with a <code>mod.json</code> appears here within ten seconds.
        </p>
      } @else {
        <table>
          <thead>
            <tr><th>Mod</th><th>State</th><th>Owns</th><th></th></tr>
          </thead>
          <tbody>
            @for (m of script(); track m.name) {
              <tr>
                <td>
                  {{ m.name }} <span class="muted">{{ m.version }}</span>
                  @if (m.hasLua) { <span class="tag">+ Lua</span> }
                  @if (m.description) { <div class="muted">{{ m.description }}</div> }
                  @for (e of m.errors; track e) { <div class="error">{{ e }}</div> }
                </td>
                <td>
                  <b [class]="stateClass(m)">{{ m.state }}</b>
                  @if (m.note) { <div class="muted">{{ m.note }}</div> }
                  @if (m.restarts > 0) { <div class="muted">{{ m.restarts }} restart(s)</div> }
                </td>
                <td>
                  @for (p of m.permissions; track p.node) {
                    <div><code>{{ p.node }}</code> <span class="muted">{{ p.default }}</span></div>
                  }
                  @if (m.permissions.length === 0) { <span class="muted">no permissions</span> }
                </td>
                <td class="actions">
                  @if (m.entry) {
                    <button (click)="toggleScript(m)">{{ m.disabled ? 'enable' : 'disable' }}</button>
                    <button (click)="showLogs(m)">logs</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      @if (logsFor() && logsSource() !== 'agent') {
        <h3>{{ logsFor() }}</h3>
        @if (logLines().length === 0) {
          <p class="muted">Nothing logged yet.</p>
        } @else {
          <pre class="logview small">{{ logText() }}</pre>
        }
      }
    </div>

    <div class="card">
      <h2>Lua mods (UE4SS)</h2>
      <p class="muted">
        Loaded according to <code>mods.txt</code>. Toggles take effect on the next server restart.
        Add mods by dropping folders into <code>./mods</code> and restarting.
      </p>
      @if (framework().length > 0) {
        <p class="muted small-note">
          Palladium mods are not listed here and that is not a fault: a folder with a
          <code>mod.lua</code> is loaded by Palladium rather than by UE4SS, so it never enters
          <code>mods.txt</code>. {{ frameworkNames() }} {{ framework().length === 1 ? 'is' : 'are' }}
          under <b>Palladium mods</b> above. Only Palladium itself appears in both, because it is
          the UE4SS mod that loads the others.
        </p>
      }
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
export class ModsComponent implements OnInit, OnDestroy {
  private api = inject(Api);
  mods = signal<ModEntry[]>([]);
  framework = signal<FrameworkMod[]>([]);
  // Named rather than counted: an operator looking for a mod wants to see its
  // name in the sentence that explains where it went.
  // Named, not counted: an operator wants to know which mod is waiting.
  frameworkPending = computed(() => {
    const waiting = this.framework().filter((m) => m.pending || (m.disabled && m.ok));
    if (waiting.length === 0) return '';
    return waiting
      .map((m) => `${m.name} (${m.pending ? 'will load' : 'will stop'})`)
      .join(', ');
  });

  frameworkNames = computed(() => {
    const names = this.framework().map((m) => m.name);
    if (names.length <= 2) return names.join(' and ');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  });
  collections = signal<CollectionEntry[]>([]);
  recordsFor = signal('');
  recordRows = signal<[string, Record<string, unknown>][]>([]);
  script = signal<ScriptModEntry[]>([]);
  logicmods = signal<PakEntry[]>([]);
  paks = signal<PakEntry[]>([]);
  feedback = signal('');
  logsFor = signal('');
  logLines = signal<ModLogLine[]>([]);
  logsSource = signal<'panel' | 'agent'>('panel');
  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.refresh();
    // A script mod's state changes on its own — it can crash, back off and come
    // back — so the list is worth re-reading while the page is open.
    this.timer = setInterval(() => this.refresh(), 5000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  refresh(): void {
    this.api.mods().subscribe({
      next: (r) => {
        this.mods.set(r.mods);
        this.framework.set(r.framework.mods);
        this.collections.set(r.framework.collections ?? []);
        this.script.set(r.script);
        this.logicmods.set(r.logicmods);
        this.paks.set(r.paks);
      },
      error: () => {},
    });
    if (this.logsFor()) this.loadLogs(this.logsFor());
  }

  size(f: PakEntry): string {
    return fmtBytes(f.sizeBytes);
  }

  fieldsOf(c: CollectionEntry): string[] {
    return Object.entries(c.fields ?? {}).map(([k, v]) => `${k}: ${v}`).sort();
  }

  recordText(): string {
    return this.recordRows()
      .map(([id, fields]) => `${id}\n    ${Object.entries(fields)
        .map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join(', ') : v}`).join('\n    ')}`)
      .join('\n');
  }

  showRecords(c: CollectionEntry): void {
    if (this.recordsFor() === c.name) {
      this.recordsFor.set('');
      this.recordRows.set([]);
      return;
    }
    this.recordsFor.set(c.name);
    this.api.collectionRecords(c.name).subscribe({
      next: (r) => this.recordRows.set(Object.entries(r.data?.records ?? {})),
      error: () => this.recordRows.set([]),
    });
  }

  stateClass(m: ScriptModEntry): string {
    if (m.state === 'running') return 'ok';
    if (m.state === 'failed' || m.state === 'invalid') return 'error';
    return 'muted';
  }

  logText(): string {
    return this.logLines()
      .map((l) => {
        const when = l.at ? new Date(l.at).toISOString().slice(11, 19) : (l.clock ?? '--:--:--');
        return `${when} ${l.stream === 'err' ? '! ' : '  '}${l.text}`;
      })
      .join('\n');
  }

  showLogs(m: ScriptModEntry): void {
    if (this.logsFor() === m.name) {
      this.logsFor.set('');
      this.logLines.set([]);
      return;
    }
    this.logsFor.set(m.name);
    this.loadLogs(m.name);
  }

  showFrameworkLogs(m: FrameworkMod): void {
    if (this.logsFor() === m.name) {
      this.logsFor.set('');
      this.logLines.set([]);
      return;
    }
    this.logsFor.set(m.name);
    this.loadLogs(m.name);
  }

  private loadLogs(name: string): void {
    this.api.modLogs(name).subscribe({
      next: (r) => {
        this.logLines.set(r.lines);
        this.logsSource.set(r.source ?? 'panel');
      },
      error: () => {
        this.logLines.set([]);
        this.logsSource.set('panel');
      },
    });
  }

  // Palladium reads its load list once, at boot, so switching one is a
  // request rather than an act: the marker is written now and the mod starts
  // or stops at the next restart. Saying that in the same breath is the whole
  // point — a toggle that looks instant and is not would be worse than none.
  toggleFramework(m: FrameworkMod): void {
    this.api.toggleMod(m.name, !m.disabled).subscribe({
      next: () => {
        this.feedback.set(
          `${m.name} will ${m.disabled ? 'load' : 'stop'} at the next server restart.`,
        );
        this.refresh();
      },
      error: () => this.feedback.set(`could not switch ${m.name}`),
    });
  }

  toggleScript(m: ScriptModEntry): void {
    this.api.toggleMod(m.name, !m.disabled).subscribe({
      next: (r) => {
        this.feedback.set(`${m.name}: ${r.note}`);
        this.refresh();
      },
      error: () => this.feedback.set('toggle failed'),
    });
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
