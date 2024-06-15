# generic-resource-pool

Atomically access any collection of objects.

[![npm version](https://badgen.net/npm/v/generic-resource-pool)](https://npm.im/generic-resource-pool) [![npm downloads](https://badgen.net/npm/dm/generic-resource-pool)](https://npm.im/generic-resource-pool)

## Motivation

When building [Crack & Stack](https://crackandstack.com) I needed a way to have a pool of web3 wallets that could be accessed atomically across multiple workers to prevent two processes from using the same wallet at the same time. I couldn't find a library that did this, so I built one.

The library is designed to be generic and can be used to pool any type of array object. It supports multiple drivers for the locking mechanism `memory`, `redis` and `dynamodb`. You can also create your own driver by implementing the `LockDriver` interface.

## Install

```bash
npm i generic-resource-pool
```

If you want to use the Redis driver, you will need to install `ioredis`:

```bash
npm i ioredis
```

If you want to use the DynamoDB driver, you will need to install `@aws-sdk/client-dynamodb`:

```bash
npm i @aws-sdk/client-dynamodb
```

## Usage

```typescript
import { ResourcePool } from 'generic-resource-pool';
import { RedisDriver } from 'generic-resource-pool/redis';

const users = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];

const pool = new ResourcePool({
  driver: new RedisDriver({ host: 'localhost', port: 6379 }),
  resources: users, // Array of resources in the pool,
  key: (user) => user.id, // Function that returns a unique key for each resource,
  expires: 1000, // Time in milliseconds before a lock expires (also accepts a function that returns a number given the resource),
  shuffle: true, // Shuffle the resources before trying to acquire a lock (default: true),
});

const user = await pool.acquire({ timeout: 5000 }); // optionally pass a timeout in milliseconds
if (user) {
  // do something with the user
  await pool.release(user); // also, it releases the lock automatically after the `expires` option value
}
```

## Drivers

### Memory

The memory driver does not require any additional dependencies. It's useful for testing and development. It can be used on production if you don't need to share the pool across multiple processes.

```typescript
import { ResourcePool } from 'generic-resource-pool';
import { MemoryDriver } from 'generic-resource-pool/memory';

const pool = new ResourcePool({
  driver: new MemoryDriver(),
  // ...
});
```

### Redis

The Redis driver uses [ioredis](https://github.com/redis/ioredis) to lock resources. The driver accepts a configuration object or an existing Redis client.

```typescript
import { ResourcePool } from 'generic-resource-pool';
import { RedisDriver } from 'generic-resource-pool/redis';

const pool = new ResourcePool({
  driver: new RedisDriver({ host: 'localhost', port: 6379 }),
  // ...
});
```

If you have an existing Redis client, you can pass it to the driver:

```typescript
import { ResourcePool } from 'generic-resource-pool';
import { RedisDriver } from 'generic-resource-pool/redis';
import { Redis } from 'ioredis';

const redis = new Redis({ host: 'localhost', port: 6379 });

const pool = new ResourcePool({
  driver: new RedisDriver(redis),
  // ...
});
```

### DynamoDB

The DynamoDB driver uses [@aws-sdk/client-dynamodb](https://github.com/aws/aws-sdk-js-v3) to lock resources. The driver accepts a configuration object or an existing DynamoDB client along with the table name. If the table does not exist, it will be created automatically.

```typescript
import { ResourcePool } from 'generic-resource-pool';
import { DynamoDBDriver } from 'generic-resource-pool/dynamodb';

const pool = new ResourcePool({
  driver: new DynamoDBDriver({
    region: 'us-east-1',
  }, 'ResourcePool'),
  // ...
});
```

## API

### `new ResourcePool(options: ResourcePoolOptions)`

- `options.driver: LockDriver` - The driver to use for the locking mechanism.
- `options.resources: T[]` - Array of resources in the pool.
- `options.key: (resource: T) => string` - Function that returns a unique key for each resource.
- `options.expires: number | ((resource: T) => number)` - Time in milliseconds before a lock expires (also accepts a function that returns a number given the resource).
- `options.shuffle: boolean | undefined` - Shuffle the resources before trying to acquire a lock (default: true).

### `pool.acquire(options: AcquireOptions): Promise<T | null>`
- `options.timeout: number | undefined` - Timeout in milliseconds to wait for a resource to become available. If undefined, it will only try once. (default: undefined).

### `pool.release(resource: T): Promise<boolean>`
- `resource: T` - The resource to release.
- Returns a promise that resolves to `true` if the resource was released successfully, `false` otherwise.

### `interface LockDriver`

- `lock(key: string, expires: number): Promise<boolean>` - Locks a resource.
- `unlock(key: string): Promise<boolean>` - Unlocks a resource.

## Examples

### Web3 Wallet Pool

In this example, we have a pool of web3 wallets that we want to use to send transactions. We want to make sure that no two transactions are sent from the same wallet at the same time. We also want to make sure that a wallet is not used if it has pending transactions.

```typescript
import { ResourcePool } from 'generic-resource-pool';
import { RedisDriver } from 'generic-resource-pool/redis';
import { Account, WalletClient } from "viem";

export class WalletPool<Wallet extends WalletClient> extends ResourcePool<Wallet> {
  constructor(wallets: Wallet[], namespace: string) {
    super({
      driver: new RedisDriver(redis),
      resources: wallets,
      key: (wallet) => `app:wallets:${namespace}:${wallet.account?.address}`,
      expires: environment.DEFAULT_TRANSACTION_TIMEOUT,
    });
  }

  async acquire() {
    const wallet = await super.acquire({ timeout: environment.DEFAULT_TRANSACTION_TIMEOUT });

    if (!wallet) {
      throw new Error("No wallets available");
    }

    if (await this.hasPendingTransactions(wallet)) {
      throw new Error(`Wallet ${wallet.account?.address} has pending transactions`);
    }

    return wallet;
  }

  private async hasPendingTransactions(wallet: Wallet) {
    const [pending, current] = await Promise.all([
      publicClient.getTransactionCount({
        address: wallet.account.address,
        blockTag: "pending",
      }),
      publicClient.getTransactionCount({
        address: wallet.account.address,
      }),
    ]);

    return pending - current > 0;
  }
}

```

### Custom Driver

You can create your own driver by implementing the `LockDriver` interface. For example this is a driver using a custom PostgreSQL table and Drizzle ORM:

```typescript
import { LockDriver } from 'generic-resource-pool';
import { pgTable, boolean, timestamp, text } from "drizzle-orm/pg-core";

const table = pgTable('locks', {
  key: text(),
  expires: timestamp(),
});

export class PostgresDriver {
  async lock(key: string, expires: number) {
    try {
      await db.insert(table).values({ key, expires: new Date(Date.now() + expires) });
      return true;
    } catch (error) {
      const [resource] = await db.select().from(table).where(eq(table.key, key));
      if (resource.expires < new Date()) {
        if (await this.unlock(key)) {
          return this.lock(key, expires);
        }
      }
      
      return false;
    }
  }

  async unlock(key: string) {
    await db.delete(table).where(eq(table.key, key));
    return true;
  }
}

const pool = new ResourcePool({
  driver: new PostgresDriver(),
  // ...
});
```

## License

MIT &copy; [vimtor](https://github.com/sponsors/vimtor)
