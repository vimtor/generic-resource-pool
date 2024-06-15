import { afterAll, expect, test } from "vitest";
import { ResourcePool } from "../src";
import { MemoryDriver } from "../src/drivers/memory";
import { RedisDriver } from "../src/drivers/redis";
import { DynamoDBDriver } from "../src/drivers/dynamodb";

const drivers = {
  memory: new MemoryDriver(),
  redis: new RedisDriver({ host: "localhost", port: 6379, db: 0 }),
  dynamodb: new DynamoDBDriver(
    {
      endpoint: "http://localhost:8000",
      region: "us-west-2",
      credentials: {
        accessKeyId: "fake",
        secretAccessKey: "fake",
      },
    },
    "locks",
  ),
};

const expires = 1000;

const resources = [1, 2, 3];

afterAll(async () => {
  await Promise.all(
    Object.values(drivers).map(async (driver) => {
      for (const resource of resources) {
        await driver.unlock(resource.toString());
      }
    }),
  );
});

Object.entries(drivers).forEach(([name, driver]) => {
  test.concurrent(name, async () => {
    const pool = new ResourcePool({
      driver,
      resources,
      interval: expires / 2,
      key: (resource) => resource.toString(),
      expires,
      shuffle: false,
    });

    let resource = await pool.acquire();
    expect(resource).toEqual(1);

    resource = await pool.acquire();
    expect(resource).toEqual(2);

    resource = await pool.acquire();
    expect(resource).toEqual(3);

    resource = await pool.acquire({ timeout: expires / 2 });
    expect(resource).toEqual(null);

    resource = await pool.acquire({ timeout: expires / 2 });
    expect(resource).toEqual(1);

    resource = await pool.acquire();
    expect(resource).toEqual(2);

    resource = await pool.acquire();
    expect(resource).toEqual(3);

    resource = await pool.acquire({ timeout: expires });
    expect(resource).toEqual(1);

    await new Promise((resolve) => setTimeout(resolve, expires));

    resource = await pool.acquire();
    expect(resource).toEqual(1);

    await pool.release(1);

    resource = await pool.acquire();
    expect(resource).toEqual(1);

    resource = await pool.acquire();
    expect(resource).toEqual(2);

    await pool.release(2);

    resource = await pool.acquire();
    expect(resource).toEqual(2);
  });
});
