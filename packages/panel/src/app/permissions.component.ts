import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, BridgePlayer, PermGroup, PermNode } from './api.service';

// Permission management. Everything here goes through the same
// POST /api/bridge/call capabilities that tokens use — this page is just a
// comfortable client for them.
@Component({
  selector: 'app-permissions',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="card">
      <div class="row spread">
        <h2>Groups</h2>
        <span class="tag">{{ groups().length }} groups</span>
      </div>
      <p class="muted">
        Players inherit from their groups by weight (highest wins), the default group applies
        to everyone, and per-player overrides beat all of it. Deny beats allow on ties.
      </p>
      <div class="row wrap">
        <input [(ngModel)]="newGroup" name="pg-name" placeholder="group name, e.g. vip" />
        <input class="short" [(ngModel)]="newTag" name="pg-tag" placeholder="[TAG]" />
        <input class="short" type="number" [(ngModel)]="newWeight" name="pg-weight" placeholder="weight" />
        <button class="primary" (click)="createGroup()" [disabled]="!newGroup">Create group</button>
      </div>
      <table>
        <thead>
          <tr><th>Group</th><th>Tag</th><th class="num">Weight</th><th class="num">Members</th><th class="num">Entries</th><th></th></tr>
        </thead>
        <tbody>
          @for (g of groups(); track g.name) {
            <tr [class.picked]="selectedGroup() === g.name">
              <td>{{ g.name }} @if (g.isDefault) { <span class="tag">default</span> }</td>
              <td class="mono">{{ g.tag || '—' }}</td>
              <td class="num">{{ g.weight }}</td>
              <td class="num">{{ g.members }}</td>
              <td class="num">{{ g.entries.length }}</td>
              <td class="actions">
                <button (click)="selectedGroup.set(g.name)">Edit</button>
                @if (!g.isDefault) { <button class="danger" (click)="deleteGroup(g.name)">Delete</button> }
              </td>
            </tr>
          }
        </tbody>
      </table>

      @if (currentGroup(); as g) {
        <div class="action-row">
          <div class="row wrap">
            <span class="mono action-name">{{ g.name }}</span>
            <input class="short" [(ngModel)]="editTag" name="pg-edit-tag" placeholder="[TAG]" />
            <input class="short" type="number" [(ngModel)]="editWeight" name="pg-edit-weight" placeholder="weight" />
            <button (click)="updateGroup(g.name)">Save tag/weight</button>
          </div>
          <p class="muted small-note">
            Entries — node, allow/deny, optional constraints as JSON
            (<code>{{ '{' }}"species":{{ '{' }}"in":["SheepBall"]{{ '}' }}{{ '}' }}</code>,
            <code>{{ '{' }}"x":{{ '{' }}"min":0,"max":1000{{ '}' }}{{ '}' }}</code>).
          </p>
          @for (e of g.entries; track e.node) {
            <div class="row wrap entry-row">
              <span class="mono">{{ e.node }}</span>
              <span class="tag" [class.warn-tag]="e.effect === 'deny'">{{ e.effect }}</span>
              @if (e.constraints) { <span class="mono small-tags">{{ json(e.constraints) }}</span> }
              <span class="spacer"></span>
              <button class="danger" (click)="removeEntry(g.name, e.node)">Remove</button>
            </div>
          } @empty {
            <p class="muted small-note">No entries — this group grants nothing yet.</p>
          }
          <div class="row wrap">
            <input [(ngModel)]="entryNode" name="pg-entry-node" list="perm-nodes" placeholder="node, e.g. pal.spawn or chatshop.*" />
            <select [(ngModel)]="entryEffect" name="pg-entry-effect">
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
            <input [(ngModel)]="entryConstraints" name="pg-entry-constraints" placeholder='constraints JSON (optional)' />
            <button class="primary" (click)="setEntry(g.name)" [disabled]="!entryNode">Set entry</button>
          </div>
        </div>
      }
    </div>

    <div class="card">
      <div class="row spread">
        <h2>Player permissions</h2>
        <span class="tag">{{ players().length }} known</span>
      </div>
      <div class="row wrap">
        <select [(ngModel)]="selectedPlayer" name="pp-player" (ngModelChange)="loadPlayer($event)">
          <option value="">— pick a player —</option>
          @for (p of players(); track p.userid) {
            <option [value]="p.userid">{{ p.name }} ({{ p.userid.slice(0, 8) }}…)</option>
          }
        </select>
        @if (playerRole()) { <span class="tag">role: {{ playerRole() }}</span> }
      </div>
      @if (selectedPlayer) {
        <p class="small-note">Groups</p>
        <div class="row wrap chips">
          @for (grp of playerGroups(); track grp) {
            <button class="chip on" (click)="unassign(grp)" title="click to remove">{{ grp }} ✕</button>
          } @empty {
            <span class="muted small-note">only the default group</span>
          }
          <select [(ngModel)]="assignGroup" name="pp-assign">
            <option value="">— add to group —</option>
            @for (g of groups(); track g.name) {
              @if (!g.isDefault && !playerGroups().includes(g.name)) {
                <option [value]="g.name">{{ g.name }}</option>
              }
            }
          </select>
          <button (click)="assign()" [disabled]="!assignGroup">Assign</button>
        </div>
        <p class="small-note">Overrides (beat every group)</p>
        @for (e of playerEntries(); track e.node) {
          <div class="row wrap entry-row">
            <span class="mono">{{ e.node }}</span>
            <span class="tag" [class.warn-tag]="e.effect === 'deny'">{{ e.effect }}</span>
            @if (e.constraints) { <span class="mono small-tags">{{ json(e.constraints) }}</span> }
            <span class="spacer"></span>
            <button class="danger" (click)="revokeOverride(e.node)">Revoke</button>
          </div>
        } @empty {
          <p class="muted small-note">No overrides.</p>
        }
        <div class="row wrap">
          <input [(ngModel)]="overrideNode" name="pp-node" list="perm-nodes" placeholder="node" />
          <select [(ngModel)]="overrideEffect" name="pp-effect">
            <option value="allow">allow</option>
            <option value="deny">deny</option>
          </select>
          <input [(ngModel)]="overrideConstraints" name="pp-constraints" placeholder="constraints JSON (optional)" />
          <button class="primary" (click)="grantOverride()" [disabled]="!overrideNode">Grant</button>
        </div>
      }
      @if (feedback()) {
        <p class="small-note" [class.err]="failed()" [class.muted]="!failed()">{{ feedback() }}</p>
      }
    </div>

    <div class="card">
      <div class="row spread">
        <h2>Registered nodes</h2>
        <span class="tag">{{ nodes().length }} nodes</span>
      </div>
      <p class="muted">
        Built-in capabilities register under <code>bridge</code> (default deny — acting on behalf
        of a player needs an explicit grant). Mods register their own via
        <code>permission.register</code>, namespaced by their name, and appear here once loaded.
      </p>
      <datalist id="perm-nodes">
        @for (n of nodes(); track n.node) { <option [value]="n.node">{{ n.description }}</option> }
      </datalist>
      <table>
        <thead><tr><th>Node</th><th>Mod</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          @for (n of nodes(); track n.node) {
            <tr>
              <td class="mono">{{ n.node }}</td>
              <td>{{ n.mod }}</td>
              <td><span class="tag" [class.warn-tag]="n.default === 'deny'">{{ n.default }}</span></td>
              <td class="muted">{{ n.description }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Options</h2>
      <label class="follow">
        <input type="checkbox" [ngModel]="chatRoles()" (ngModelChange)="toggleChatRoles($event)" name="opt-chatroles" />
        Show <span class="mono">[ROLE]</span> tags before names in the chat card
      </label>
      <p class="muted small-note">
        The role is the tag of the player's highest-weight tagged group. It also rides on every
        served event as <code>subject.role</code>, so relays can show it too. The in-game chat
        itself cannot be rewritten — the hook only observes messages.
      </p>
    </div>
  `,
})
export class PermissionsComponent implements OnInit {
  private api = inject(Api);

  groups = signal<PermGroup[]>([]);
  nodes = signal<PermNode[]>([]);
  players = signal<BridgePlayer[]>([]);
  selectedGroup = signal('');
  playerGroups = signal<string[]>([]);
  playerEntries = signal<{ node: string; effect: string; constraints: unknown }[]>([]);
  playerRole = signal<string | null>(null);
  chatRoles = signal(false);
  feedback = signal('');
  failed = signal(false);

  newGroup = '';
  newTag = '';
  newWeight: number | null = null;
  editTag = '';
  editWeight: number | null = null;
  entryNode = '';
  entryEffect = 'allow';
  entryConstraints = '';
  selectedPlayer = '';
  assignGroup = '';
  overrideNode = '';
  overrideEffect = 'allow';
  overrideConstraints = '';

  currentGroup = computed(() => this.groups().find((g) => g.name === this.selectedGroup()) ?? null);

  ngOnInit(): void {
    this.refresh();
    this.api.bridgePlayers().subscribe({ next: (r) => this.players.set(r.players), error: () => {} });
    this.api.bridgeOptions().subscribe({ next: (o) => this.chatRoles.set(o.chatRoles), error: () => {} });
  }

  json(v: unknown): string {
    return JSON.stringify(v);
  }

  refresh(): void {
    this.api.bridgeCall('group.list', null, {}).subscribe({
      next: (r) => this.groups.set((r.data['groups'] as PermGroup[]) ?? []),
      error: () => {},
    });
    this.api.bridgeCall('permission.nodes', null, {}).subscribe({
      next: (r) => this.nodes.set((r.data['nodes'] as PermNode[]) ?? []),
      error: () => {},
    });
    if (this.selectedPlayer) this.loadPlayer(this.selectedPlayer);
  }

  private done(r: { ok?: boolean; error?: string }): void {
    this.failed.set(r.ok !== true);
    this.feedback.set(r.ok === true ? 'ok' : `failed (${r.error ?? 'unknown'})`);
    this.refresh();
  }

  private parseConstraints(raw: string): { ok: boolean; value: unknown } {
    const text = raw.trim();
    if (!text) return { ok: true, value: undefined };
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      this.failed.set(true);
      this.feedback.set('failed (constraints are not valid JSON)');
      return { ok: false, value: undefined };
    }
  }

  createGroup(): void {
    this.api.bridgeCall('group.create', null, {
      name: this.newGroup,
      tag: this.newTag,
      weight: this.newWeight ?? 0,
    }).subscribe({ next: (r) => { this.newGroup = ''; this.newTag = ''; this.done(r); }, error: (e) => this.done(e?.error ?? {}) });
  }

  updateGroup(name: string): void {
    this.api.bridgeCall('group.update', null, {
      name,
      tag: this.editTag,
      weight: this.editWeight ?? 0,
    }).subscribe({ next: (r) => this.done(r), error: (e) => this.done(e?.error ?? {}) });
  }

  deleteGroup(name: string): void {
    if (!confirm(`Delete group "${name}"? Its entries and memberships go with it.`)) return;
    this.api.bridgeCall('group.delete', null, { name }).subscribe({
      next: (r) => { if (this.selectedGroup() === name) this.selectedGroup.set(''); this.done(r); },
      error: (e) => this.done(e?.error ?? {}),
    });
  }

  setEntry(group: string): void {
    const c = this.parseConstraints(this.entryConstraints);
    if (!c.ok) return;
    this.api.bridgeCall('group.set_entry', null, {
      group,
      node: this.entryNode,
      effect: this.entryEffect,
      ...(c.value !== undefined ? { constraints: c.value } : {}),
    }).subscribe({ next: (r) => { this.entryNode = ''; this.entryConstraints = ''; this.done(r); }, error: (e) => this.done(e?.error ?? {}) });
  }

  removeEntry(group: string, node: string): void {
    this.api.bridgeCall('group.remove_entry', null, { group, node })
      .subscribe({ next: (r) => this.done(r), error: (e) => this.done(e?.error ?? {}) });
  }

  loadPlayer(userid: string): void {
    if (!userid) return;
    this.api.bridgeCall('permission.player', userid, {}).subscribe({
      next: (r) => {
        this.playerGroups.set((r.data['groups'] as string[]) ?? []);
        this.playerEntries.set((r.data['entries'] as { node: string; effect: string; constraints: unknown }[]) ?? []);
        this.playerRole.set((r.data['role'] as string | null) ?? null);
      },
      error: () => {},
    });
  }

  assign(): void {
    this.api.bridgeCall('group.assign', this.selectedPlayer, { group: this.assignGroup })
      .subscribe({ next: (r) => { this.assignGroup = ''; this.done(r); }, error: (e) => this.done(e?.error ?? {}) });
  }

  unassign(group: string): void {
    this.api.bridgeCall('group.unassign', this.selectedPlayer, { group })
      .subscribe({ next: (r) => this.done(r), error: (e) => this.done(e?.error ?? {}) });
  }

  grantOverride(): void {
    const c = this.parseConstraints(this.overrideConstraints);
    if (!c.ok) return;
    this.api.bridgeCall('permission.grant', this.selectedPlayer, {
      node: this.overrideNode,
      effect: this.overrideEffect,
      ...(c.value !== undefined ? { constraints: c.value } : {}),
    }).subscribe({ next: (r) => { this.overrideNode = ''; this.overrideConstraints = ''; this.done(r); }, error: (e) => this.done(e?.error ?? {}) });
  }

  revokeOverride(node: string): void {
    this.api.bridgeCall('permission.revoke', this.selectedPlayer, { node })
      .subscribe({ next: (r) => this.done(r), error: (e) => this.done(e?.error ?? {}) });
  }

  toggleChatRoles(value: boolean): void {
    this.api.setBridgeOptions(value).subscribe({
      next: (o) => this.chatRoles.set(o.chatRoles),
      error: () => {},
    });
  }
}
