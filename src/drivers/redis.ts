import { Redis, Cluster, RedisOptions } from "ioredis";
import { LockDriver } from "../index";

export class RedisDriver implements LockDriver {
  private redis: Redis | Cluster;

  constructor(connection: RedisOptions | Redis | Cluster) {
    this.redis =
      connection instanceof Redis || connection instanceof Cluster
        ? connection
        : new Redis(connection);
  }

  public async lock(key: string, expires: number) {
    const lock = await this.redis.set(key, 1, "PX", expires, "NX");
    return lock === "OK";
  }

  public async unlock(key: string) {
    const result = await this.redis.del(key);
    return result === 1;
  }
}
