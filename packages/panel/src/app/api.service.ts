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

export interface ConnectInfo {
  online: boolean;
  gamePort: number;
  publicPort: number;
  publicIp: string | null;
  publicIpConfigured: boolean;
  lookupEnabled: boolean;
}

export interface Player {
  name: string;
  playerId: string;
  userId: string;
  level: number;
  ping: number;
  [k: string]: unknown;
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
  ban(userid: string, message: string) {
    return this.http.post('/api/players/ban', { userid, message });
  }
  unban(userid: string) {
    return this.http.post('/api/players/unban', { userid });
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
  console(command: string, args: Record<string, unknown> = {}) {
    return this.http.post<{ ok: boolean; result: unknown }>('/api/console', { command, args });
  }
  lifecycle(action: 'restart' | 'stop' | 'start' | 'kill', opts: { waittime?: number; message?: string } = {}) {
    return this.http.post<{ ok: boolean; note: string }>('/api/lifecycle', { action, ...opts });
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
