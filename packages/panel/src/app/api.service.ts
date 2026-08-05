import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { catchError, throwError } from 'rxjs';

// Flipped by the interceptor on any 401 so the shell can drop back to login.
export const authed = signal<boolean | null>(null);

export const unauthorizedInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !req.url.endsWith('/api/login')) authed.set(false);
      return throwError(() => err);
    }),
  );

export interface ModEntry {
  name: string;
  enabled: boolean;
  user: boolean;
  disabledMarker: boolean;
}

export interface PakEntry {
  name: string;
  sizeBytes: number;
}

export interface BackupEntry {
  name: string;
  sizeBytes: number;
  mtime: number;
  tag: string;
}

export interface SettingEntry {
  key: string;
  type: 'str' | 'bool' | 'raw';
  group: string;
  envName: string;
  default: string | null;
  description: string;
  value: string;
  source: 'panel' | 'env' | 'default';
  liveValue: unknown;
  overridden: boolean;
  pending: boolean;
}

export interface SettingsEditorState {
  online: boolean;
  editable: SettingEntry[];
  advanced: { key: string; value: string }[];
}

export interface ConnectInfo {
  online: boolean;
  gamePort: number;
  publicPort: number;
  publicIp: string | null;
  publicIpConfigured: boolean;
  lookupEnabled: boolean;
}

export interface BanEntry {
  userid: string;
  name: string | null;
  bannedAt: number | null;
}

export interface Player {
  name: string;
  playerId: string;
  userId: string;
  level: number;
  ping: number;
  [k: string]: unknown;
}

export interface BridgeSubject {
  kind: string;
  id?: string;
  name?: string;
  position?: { x: number; y: number; z: number };
}

export interface BridgeEvent {
  v: number;
  at: number;
  kind: 'event' | 'result';
  type: string;
  id?: string;
  ok?: boolean;
  error?: string;
  subject?: BridgeSubject;
  data: Record<string, unknown>;
}

export interface BridgeHook {
  hook: string;
  target: string;
  ok: boolean;
}

export interface BridgeStatus {
  available: boolean;
  agent: string | null;
  version: string | null;
  envelope: number | null;
  hooks: BridgeHook[];
  eventTypes: string[];
  lastEventAt: number;
  online: boolean;
}

export interface BridgeParamSpec {
  type: 'string' | 'int' | 'number' | 'bool' | 'item_id' | 'subject';
  required?: boolean;
  picker?: string;
  enriched?: boolean;
  min?: number;
  max?: number;
  maxLen?: number;
  default?: string | number | boolean;
}

export interface BridgeCapability {
  type: string;
  kind: 'event' | 'action' | 'query';
  runtime: 'agent' | 'daemon' | 'game-rest';
  target?: string;
  source?: { hook: string };
  since: string;
  stability: 'stable' | 'experimental' | 'deprecated';
  scope: 'read' | 'write';
  summary: string;
  params?: Record<string, BridgeParamSpec>;
  data?: Record<string, BridgeParamSpec>;
  live: boolean;
}

export interface BridgeSchema {
  envelope: number;
  agent: { name: string | null; version: string | null; ready: boolean };
  capabilities: BridgeCapability[];
}

export interface BridgePlayer {
  userid: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
  joins: number;
  online: boolean;
  tags: Record<string, string>;
}

export interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
}

export interface Status {
  online: boolean;
  info: { version: string; servername: string; description: string } | null;
  metrics: {
    serverfps?: number;
    currentplayernum?: number;
    maxplayernum?: number;
    serverframetime?: number;
    uptime?: number;
  } | null;
  stopped: boolean;
  operation: {
    kind: 'restart' | 'stop' | 'kill';
    message?: string;
    scheduledAt: number;
    fireAt: number;
    phase: 'countdown' | 'executing';
  } | null;
  resources: {
    host: { memTotalMb: number; memUsedMb: number; cpuPercent: number | null };
    game: { rssMb: number; cpuPercent: number | null } | null;
  };
  build: {
    installed: string | null;
    latest: string | null;
    latestCheckedAt: number | null;
    updateAvailable: boolean;
    held: boolean;
  };
  ue4ss: {
    vendored: string | null;
    libInstalled: boolean;
    fastcrashCount: number;
    fallbackActive: boolean;
  };
  pending: { update: boolean; restore: string | null; lastResult: string | null };
  counts: {
    luaMods: number;
    bundledMods: number;
    logicMods: number;
    paks: number;
    backups: number;
  };
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  session() {
    return this.http.get<{ authenticated: boolean }>('/api/session');
  }
  login(password: string) {
    return this.http.post<{ ok: boolean }>('/api/login', { password });
  }
  logout() {
    return this.http.post<{ ok: boolean }>('/api/logout', {});
  }

  status() {
    return this.http.get<Status>('/api/status');
  }

  players() {
    return this.http.get<{ players: Player[] }>('/api/players');
  }
  kick(userid: string, message: string) {
    return this.http.post('/api/players/kick', { userid, message });
  }
  ban(userid: string, message: string, name?: string) {
    return this.http.post('/api/players/ban', { userid, message, name });
  }
  unban(userid: string) {
    return this.http.post('/api/players/unban', { userid });
  }
  bans() {
    return this.http.get<{ bans: BanEntry[] }>('/api/bans');
  }
  announce(message: string) {
    return this.http.post('/api/announce', { message });
  }
  save() {
    return this.http.post('/api/save', {});
  }

  mods() {
    return this.http.get<{ mods: ModEntry[]; logicmods: PakEntry[]; paks: PakEntry[] }>('/api/mods');
  }
  toggleMod(name: string, disabled: boolean) {
    return this.http.post<{ ok: boolean; note: string }>('/api/mods/toggle', { name, disabled });
  }

  connect() {
    return this.http.get<ConnectInfo>('/api/connect');
  }
  logs(lines = 300) {
    return this.http.get<{ lines: string[] }>('/api/logs', { params: { lines } });
  }
  bridgeEvents(since: number, limit = 200) {
    return this.http.get<{ events: BridgeEvent[]; cursor: number }>('/api/bridge/events', {
      params: { since, limit },
    });
  }
  bridgeStatus() {
    return this.http.get<BridgeStatus>('/api/bridge/status');
  }
  bridgeSchema() {
    return this.http.get<BridgeSchema>('/api/bridge/schema');
  }
  bridgePlayers() {
    return this.http.get<{ players: BridgePlayer[] }>('/api/bridge/players');
  }
  bridgeCall(type: string, target: string | null, data: Record<string, unknown>) {
    return this.http.post<BridgeEvent>('/api/bridge/call', { type, target, data });
  }
  bridgeCatalog() {
    return this.http.get<{
      items: { id: string; name: string }[];
      pals: { id: string; name: string }[];
      traits: { id: string; name: string; tier: number; effect: string }[];
    }>('/api/bridge/catalog');
  }
  tokens() {
    return this.http.get<{ tokens: ApiToken[] }>('/api/tokens');
  }
  createToken(name: string, scopes: string[]) {
    return this.http.post<{ id: string; token: string; note: string }>('/api/tokens', { name, scopes });
  }
  revokeToken(id: string) {
    return this.http.delete<{ ok: boolean }>(`/api/tokens/${id}`);
  }
  console(command: string, args: Record<string, unknown> = {}) {
    return this.http.post<{ ok: boolean; result: unknown }>('/api/console', { command, args });
  }
  lifecycle(action: 'restart' | 'stop' | 'start' | 'kill', opts: { waittime?: number; message?: string } = {}) {
    return this.http.post<{ ok: boolean; note: string }>('/api/lifecycle', { action, ...opts });
  }
  settingsEditor() {
    return this.http.get<SettingsEditorState>('/api/settings-editor');
  }
  saveSettings(changes: Record<string, string | null>) {
    return this.http.put<SettingsEditorState>('/api/settings-editor', { changes });
  }

  backups() {
    return this.http.get<{ backups: BackupEntry[] }>('/api/backups');
  }
  createBackup() {
    return this.http.post<{ ok: boolean; name: string }>('/api/backups', {});
  }
  restore(name: string) {
    return this.http.post<{ ok: boolean; note: string }>('/api/backups/restore', { name });
  }
  applyUpdate() {
    return this.http.post<{ ok: boolean; note: string }>('/api/update', {});
  }
}

export function fmtBytes(n: number): string {
  if (n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtUptime(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
