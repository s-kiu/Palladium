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
      <details>
        <summary class="getting-started-summary">
          <b>How permissions work</b>
          <span class="muted"> — nodes, groups, constraints, roles. Click to expand.</span>
        </summary>
        <ol class="getting-started">
          <li>
            <b>Nodes</b> are dotted names like <code>chatshop.kit</code> or <code>pal.spawn</code>.
            Built-in capabilities register theirs automatically (default deny); mods register
            their own on startup via <code>permission.register</code> and appear below once
            they have run.
          </li>
          <li>
            <b>Resolution order</b>: a player's own overrides win, then their groups by weight
            (highest first), then the default group, then the node's registered default.
            Within one source an exact node beats <code>chatshop.*</code> beats <code>*</code>,
            and deny beats allow on ties.
          </li>
          <li>
            <b>Constraints make one node fine-grained.</b> Any allow entry can carry
            per-parameter rules, matched against the actual call:
            <pre class="mono">{{ '{' }}"species": {{ '{' }}"in": ["SheepBall"]{{ '}' }}{{ '}' }}          may spawn, but only Lamball
{{ '{' }}"level": {{ '{' }}"max": 20{{ '}' }}{{ '}' }}                     …and only up to level 20
{{ '{' }}"x": {{ '{' }}"min": -1000, "max": 1000{{ '}' }}, "y": {{ '{' }}"min": -1000, "max": 1000{{ '}' }}{{ '}' }}   teleport only inside a box</pre>
            A tool acting for a player sends <code>as: &lt;player id&gt;</code> on
            <code>POST /api/bridge/call</code>; the server resolves the capability as that
            player's node, checks the constraints against the call's parameters, and refuses
            with the violated rule named.
          </li>
          <li>
            <b>Roles</b>: a group can carry a tag; a player's role is their highest-weight tag.
            It is served on every event as <code>subject.role</code> and shown in chat when
            enabled below.
          </li>
        </ol>
      </details>
    </div>

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
            Entries — node, allow/deny, an optional constraint in where-syntax
            (<code>where species in SheepBall,Lamball</code>,
            <code>where target = &#64;me</code>,
            <code>where target_weight &lt; 12</code>, joined with
            <code>and</code>/<code>or</code>) and an optional expiry
            (<code>2026-09-01</code> or <code>2026-09-01T14:30</code>).
          </p>
          @for (e of g.entries; track e.node) {
            <div class="row wrap entry-row">
              <span class="mono">{{ e.node }}</span>
              <span class="tag" [class.warn-tag]="e.effect === 'deny'">{{ e.effect }}</span>
              @if (e.where) { <span class="mono small-tags">{{ e.where }}</span> }
              @if (e.until) { <span class="tag">until {{ e.until }}</span> }
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
            <input [(ngModel)]="entryWhere" name="pg-entry-where" placeholder='where … (optional, e.g. where target = @me)' />
            <input [(ngModel)]="entryUntil" name="pg-entry-until" class="short" placeholder='until (optional)' />
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
            @if (e.where) { <span class="mono small-tags">{{ e.where }}</span> }
            @if (e.until) { <span class="tag">until {{ e.until }}</span> }
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
          <input [(ngModel)]="overrideWhere" name="pp-where" placeholder="where … (optional)" />
          <input [(ngModel)]="overrideUntil" name="pp-until" class="short" placeholder="until (optional)" />
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
      @if (orphans().length > 0) {
        <p class="muted small-note">
          <b class="warn">{{ orphans().length }}</b> node(s) are marked <b>left over</b>: the mod
          that registered them is no longer installed. They are kept rather than deleted, because
          a grant that refers to one would otherwise dangle and a mod you have only disabled would
          lose its permissions. Reinstall the mod to adopt them again, or delete the lines from
          <code>mods/Palladium/permissions.config</code> once you are sure.
        </p>
      }
      <datalist id="perm-nodes">
        @for (n of nodes(); track n.node) { <option [value]="n.node">{{ n.description }}</option> }
      </datalist>
      <table>
        <thead><tr><th>Node</th><th>Mod</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          @for (n of nodes(); track n.node) {
            <tr>
              <td class="mono">{{ n.node }}</td>
              <td>
                {{ n.mod }}
                @if (isOrphan(n)) { <span class="tag warn-tag" title="No installed mod declares this node">left over</span> }
              </td>
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
        Show <span class="mono">[ROLE]</span> tags before names in the panel's chat card
      </label>
      <p class="muted small-note">
        The role is the tag of the player's highest-weight tagged group; it also rides on every
        served event as <code>subject.role</code>, so relays can show it. It cannot be shown in
        the in-game chat itself: writing the chat hook's message parameter faults this UE4SS
        build (verified live), so the game's own chat stays untouched.
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
  playerEntries = signal<{ node: string; effect: string; where?: string; until?: string }[]>([]);
  playerRole = signal<string | null>(null);
  chatRoles = signal(false);
  feedback = signal('');
  failed = signal(false);

  // Nodes outlive the mod that registered them on purpose — deleting one would
  // dangle every grant naming it, and a disabled mod would lose its
  // permissions. Saying which are left over costs nothing and answers the
  // question an operator actually has: "why is this mod still listed?"
  installed = signal<Set<string>>(new Set());
  // Read from the live schema rather than a list kept here: a capability's
  // namespace is never an orphan however the mods folder looks.
  capabilityNamespaces = signal<Set<string>>(new Set());
  orphans = computed(() => {
    const here = this.installed();
    if (here.size === 0) return [];
    return this.nodes().filter((n) => this.isOrphanFor(n, here));
  });

  newGroup = '';
  newTag = '';
  newWeight: number | null = null;
  editTag = '';
  editWeight: number | null = null;
  entryNode = '';
  entryEffect = 'allow';
  entryWhere = '';
  entryUntil = '';
  selectedPlayer = '';
  assignGroup = '';
  overrideNode = '';
  overrideEffect = 'allow';
  overrideWhere = '';
  overrideUntil = '';

  currentGroup = computed(() => this.groups().find((g) => g.name === this.selectedGroup()) ?? null);

  ngOnInit(): void {
    this.refresh();
    this.api.bridgeSchema().subscribe({
      next: (s) => this.capabilityNamespaces.set(
        new Set((s.capabilities ?? []).map((c) => String(c.type).split('.')[0].toLowerCase())),
      ),
      error: () => {},
    });
    this.api.mods().subscribe({
      next: (r) => this.installed.set(new Set([
        ...r.framework.mods.map((m) => m.name.toLowerCase()),
        ...r.script.map((m) => m.name.toLowerCase()),
      ])),
      error: () => {},
    });
    this.api.bridgePlayers().subscribe({ next: (r) => this.players.set(r.players), error: () => {} });
    this.api.bridgeOptions().subscribe({ next: (o) => this.chatRoles.set(o.chatRoles), error: () => {} });
  }

  isOrphan(n: PermNode): boolean {
    return this.isOrphanFor(n, this.installed());
  }

  // A node's namespace is its mod's name. Capability nodes belong to the agent
  // itself, so they are never orphans however the mod folder looks.
  private isOrphanFor(n: PermNode, here: Set<string>): boolean {
    if (here.size === 0) return false;
    const ns = String(n.node).split('.')[0]?.toLowerCase() ?? '';
    if (!ns || ns === 'bridge') return false;
    if (this.capabilityNamespaces().has(ns)) return false;
    return !here.has(ns);
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

  // The agent expects the constraint with its keyword; typing it is optional.
  private normalizeWhere(raw: string): string | undefined {
    const text = raw.trim();
    if (!text) return undefined;
    return text.startsWith('where ') ? text : `where ${text}`;
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
    const where = this.normalizeWhere(this.entryWhere);
    const until = this.entryUntil.trim();
    this.api.bridgeCall('group.set_entry', null, {
      group,
      node: this.entryNode,
      effect: this.entryEffect,
      ...(where ? { where } : {}),
      ...(until ? { until } : {}),
    }).subscribe({ next: (r) => { this.entryNode = ''; this.entryWhere = ''; this.entryUntil = ''; this.done(r); }, error: (e) => this.done(e?.error ?? {}) });
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
        this.playerEntries.set((r.data['entries'] as { node: string; effect: string; where?: string; until?: string }[]) ?? []);
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
    const where = this.normalizeWhere(this.overrideWhere);
    const until = this.overrideUntil.trim();
    this.api.bridgeCall('permission.grant', this.selectedPlayer, {
      node: this.overrideNode,
      effect: this.overrideEffect,
      ...(where ? { where } : {}),
      ...(until ? { until } : {}),
    }).subscribe({ next: (r) => { this.overrideNode = ''; this.overrideWhere = ''; this.overrideUntil = ''; this.done(r); }, error: (e) => this.done(e?.error ?? {}) });
  }

  revokeOverride(node: string): void {
    this.api.bridgeCall('permission.revoke', this.selectedPlayer, { node })
      .subscribe({ next: (r) => this.done(r), error: (e) => this.done(e?.error ?? {}) });
  }

  toggleChatRoles(value: boolean): void {
    this.api.setBridgeOptions({ chatRoles: value }).subscribe({
      next: (o) => this.chatRoles.set(o.chatRoles),
      error: () => {},
    });
  }

}
