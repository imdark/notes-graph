/**
 * Who may publish: NotesGraph users who signed up as developers by
 * registering an Ed25519 public key. One record per user; rotating the key
 * keeps the old one listed so versions signed with it still verify, and a
 * plugin id belongs to the developer who first published it.
 *
 * File-backed like the registry (developers.json in PLUGIN_DATA_DIR).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { keyIdOf, parseRawPublicKey } from './signing';

export interface DeveloperKey {
  keyId: string;
  /** Raw 32-byte Ed25519 public key, base64. */
  publicKey: string;
  createdAt: number;
  /** Set when a newer key replaced it; it still verifies old versions. */
  retiredAt?: number;
}

export interface Developer {
  /** The NotesGraph user id. */
  id: string;
  name: string;
  email?: string;
  keys: DeveloperKey[];
  createdAt: number;
}

/** What the site and the registry entries see of a developer. */
export interface DeveloperView {
  id: string;
  name: string;
  publicKey: string;
  keyId: string;
  createdAt: number;
}

const MAX_NAME = 80;

export function developerView(dev: Developer): DeveloperView {
  const current = currentKey(dev);
  return {
    id: dev.id,
    name: dev.name,
    publicKey: current.publicKey,
    keyId: current.keyId,
    createdAt: dev.createdAt,
  };
}

export function currentKey(dev: Developer): DeveloperKey {
  return dev.keys.find(key => !key.retiredAt) ?? dev.keys[dev.keys.length - 1];
}

export class DeveloperStore {
  private readonly developers: Developer[];

  constructor(private readonly file: string) {
    this.developers = this.load();
  }

  private load(): Developer[] {
    if (!existsSync(this.file)) return [];
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Developer[];
    } catch {
      return [];
    }
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.developers, null, 2));
  }

  get(userId: string): Developer | undefined {
    return this.developers.find(dev => dev.id === userId);
  }

  /** The developer whose key (current or retired) has this id. */
  byKeyId(keyId: string): { developer: Developer; key: DeveloperKey } | null {
    for (const developer of this.developers) {
      const key = developer.keys.find(k => k.keyId === keyId);
      if (key) return { developer, key };
    }
    return null;
  }

  /**
   * Sign a user up, or rotate their key. Returns an error message for bad
   * input; the key must be unused by anyone else.
   */
  register(
    user: { id: string; email?: string },
    input: { name?: unknown; publicKey?: unknown }
  ): { developer: Developer } | { error: string } {
    const name = String(input.name ?? '')
      .trim()
      .slice(0, MAX_NAME);
    if (!name) return { error: 'name is required' };
    const raw = parseRawPublicKey(input.publicKey);
    if (!raw) {
      return {
        error: 'publicKey must be a raw 32-byte Ed25519 public key, base64',
      };
    }
    const keyId = keyIdOf(raw);
    const taken = this.byKeyId(keyId);
    if (taken && taken.developer.id !== user.id) {
      return { error: 'that key is registered to another developer' };
    }
    const now = Date.now();
    const key: DeveloperKey = {
      keyId,
      publicKey: raw.toString('base64'),
      createdAt: now,
    };
    let developer = this.get(user.id);
    if (!developer) {
      developer = {
        id: user.id,
        name,
        email: user.email,
        keys: [key],
        createdAt: now,
      };
      this.developers.push(developer);
    } else {
      developer.name = name;
      if (user.email) developer.email = user.email;
      if (!taken) {
        for (const old of developer.keys) {
          if (!old.retiredAt) old.retiredAt = now;
        }
        developer.keys.push(key);
      }
    }
    this.save();
    return { developer };
  }
}
