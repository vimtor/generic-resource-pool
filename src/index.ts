import range from "lodash.range";
import shuffle from "lodash.shuffle";

export interface LockDriver {
  lock(key: string, expires: number): Promise<boolean>;

  unlock(key: string): Promise<boolean>;
}

export interface ResourcePoolOptions<Resource> {
  driver: LockDriver;
  resources: Resource[];
  key: (resource: Resource) => string | Promise<string>;
  expires: number | ((resource: Resource) => number | Promise<number>);
  interval?: number;
  shuffle?: boolean;
}

export class ResourcePool<Resource> {
  private readonly driver: LockDriver;
  private readonly resources: Resource[];
  private readonly key: (resource: Resource) => Promise<string>;
  private readonly expires: (resource: Resource) => Promise<number>;
  private readonly interval: number;
  private readonly shuffle: boolean;

  constructor(options: ResourcePoolOptions<Resource>) {
    this.driver = options.driver;
    this.resources = options.resources;
    this.shuffle = options.shuffle ?? true;
    this.interval = options.interval ?? 500;
    this.key = async (resource: Resource) => {
      return options.key(resource);
    };
    this.expires = async (resource: Resource) => {
      if (typeof options.expires === "function") {
        return options.expires(resource);
      }
      return options.expires;
    };
  }

  public async release(resource: Resource) {
    const key = await this.key(resource);
    return this.driver.unlock(key);
  }

  public async acquire(options?: { timeout?: number }) {
    const find = async () => {
      let indices = range(this.resources.length);
      if (this.shuffle) {
        indices = shuffle(indices);
      }

      for (const i of indices) {
        const resource = this.resources[i];
        if (!resource) {
          continue;
        }

        const key = await this.key(resource);
        const expires = await this.expires(resource);
        if (await this.driver.lock(key, expires)) {
          return resource;
        }
      }

      return null;
    };

    if (!options?.timeout) {
      return find();
    }

    let deadline = Date.now() + options.timeout;
    let remaining = options.timeout;

    while (remaining > 0) {
      const resource = await find();
      if (resource) {
        return resource;
      }

      remaining = deadline - Date.now();

      if (remaining <= 0) {
        break;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(remaining, this.interval)),
      );
    }

    return null;
  }

  public size() {
    return this.resources.length;
  }
}
