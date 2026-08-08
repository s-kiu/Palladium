// Types for the script-mod client. The capability half of this is generated
// from the same manifest as everything else — see generated/capabilities.d.ts
// — so an editor offers exactly what the server can actually do, and says so
// when a name or a parameter is wrong.
//
// Hand-written because index.mjs is hand-written: only the shape of the class
// lives here, never the list of capabilities.

import type { Capabilities, Envelope, EventType, PalEvent, Subject } from './generated/capabilities.d.ts';

export type { Capabilities, Envelope, EventType, PalEvent, Subject };

export interface PalOptions {
  token?: string;
  name?: string;
}

export interface FollowOptions<T extends EventType = EventType> {
  /** Only these event types. Omit for everything. */
  types?: readonly T[] | null;
  /** How long to wait when the stream had nothing new. */
  intervalMs?: number;
  /** How long to wait after the panel could not be reached. */
  retryMs?: number;
}

export interface KnownPlayer {
  userid: string;
  name: string;
  lastSeen?: number;
}

declare class PalClient {
  constructor(options?: PalOptions);

  /** The mod's own name, from its mod.json. */
  readonly name: string;

  /**
   * The `settings` object from the mod's mod.json, already parsed. Free-form
   * by design — an operator edits it — so the values are `any` rather than
   * something every mod would have to cast its way out of. Narrow it when you
   * want the checking:
   *
   * ```js
   * /** @type {{ webhook: string, events: string[] }} *\/
   * const settings = pal.settings;
   * ```
   */
  settings: Record<string, any>;

  /** Any capability by full name — the escape hatch the namespaces are built on. */
  call<T = Record<string, unknown>>(
    type: string,
    target: string | null,
    data?: Record<string, unknown>,
  ): Promise<Envelope<T>>;

  /** What this server actually has live, merged with the manifest. */
  schema(): Promise<Record<string, unknown>>;

  /** Everyone the panel has ever seen. */
  players(): Promise<{ players: KnownPlayer[] }>;

  /** May this player? False when the check itself failed — an unanswered question is not a yes. */
  can(playerId: string, node: string): Promise<boolean>;

  /** A stored value, or null. Survives restarts. */
  tag(playerId: string, key: string): Promise<string | null>;
  setTag(playerId: string, key: string, value: unknown): Promise<boolean>;
  deleteTag(playerId: string, key: string): Promise<boolean>;

  /** Follows from wherever the stream is now, forever. */
  follow<T extends EventType = EventType>(options?: FollowOptions<T>): AsyncGenerator<PalEvent<T>>;

  /** @deprecated Use pal.player.give_item — the read-back now lives in the capability. */
  give(playerId: string, item: string, count?: number): Promise<boolean>;
  /** @deprecated Use pal.player.count_item. */
  count(playerId: string, item: string): Promise<number | null>;
  /** @deprecated Use pal.player.message. */
  message(playerId: string, text: string): Promise<boolean>;
  /** @deprecated Use pal.server.announce. */
  announce(message: string): Promise<boolean>;
}

/** The client, with every capability hanging off it under the manifest's own name. */
export type Pal = PalClient & Capabilities;
export const Pal: {
  new (options?: PalOptions): Pal;
};

/** The instance the host hands to handlers. Null outside a mod host. */
export const pal: Pal | null;

export function sleep(ms: number): Promise<void>;

/** What a mod exports. */
export interface ScriptMod {
  start?(pal: Pal): void | Promise<void>;
  on?: { [T in EventType]?: (event: PalEvent<T>, pal: Pal) => void | Promise<void> };
}
