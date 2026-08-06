import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Api,
  BridgeCapability,
  BridgeEvent,
  BridgePlayer,
  BridgeSchema,
} from './api.service';

// The tab a capability appears under is the manifest's `group`, so a new
// capability lands in the right place without a change here.
type Group = 'pals' | 'player' | 'world' | 'permissions' | 'agent';

// One option shape feeds every picker: players, items, pal species, traits.
interface PickOption {
  value: string;
  label: string;
  sub?: string;
  tier?: number;
  online?: boolean;
  element?: string[] | null;
  variant?: string;
  seenMin?: number;
  seenMax?: number;
  unlisted?: boolean;
}

// The bridge page renders the schema, not a hand-kept list: every hook row,
// filter chip, action form and picker below comes from what the manifest
// declares and the agent reports live. A capability added to the manifest
// appears here — form, target field and pickers included — with no change to
// this file.
@Component({
  selector: 'app-bridge',
  standalone: true,
  imports: [FormsModule],
  template: `
    <nav class="subnav">
      @for (t of TABS; track t.key) {
        <button [class.active]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button>
      }
    </nav>

    <div class="card">
      <div class="row spread">
        <h2>Events</h2>
        <span class="tag">{{ shown().length }} of {{ events().length }}</span>
      </div>
      <p class="muted">
        Live stream for this server run, refreshed every 2 seconds. Click a type to narrow the
        view. Action results travel the same stream as the <code>result</code> kind.
      </p>
      <div class="row wrap chips">
        <button class="chip" [class.on]="!filter().size" (click)="clearFilter()">all</button>
        @for (t of types(); track t) {
          <button class="chip" [class.on]="filter().has(t)" (click)="toggle(t)">{{ t }}</button>
        }
      </div>
      <div class="logview small chatlog">
        @for (e of shown(); track $index) {
          <div class="chatline">
            <span class="chat-time">{{ time(e.at) }}</span>
            <span class="evt-type" [attr.data-type]="chipOf(e)">{{ chipOf(e) }}</span>
            <span class="chat-text">{{ summary(e) }}</span>
          </div>
        } @empty {
          <span class="muted">{{ placeholder() }}</span>
        }
      </div>
    </div>

    @if (tab() === 'agent') {
    <div class="card">
      <div class="row spread">
        <h2>Agent</h2>
        <span class="tag">{{ agentLabel() }}</span>
      </div>
      <p class="muted">
        Engine hooks the mod registered on this server run. A hook that fails costs its own
        event type and nothing else — the rest keep working.
      </p>
      <table>
        <thead>
          <tr><th>Event</th><th>Source</th><th>Stability</th><th>Status</th></tr>
        </thead>
        <tbody>
          @for (c of eventCaps(); track c.type) {
            <tr>
              <td class="mono">{{ c.type }}</td>
              <td class="mono">{{ c.source?.hook ?? c.runtime }}</td>
              <td><span class="tag" [class.warn-tag]="c.stability !== 'stable'">{{ c.stability }}</span></td>
              <td><span class="tag" [class.warn-tag]="!c.live">{{ c.live ? 'live' : 'not registered' }}</span></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    }

    @if (tab() === 'player') {
    <div class="card">
      <div class="row spread">
        <h2>Players</h2>
        <span class="tag">{{ players().length }} known</span>
      </div>
      <p class="muted">Every id the bridge has seen, kept in the panel's database across restarts.</p>
      <table>
        <thead>
          <tr><th>Name</th><th>User id</th><th class="num">Joins</th><th class="num">First seen</th><th class="num">Last seen</th><th>Tags</th><th></th></tr>
        </thead>
        <tbody>
          @for (p of players(); track p.userid) {
            <tr>
              <td>{{ p.name }} @if (p.online) { <span class="tag">online</span> }</td>
              <td class="mono">{{ p.userid }}</td>
              <td class="num">{{ p.joins }}</td>
              <td class="num">{{ date(p.firstSeen) }}</td>
              <td class="num">{{ date(p.lastSeen) }}</td>
              <td class="mono small-tags">{{ tagText(p) }}</td>
              <td class="actions">
                <button (click)="openStats('player', p.userid, p.name)" [disabled]="!p.online">Stats</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="muted">Nobody has connected while the bridge was running yet.</td></tr>
          }
        </tbody>
      </table>
    </div>
    }

    @if (tab() === 'pals') {
    <div class="card">
      <div class="row spread">
        <h2>Pals in the world</h2>
        <div class="row">
          <span class="tag">{{ worldPals().length }} loaded</span>
          <button (click)="refreshWorldPals()" [disabled]="palsLoading()">Refresh</button>
        </div>
      </div>
      <p class="muted">
        Pals currently loaded near players — spawned ones included. Ids come from the engine, so
        a pal you just spawned is editable straight away.
      </p>
      <table>
        <thead>
          <tr><th>Species</th><th class="num">Level</th><th>Id</th><th></th></tr>
        </thead>
        <tbody>
          @for (p of worldPals(); track p.id) {
            <tr>
              <td>{{ p.species }} @if (p.rare) { <span class="tag">rare</span> }</td>
              <td class="num">{{ p.level }}</td>
              <td class="mono">{{ p.id || '—' }}</td>
              <td class="actions">
                <button (click)="inspectPal(p.id)" [disabled]="!p.id">Inspect</button>
                <button (click)="openStats('pal', p.id, p.species)" [disabled]="!p.id">Stats</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="muted">{{ palsNote() }}</td></tr>
          }
        </tbody>
      </table>
      @if (inspected(); as rows) {
        <p class="small-note">
          Inspect a wild pal and a spawned one — the row that differs is why one fights back.
          “Hate system” only says the machinery is present, not that the pal hates anyone.
        </p>
        <table>
          <thead><tr><th>Pal</th><th>Controller</th><th>Owner</th><th>Otomo</th><th>Spawn type</th><th>Hate system</th></tr></thead>
          <tbody>
            @for (r of rows; track r.pal) {
              <tr>
                <td>{{ r.species }}</td>
                <td class="mono">{{ r.controller }}</td>
                <td class="mono">{{ r.owner }}</td>
                <td>{{ r.isOtomo ? 'yes' : 'no' }}</td>
                <td class="num">{{ r.spawnedType ?? '—' }}</td>
                <td>{{ r.hateSystem ? 'present' : 'none' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
    }

    @if (tab() === 'permissions') {
    <div class="card">
      <h2>Permissions</h2>
      <p class="muted">
        The raw calls behind the permissions page: nodes, groups and per-player overrides.
        Editing them as a list of forms is the exception — the
        <b>permissions</b> tab above does the same work with the state in view.
      </p>
    </div>
    }

    <div class="card">
      <div class="row spread">
        <h2>{{ actionsTitle() }}</h2>
        <span class="tag">POST /api/bridge/call</span>
      </div>
      <p class="muted">
        One form per capability the schema declares — nothing here is hand-written per action.
        The same calls work from any language with an API token (admin page).
      </p>
      @for (c of visibleActions(); track c.type) {
        <div class="action-row">
          <div class="row wrap">
            <span class="mono action-name">{{ c.type }}</span>
            <span class="tag" [class.warn-tag]="c.stability !== 'stable'">{{ c.stability }}</span>
            <span class="spacer"></span>
            <button class="primary" (click)="run(c)" [disabled]="busy() || !c.live">Run</button>
          </div>
          <p class="muted small-note">{{ c.summary }}</p>
          <div class="row wrap">
            @if (c.target === 'player') {
              <span class="pickwrap">
                <input
                  [(ngModel)]="targets[c.type]"
                  [name]="c.type + '.target'"
                  [placeholder]="c.targetOptional ? 'target player (optional)' : 'target player (required)'"
                />
                <button class="pickbtn" title="pick a player" (click)="openPlayerPicker(c.type)">☰</button>
              </span>
            }
            @for (p of paramList(c); track p.name) {
              @if (p.spec.type === 'bool') {
                <label class="follow">
                  <input
                    type="checkbox"
                    [(ngModel)]="boolInputs[c.type + '.' + p.name]"
                    [name]="c.type + '.' + p.name"
                  />
                  {{ p.name }}
                </label>
              } @else if (p.spec.picker === 'location') {
                <span class="pickwrap">
                  <input
                    class="short"
                    type="number"
                    [(ngModel)]="inputs[c.type + '.' + p.name]"
                    [name]="c.type + '.' + p.name"
                    [placeholder]="placeholderFor(p)"
                  />
                  <button class="pickbtn" title="pick a saved location" (click)="openLocationPicker(c.type)">☰</button>
                </span>
              } @else if (p.spec.picker) {
                <span class="pickwrap">
                  <input
                    [(ngModel)]="inputs[c.type + '.' + p.name]"
                    [name]="c.type + '.' + p.name"
                    [placeholder]="placeholderFor(p)"
                  />
                  <button class="pickbtn" title="pick from the list" (click)="openCatalogPicker(p.spec.picker!, c.type + '.' + p.name)">☰</button>
                </span>
              } @else {
                <input
                  [class.short]="p.spec.type === 'int' || p.spec.type === 'number'"
                  [type]="p.spec.type === 'int' || p.spec.type === 'number' ? 'number' : 'text'"
                  [(ngModel)]="inputs[c.type + '.' + p.name]"
                  [name]="c.type + '.' + p.name"
                  [placeholder]="placeholderFor(p)"
                />
              }
            }
          </div>
          @if (results[c.type]; as r) {
            <p class="small-note mono" [class.muted]="!r.startsWith('failed')" [class.err]="r.startsWith('failed')">{{ r }}</p>
          }
        </div>
      }
    </div>

    <div class="card">
      <details>
        <summary class="getting-started-summary">
          <b>Build on this server</b>
          <span class="muted"> — events in, actions out, from any language. Click for the 3-step setup.</span>
        </summary>
        <ol class="getting-started">
          <li>
            Create an API token on the <b>admin</b> page (read for feeds, read+write for bots
            that act), and send it as <code>Authorization: Bearer palup_…</code>.
          </li>
          <li>
            Follow events by cursor — new events arrive with a growing <code>cursor</code>,
            and a smaller one means the server rebooted:
            <pre class="mono">curl -H "Authorization: Bearer $TOKEN" \
  "http://this-host:3000/api/bridge/events?since=0&amp;type=player.join,player.chat"</pre>
          </li>
          <li>
            Act through one verb — every form on this page is exactly this call:
            <pre class="mono">curl -H "Authorization: Bearer $TOKEN" -X POST http://this-host:3000/api/bridge/call \
  -H "content-type: application/json" \
  -d '{{ '{' }}"type":"player.give_item","target":"&lt;player id&gt;","data":{{ '{' }}"item":"PalSphere","count":5{{ '}' }}{{ '}' }}'</pre>
          </li>
        </ol>
        <p class="muted small-note">
          <code>GET /api/bridge/schema</code> lists every capability with parameters and live
          state. Full contract:
          <a href="https://github.com/s-kiu/pal-up/blob/main/docs/bridge.md" target="_blank" rel="noopener">docs/bridge.md</a> ·
          <a href="https://github.com/s-kiu/pal-up/blob/main/docs/bridge-reference.md" target="_blank" rel="noopener">capability reference</a> ·
          <a href="https://github.com/s-kiu/pal-up/tree/main/examples/bridge" target="_blank" rel="noopener">runnable examples</a>
        </p>
      </details>
    </div>

    <dialog #statsDlg class="dlg picker-dlg">
      <div class="row spread">
        <h2>{{ statsTitle() }}</h2>
        <button class="ghost" (click)="closeStats()">✕</button>
      </div>
      @if (statsLoading()) {
        <p class="muted">reading…</p>
      } @else {
        <p class="muted small-note">
          Editable fields apply on save; blank means leave alone. A stat this build does not
          expose reads as <code>—</code> and cannot be set.
        </p>
        <table>
          <thead><tr><th>Stat</th><th class="num">Current</th><th>Set to</th></tr></thead>
          <tbody>
            @for (f of statFields(); track f.key) {
              <tr>
                <td>{{ f.label }}</td>
                <td class="num">{{ display(f.key) }}</td>
                <td>
                  @if (f.editable) {
                    <input
                      type="number"
                      [(ngModel)]="statsEdit[f.key]"
                      [name]="'stat-' + f.key"
                      [placeholder]="f.hint"
                    />
                  } @else {
                    <span class="muted small-note">read-only</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (statsTarget()?.kind === 'player') {
          <h2 class="drawer-heading">Status points</h2>
          <p class="muted small-note">
            What the game computes a player's max HP, stamina, attack and carry weight from —
            the player equivalent of a pal's IVs. Points are spent, so these add. This build
            exposes no way to read the allocation back, so both spellings the game uses are
            listed: spend on one and the result names the stat that moved.
          </p>
          @if (statusPoints().length) {
            <table>
              <thead><tr><th>Stat</th><th class="num">Spent</th><th>Add</th></tr></thead>
              <tbody>
                @for (s of statusPoints(); track s.name) {
                  <tr>
                    <td class="mono">{{ s.name }}</td>
                    <td class="num">{{ s.value ?? '—' }}</td>
                    <td class="actions">
                      <input
                        class="short"
                        type="number"
                        [(ngModel)]="statusEdit[s.name]"
                        [name]="'point-' + s.name"
                        placeholder="+"
                      />
                      <button (click)="spendPoints(s.name)" [disabled]="statsSaving()">Spend</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="small-note mono muted">{{ statusNote() }}</p>
          }
        }
        @if (statsResult()) {
          <p class="small-note mono" [class.err]="statsFailed()" [class.muted]="!statsFailed()">{{ statsResult() }}</p>
        }
        <div class="row dlg-actions">
          <button (click)="closeStats()">Close</button>
          <button class="primary" (click)="saveStats()" [disabled]="statsSaving()">Save changes</button>
        </div>
      }
    </dialog>

    <dialog #pickerDlg class="dlg picker-dlg">
      <div class="row spread">
        <h2>{{ pickerTitle() }}</h2>
        <button class="ghost" (click)="closePicker()">✕</button>
      </div>
      <input
        [(ngModel)]="pickerSearch"
        name="picker-search"
        placeholder="type to search…"
        (ngModelChange)="pickerQuery.set($event)"
        autocomplete="off"
      />
      @if (pickerKind() === 'pal') {
        <div class="row wrap chips">
          <button class="chip" [class.on]="!palElement()" (click)="palElement.set(null)">any element</button>
          @for (el of PAL_ELEMENTS; track el) {
            <button class="chip" [class.on]="palElement() === el" (click)="palElement.set(el)">
              @if (el !== 'unknown') { <span class="el-dot el-{{ el.toLowerCase() }}"></span> }
              {{ el }}
            </button>
          }
        </div>
        <div class="row wrap pal-filters">
          <select [(ngModel)]="palVariant" name="pal-variant" (ngModelChange)="palVariantSig.set($event)">
            <option value="all">all variants</option>
            @for (v of PAL_VARIANTS; track v) { <option [value]="v">{{ v }}</option> }
          </select>
          <input
            class="short"
            type="number"
            min="1"
            max="100"
            [(ngModel)]="palLevel"
            name="pal-level"
            placeholder="level"
            (ngModelChange)="setPalLevel($event)"
          />
          <button class="chip" [class.on]="palSeenOnly()" (click)="palSeenOnly.set(!palSeenOnly())">
            seen on this server
          </button>
          <span class="muted small-note">level and “seen” come from spawns observed here — a modded mob appears once one has spawned</span>
        </div>
      }
      <div class="pick-list">
        @for (o of pickerShown(); track o.value) {
          <button
            class="pick-item"
            [class.picked]="pickerChosen().has(o.value)"
            (click)="choose(o)"
          >
            <span class="pick-label">
              @if (o.tier !== undefined) { <span class="tier-dot tier-{{ tierClass(o.tier) }}"></span> }
              @for (el of o.element ?? []; track el) { <span class="el-dot el-{{ el.toLowerCase() }}" [title]="el"></span> }
              {{ o.label }}
              @if (o.unlisted) { <span class="tag warn-tag">unlisted</span> }
              @if (o.online) { <span class="tag">online</span> }
              @if (pickerChosen().has(o.value)) { <span class="tag">selected</span> }
            </span>
            <span class="pick-sub">{{ o.sub }}</span>
          </button>
        } @empty {
          <p class="muted">nothing matches</p>
        }
        @if (pickerTruncated()) {
          <p class="muted small-note">…{{ pickerTruncated() }} more — keep typing to narrow.</p>
        }
      </div>
      @if (pickerMulti()) {
        <div class="row dlg-actions">
          <button (click)="closePicker()">Cancel</button>
          <button class="primary" (click)="applyMulti()">Use {{ pickerChosen().size }} selected</button>
        </div>
      }
    </dialog>
  `,
})
export class BridgeComponent implements OnInit, OnDestroy {
  private api = inject(Api);
  @ViewChild('pickerDlg') pickerDlg?: ElementRef<HTMLDialogElement>;
  @ViewChild('statsDlg') statsDlg?: ElementRef<HTMLDialogElement>;

  readonly TABS: { key: Group; label: string }[] = [
    { key: 'pals', label: 'Pals' },
    { key: 'player', label: 'Player' },
    { key: 'world', label: 'World' },
    { key: 'permissions', label: 'Permissions' },
    { key: 'agent', label: 'Agent' },
  ];
  tab = signal<Group>('pals');

  schema = signal<BridgeSchema | null>(null);
  events = signal<BridgeEvent[]>([]);
  players = signal<BridgePlayer[]>([]);
  filter = signal<Set<string>>(new Set());
  placeholder = signal('loading events…');
  busy = signal(false);

  inputs: Record<string, string> = {};
  boolInputs: Record<string, boolean> = {};
  targets: Record<string, string> = {};
  results: Record<string, string> = {};

  private catalogs: {
    item: PickOption[];
    pal: PickOption[];
    traits: PickOption[];
  } = { item: [], pal: [], traits: [] };

  // ── picker state ───────────────────────────────────────────────────────────
  pickerTitle = signal('');
  pickerKind = signal('');
  pickerQuery = signal('');
  pickerSearch = '';
  pickerMulti = signal(false);
  readonly PAL_ELEMENTS = ['Neutral', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Ground', 'Dark', 'Dragon', 'unknown'];
  readonly PAL_VARIANTS = ['normal', 'boss', 'raid', 'gym', 'predator', 'summon'];
  palElement = signal<string | null>(null);
  palVariant = 'all';
  palVariantSig = signal('all');
  palLevel = '';
  palLevelSig = signal('');
  palSeenOnly = signal(false);
  pickerChosen = signal<Set<string>>(new Set());
  private pickerOptions = signal<PickOption[]>([]);
  private pickerWrite: (value: string) => void = () => {};
  private static readonly PICKER_PAGE = 150;

  pickerFiltered = computed(() => {
    const q = this.pickerQuery().toLowerCase().trim();
    let all = this.pickerOptions();
    if (this.pickerKind() === 'pal') {
      const el = this.palElement();
      if (el === 'unknown') all = all.filter((o) => !o.element?.length);
      else if (el) all = all.filter((o) => o.element?.includes(el));
      const variant = this.palVariantSig();
      if (variant !== 'all') all = all.filter((o) => o.variant === variant);
      if (this.palSeenOnly()) all = all.filter((o) => o.seenMin !== undefined);
      const lv = Number(this.palLevelSig());
      if (this.palLevelSig() !== '' && Number.isFinite(lv)) {
        all = all.filter((o) => o.seenMin !== undefined && lv >= o.seenMin! && lv <= (o.seenMax ?? o.seenMin!));
      }
    }
    if (!q) return all;
    return all.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.sub ?? '').toLowerCase().includes(q),
    );
  });
  pickerShown = computed(() => this.pickerFiltered().slice(0, BridgeComponent.PICKER_PAGE));
  pickerTruncated = computed(() =>
    Math.max(0, this.pickerFiltered().length - BridgeComponent.PICKER_PAGE),
  );

  private cursor = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private static readonly KEEP = 500;

  // ── stats drawer ───────────────────────────────────────────────────────────
  // hp is the one stat the engine takes as a fraction; the drawer works in
  // absolute HP like the player sees it and converts on save.
  // IVs, star rank and souls are pal stats: a player character carries the same
  // save fields but the game never reads them, so the drawer does not offer
  // them for a player — status points are what a player has instead.
  readonly STAT_FIELDS = [
    { key: 'hp', label: 'HP', editable: true, hint: 'absolute', only: '' },
    { key: 'maxHp', label: 'Max HP', editable: true, hint: 'computed by the game', only: '' },
    { key: 'hunger', label: 'Hunger', editable: true, hint: 'absolute', only: '' },
    { key: 'maxHunger', label: 'Max hunger', editable: false, hint: '', only: '' },
    { key: 'shield', label: 'Shield', editable: true, hint: 'absolute', only: '' },
    { key: 'maxShield', label: 'Max shield', editable: true, hint: 'absolute', only: '' },
    { key: 'sanity', label: 'Sanity', editable: false, hint: '', only: '' },
    { key: 'level', label: 'Level', editable: true, hint: '1-100', only: '' },
    { key: 'rank', label: 'Star rank', editable: true, hint: '1-5', only: 'pal' },
    { key: 'talentMelee', label: 'Attack (melee IV)', editable: true, hint: '0-100', only: 'pal' },
    { key: 'talentShot', label: 'Attack (ranged IV)', editable: true, hint: '0-100', only: 'pal' },
    { key: 'talentDefense', label: 'Defense IV', editable: true, hint: '0-100', only: 'pal' },
    { key: 'talentHp', label: 'HP IV', editable: true, hint: '0-100', only: 'pal' },
    { key: 'rankAttack', label: 'Attack souls', editable: true, hint: '0-10', only: 'pal' },
    { key: 'rankDefence', label: 'Defense souls', editable: true, hint: '0-10', only: 'pal' },
    { key: 'rankCraftSpeed', label: 'Work speed souls', editable: true, hint: '0-10', only: 'pal' },
    { key: 'craftSpeed', label: 'Work speed', editable: false, hint: '', only: 'pal' },
  ];

  statFields = computed(() => {
    const kind = this.statsTarget()?.kind;
    return this.STAT_FIELDS.filter((f) => !f.only || f.only === kind);
  });

  worldPals = signal<{ id: string; species: string; level: number; rare: boolean }[]>([]);
  palsLoading = signal(false);
  palsNote = signal('Press Refresh to read the world.');
  statsTarget = signal<{ kind: 'player' | 'pal'; id: string; name: string } | null>(null);
  statsValues = signal<Record<string, number | null>>({});
  statsLoading = signal(false);
  statsSaving = signal(false);
  statsResult = signal('');
  statsFailed = signal(false);
  statsEdit: Record<string, string> = {};
  statusPoints = signal<{ name: string; value: number | null }[]>([]);
  statusNote = signal('');
  statusEdit: Record<string, string> = {};

  statsTitle = computed(() => {
    const t = this.statsTarget();
    return t ? `${t.name} — stats` : 'Stats';
  });

  display(key: string): string {
    const v = this.statsValues()[key];
    return v === null || v === undefined ? '—' : String(Math.round(v * 100) / 100);
  }

  inspected = signal<Record<string, unknown>[] | null>(null);

  inspectPal(id: string): void {
    this.api.bridgeCall('pal.inspect', null, { pal: id }).subscribe({
      next: (r) => {
        if (!r.ok) return;
        this.inspected.update((prev) => {
          const rows = (prev ?? []).filter((x) => x['pal'] !== r.data['pal']);
          return [...rows, r.data];
        });
      },
      error: () => {},
    });
  }

  refreshWorldPals(): void {
    this.palsLoading.set(true);
    this.api.bridgeCall('pal.list', null, {}).subscribe({
      next: (r) => {
        this.palsLoading.set(false);
        const pals = (r.data['pals'] as { id: string; species: string; level: number; rare: boolean }[]) ?? [];
        this.worldPals.set(pals);
        this.palsNote.set(
          r.ok ? 'No pals loaded — nobody is near anything right now.' : `failed (${r.error ?? ''})`,
        );
      },
      error: () => {
        this.palsLoading.set(false);
        this.palsNote.set('failed — is the agent loaded?');
      },
    });
  }

  openStats(kind: 'player' | 'pal', id: string, name: string): void {
    this.statsTarget.set({ kind, id, name });
    this.statsValues.set({});
    this.statsEdit = {};
    this.statsResult.set('');
    this.statsLoading.set(true);
    this.statsDlg?.nativeElement.showModal();
    const call = kind === 'player'
      ? this.api.bridgeCall('player.stats', id, {})
      : this.api.bridgeCall('pal.stats', null, { pal: id });
    call.subscribe({
      next: (r) => {
        this.statsLoading.set(false);
        if (!r.ok) {
          this.statsFailed.set(true);
          this.statsResult.set(`failed (${r.error ?? 'unknown'})`);
          return;
        }
        this.statsValues.set((r.data['stats'] as Record<string, number | null>) ?? {});
      },
      error: () => {
        this.statsLoading.set(false);
        this.statsFailed.set(true);
        this.statsResult.set('failed — no answer from the game');
      },
    });
    if (kind === 'player') this.refreshStatusPoints(id);
  }

  private refreshStatusPoints(id: string): void {
    this.statusPoints.set([]);
    this.statusNote.set('reading…');
    this.statusEdit = {};
    this.api.bridgeCall('player.status_points', id, {}).subscribe({
      next: (r) => {
        if (!r.ok) {
          // The error carries what the build does declare, which is the whole
          // diagnostic — show it rather than a generic failure.
          this.statusNote.set(r.error ?? 'not available on this build');
          return;
        }
        // With no reader on this build the spent counts are unknown, but the
        // names are still spendable — so the rows come from those.
        const points = (r.data['points'] as Record<string, number>) ?? {};
        const names = (r.data['names'] as string[]) ?? Object.keys(points);
        this.statusPoints.set(names.map((name) => ({ name, value: points[name] ?? null })));
        if (!this.statusPoints().length) this.statusNote.set('no status points reported');
      },
      error: () => this.statusNote.set('no answer from the game'),
    });
  }

  spendPoints(stat: string): void {
    const target = this.statsTarget();
    const points = Number(this.text(this.statusEdit[stat]));
    if (!target || !Number.isFinite(points) || points < 1) return;
    this.statsSaving.set(true);
    this.api.bridgeCall('player.status_point', target.id, { stat, points }).subscribe({
      next: (r) => {
        this.statsSaving.set(false);
        this.statsFailed.set(!r.ok);
        this.statsResult.set(
          r.ok
            ? `${stat}: +${points} via ${r.data['via']}` +
              (r.data['verified'] ? ` — ${r.data['changed'] || 'spent'} changed` : ' — nothing moved, try another name')
            : `failed (${r.error ?? 'unknown'})`,
        );
        if (r.ok) {
          this.statusEdit[stat] = '';
          this.statsValues.set((r.data['stats'] as Record<string, number | null>) ?? this.statsValues());
          this.refreshStatusPoints(target.id);
        }
      },
      error: (err) => {
        this.statsSaving.set(false);
        this.statsFailed.set(true);
        this.statsResult.set(`failed (${err?.error?.error ?? 'no answer'})`);
      },
    });
  }

  closeStats(): void {
    this.statsDlg?.nativeElement.close();
  }

  // The agent reads every write back, so a save has three outcomes to report,
  // not one: what moved, what the engine took without moving, what it refused.
  private statsOutcome(data: Record<string, unknown>): string {
    const parts = [`applied: ${data['applied'] || 'nothing'}`];
    if (data['unverified']) parts.push(`no visible change: ${data['unverified']}`);
    if (data['failed']) parts.push(`refused: ${data['failed']}`);
    if (data['detail']) parts.push(String(data['detail']));
    return parts.join(' · ');
  }

  saveStats(): void {
    const target = this.statsTarget();
    if (!target) return;
    const data: Record<string, unknown> = {};
    for (const field of this.statFields()) {
      if (!field.editable) continue;
      const raw = this.text(this.statsEdit[field.key]);
      if (raw === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      data[field.key] = value;
    }
    if (!Object.keys(data).length) {
      this.statsFailed.set(true);
      this.statsResult.set('nothing to change');
      return;
    }
    this.statsSaving.set(true);
    const call = target.kind === 'player'
      ? this.api.bridgeCall('player.set_stats', target.id, data)
      : this.api.bridgeCall('pal.set_stats', null, { pal: target.id, ...data });
    call.subscribe({
      next: (r) => {
        this.statsSaving.set(false);
        this.statsFailed.set(!r.ok);
        this.statsResult.set(r.ok ? this.statsOutcome(r.data) : `failed (${r.error ?? 'unknown'})`);
        if (r.ok) {
          this.statsValues.set((r.data['stats'] as Record<string, number | null>) ?? this.statsValues());
          this.statsEdit = {};
        }
      },
      error: (err) => {
        this.statsSaving.set(false);
        this.statsFailed.set(true);
        this.statsResult.set(`failed (${err?.error?.error ?? 'no answer'})`);
      },
    });
  }

  eventCaps = computed(() =>
    (this.schema()?.capabilities ?? []).filter((c) => c.kind === 'event'),
  );
  actionCaps = computed(() =>
    (this.schema()?.capabilities ?? []).filter((c) => c.kind !== 'event'),
  );
  visibleActions = computed(() => this.actionCaps().filter((c) => this.groupOf(c) === this.tab()));
  actionsTitle = computed(() => {
    const label = this.TABS.find((t) => t.key === this.tab())?.label ?? '';
    return `${label} — send to the game`;
  });

  // The manifest decides the tab; the namespace is the fallback so a capability
  // added without a group still appears somewhere rather than nowhere.
  private groupOf(c: BridgeCapability): Group {
    if (c.group) return c.group;
    const namespace = c.type.split('.')[0];
    if (namespace === 'pal') return 'pals';
    if (namespace === 'player') return 'player';
    if (namespace === 'permission' || namespace === 'group') return 'permissions';
    if (namespace === 'bridge') return 'agent';
    return 'world';
  }

  agentLabel = computed(() => {
    const a = this.schema()?.agent;
    return a?.ready ? `${a.name} ${a.version}` : 'agent not loaded';
  });

  types = computed(() => {
    const seen = new Set(this.eventCaps().map((c) => c.type));
    for (const e of this.events()) seen.add(this.chipOf(e));
    return [...seen].sort();
  });

  shown = computed(() => {
    const wanted = this.filter();
    const all = this.events();
    return wanted.size ? all.filter((e) => wanted.has(this.chipOf(e))) : all;
  });

  ngOnInit(): void {
    this.refreshSchema();
    this.refreshEvents();
    this.refreshPlayers();
    this.api.bridgeCatalog().subscribe({
      next: (c) => {
        this.catalogs = {
          item: c.items.map((i) => ({ value: i.id, label: i.name, sub: i.id })),
          pal: c.pals.map((p) => ({
            value: p.id,
            label: p.name,
            sub: p.id + (p.seen ? ` · seen lv ${p.seen.min}–${p.seen.max} ×${p.seen.count}` : ''),
            element: p.element,
            variant: p.variant,
            seenMin: p.seen?.min,
            seenMax: p.seen?.max,
            unlisted: p.unlisted,
          })),
          traits: c.traits.map((t) => ({
            value: t.id,
            label: t.name,
            sub: t.effect || t.id,
            tier: t.tier,
          })),
        };
      },
      error: () => {},
    });
    this.timers.push(setInterval(() => this.refreshEvents(), 2000));
    this.timers.push(setInterval(() => this.refreshSchema(), 10000));
    this.timers.push(setInterval(() => this.refreshPlayers(), 5000));
  }
  ngOnDestroy(): void {
    for (const t of this.timers) clearInterval(t);
  }

  // ── pickers ────────────────────────────────────────────────────────────────
  openLocationPicker(capType: string): void {
    this.pickerKind.set('location');
    this.api.bridgeCall('location.list', null, {}).subscribe({
      next: (r) => {
        const locations = (r.data['locations'] as { name: string; x: number; y: number; z: number; source: string }[]) ?? [];
        this.openPicker(
          'Pick a location',
          locations.map((l) => ({
            value: `${l.x},${l.y},${l.z}`,
            label: l.name,
            sub: `${l.x.toFixed(0)}, ${l.y.toFixed(0)}, ${l.z.toFixed(0)} · ${l.source}`,
            unlisted: l.source === 'boss',
          })),
          false,
          (v) => {
            const [x, y, z] = v.split(',');
            this.inputs[`${capType}.x`] = x;
            this.inputs[`${capType}.y`] = y;
            this.inputs[`${capType}.z`] = z;
          },
        );
      },
      error: () => {},
    });
  }

  openPlayerPicker(capType: string): void {
    this.pickerKind.set('player');
    this.openPicker(
      'Pick a player',
      this.players().map((p) => ({
        value: p.userid,
        label: p.name,
        sub: p.userid,
        online: p.online,
      })),
      false,
      (v) => (this.targets[capType] = v),
    );
  }

  openWorldPalPicker(inputKey: string): void {
    this.pickerKind.set('worldpal');
    this.api.bridgeCall('pal.list', null, {}).subscribe({
      next: (r) => {
        const pals = (r.data['pals'] as { id: string; species: string; level: number }[]) ?? [];
        this.worldPals.set(pals as never);
        this.openPicker(
          'Pick a loaded pal',
          pals.filter((p) => p.id).map((p) => ({
            value: p.id,
            label: `${p.species} (lv ${p.level})`,
            sub: p.id,
          })),
          false,
          (v) => (this.inputs[inputKey] = v),
        );
      },
      error: () => {},
    });
  }

  openCatalogPicker(kind: string, inputKey: string): void {
    if (kind === 'worldpal') return this.openWorldPalPicker(inputKey);
    const titles: Record<string, string> = {
      item: 'Pick an item',
      pal: 'Pick a pal',
      traits: 'Pick traits',
    };
    const options = (this.catalogs as Record<string, PickOption[]>)[kind] ?? [];
    const multi = kind === 'traits';
    if (multi) {
      const current = (this.inputs[inputKey] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      this.pickerChosen.set(new Set(current));
    }
    this.pickerKind.set(kind);
    // The world keeps reporting new species (mods included); refresh the pal
    // catalog on open so they are pickable without a page reload.
    if (kind === 'pal') this.refreshCatalog();
    this.openPicker(titles[kind] ?? 'Pick', options, multi, (v) => (this.inputs[inputKey] = v));
  }

  private refreshCatalog(): void {
    this.api.bridgeCatalog().subscribe({
      next: (c) => {
        this.catalogs.pal = c.pals.map((p) => ({
          value: p.id,
          label: p.name,
          sub: p.id + (p.seen ? ` · seen lv ${p.seen.min}–${p.seen.max} ×${p.seen.count}` : ''),
          element: p.element,
          variant: p.variant,
          seenMin: p.seen?.min,
          seenMax: p.seen?.max,
          unlisted: p.unlisted,
        }));
        if (this.pickerKind() === 'pal') this.pickerOptions.set(this.catalogs.pal);
      },
      error: () => {},
    });
  }

  private openPicker(
    title: string,
    options: PickOption[],
    multi: boolean,
    write: (value: string) => void,
  ): void {
    this.pickerTitle.set(title);
    this.pickerOptions.set(options);
    this.pickerMulti.set(multi);
    if (!multi) this.pickerChosen.set(new Set());
    this.pickerWrite = write;
    this.pickerSearch = '';
    this.pickerQuery.set('');
    this.palElement.set(null);
    this.palVariant = 'all';
    this.palVariantSig.set('all');
    this.palLevel = '';
    this.palLevelSig.set('');
    this.palSeenOnly.set(false);
    this.pickerDlg?.nativeElement.showModal();
  }

  choose(option: PickOption): void {
    if (this.pickerMulti()) {
      this.pickerChosen.update((prev) => {
        const next = new Set(prev);
        if (next.has(option.value)) next.delete(option.value);
        else next.add(option.value);
        return next;
      });
      return;
    }
    this.pickerWrite(option.value);
    this.closePicker();
  }

  applyMulti(): void {
    this.pickerWrite([...this.pickerChosen()].join(','));
    this.closePicker();
  }

  closePicker(): void {
    this.pickerDlg?.nativeElement.close();
  }

  tierClass(tier: number): string {
    return tier < 0 ? 'neg' : String(Math.min(4, Math.max(1, tier)));
  }

  setPalLevel(value: unknown): void {
    this.palLevelSig.set(value === null || value === undefined ? '' : String(value));
  }

  // ── table / stream helpers ─────────────────────────────────────────────────
  chipOf(e: BridgeEvent): string {
    return e.kind === 'result' ? 'result' : e.type;
  }

  paramList(c: BridgeCapability): { name: string; spec: NonNullable<BridgeCapability['params']>[string] }[] {
    return Object.entries(c.params ?? {}).map(([name, spec]) => ({ name, spec }));
  }

  placeholderFor(p: { name: string; spec: { required?: boolean; default?: unknown } }): string {
    const bits = [p.name];
    if (p.spec.required) bits.push('(required)');
    else if (p.spec.default !== undefined) bits.push(`(default ${p.spec.default})`);
    return bits.join(' ');
  }

  toggle(type: string): void {
    this.filter.update((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }
  clearFilter(): void {
    this.filter.set(new Set());
  }

  time(at: number): string {
    return new Date(at * 1000).toTimeString().slice(0, 8);
  }
  date(at: number): string {
    return at ? new Date(at * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—';
  }
  tagText(p: BridgePlayer): string {
    const entries = Object.entries(p.tags ?? {});
    return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(' ') : '—';
  }

  // One line per event. Unknown types fall back to raw fields, so a capability
  // added to the manifest is readable here before anyone writes a pretty case.
  summary(e: BridgeEvent): string {
    const who = e.subject?.name ?? e.subject?.id ?? '';
    if (e.kind === 'result') {
      return `${e.type} → ${e.ok ? 'ok' : `failed (${e.error ?? ''})`} ${this.flat(e.data)}`;
    }
    switch (e.type) {
      case 'player.chat': return `${who}: ${e.data['message']}`;
      case 'player.join':
        return `${who} joined${e.data['firstEver'] ? ' — first time ever' : ''} (join #${e.data['joins'] ?? '?'})`;
      case 'player.leave': return `${who} left`;
      case 'player.respawn': return `${who} respawned`;
      case 'player.death': {
        const killer = e.data['killer'] as { name?: string } | undefined;
        return killer?.name ? `${who} was killed by ${killer.name}` : `${who} died`;
      }
      case 'npc.spawn':
        return `${e.data['species']} lv${e.data['level']}${e.data['rare'] ? ' (rare)' : ''} spawned`;
      case 'bridge.ready': return `${e.data['agent']} v${e.data['version']} loaded`;
      case 'bridge.hook':
        return `${e.data['hook']} — ${e.data['ok'] ? 'registered' : 'failed'}`;
      default: return `${who} ${this.flat(e.data)}`.trim();
    }
  }

  private flat(data: Record<string, unknown>): string {
    return Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`)
      .join(' ');
  }

  refreshSchema(): void {
    this.api.bridgeSchema().subscribe({ next: (s) => this.schema.set(s), error: () => {} });
  }

  refreshPlayers(): void {
    this.api.bridgePlayers().subscribe({ next: (r) => this.players.set(r.players), error: () => {} });
  }

  refreshEvents(): void {
    this.api.bridgeEvents(this.cursor, 500).subscribe({
      next: (r) => {
        // The event file is emptied when the server boots, so a cursor that
        // moved backwards means a new run: drop what belongs to the old one.
        if (r.cursor < this.cursor) this.events.set([]);
        this.cursor = r.cursor;
        if (r.events.length) {
          this.events.update((prev) => [...prev, ...r.events].slice(-BridgeComponent.KEEP));
        }
        this.placeholder.set('(nothing published this server run yet)');
      },
      error: () => this.placeholder.set('(events unavailable)'),
    });
  }

  // A number input bound with ngModel puts a number in the model, a text input
  // a string, and an emptied number input null — every read has to survive all
  // three, or the form throws before it ever reaches the game.
  private text(value: unknown): string {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  run(c: BridgeCapability): void {
    const target = this.text(this.targets[c.type]);
    if (c.target === 'player' && !c.targetOptional && !target) {
      this.results[c.type] = 'failed (pick a target player first)';
      return;
    }
    const data: Record<string, unknown> = {};
    for (const p of this.paramList(c)) {
      const key = `${c.type}.${p.name}`;
      if (p.spec.type === 'bool') {
        if (this.boolInputs[key]) data[p.name] = true;
      } else {
        const raw = this.text(this.inputs[key]);
        if (raw !== '') data[p.name] = raw;
      }
    }
    this.busy.set(true);
    this.results[c.type] = 'running…';
    this.api.bridgeCall(c.type, c.target === 'player' ? target : null, data).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.results[c.type] = r.ok
          ? `ok ${this.flat(r.data)}`
          : `failed (${r.error ?? 'unknown'})`;
        if (c.type.endsWith('_tag')) this.refreshPlayers();
        // A spawn returns the new pal's id — surface it where it can be acted
        // on rather than leaving the caller to correlate events.
        if (r.ok && c.type === 'pal.spawn') this.refreshWorldPals();
      },
      error: (err) => {
        this.busy.set(false);
        this.results[c.type] = `failed (${err?.error?.error ?? 'no answer from the game'})`;
      },
    });
  }
}
