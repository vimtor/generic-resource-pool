import { LockDriver } from "../index";

export class MemoryDriver implements LockDriver {
  private readonly lru = new Map<string, number>();

  constructor() {}

  public async lock(key: string, expires: number) {
    const ttl = this.lru.get(key);
    if (ttl && ttl > Date.now()) {
      return false;
    }

    this.lru.set(key, Date.now() + expires);
    return true;
  }

  public async unlock(key: string) {
    this.lru.delete(key);
    return true;
  }
}
