import { LockDriver } from "../index";
import { DynamoDB } from "aws-sdk";

export class DynamoDBDriver implements LockDriver {
  private readonly client: DynamoDB;
  private readonly tableName: string;

  constructor(
    connection: DynamoDB.Types.ClientConfiguration | DynamoDB,
    tableName: string,
  ) {
    this.client =
      connection instanceof DynamoDB ? connection : new DynamoDB(connection);
    this.tableName = tableName;
  }

  public async lock(key: string, expires: number): Promise<boolean> {
    try {
      await this.client
        .putItem({
          TableName: this.tableName,
          Item: {
            LockKey: { S: key },
            ExpirationTime: { N: (Date.now() + expires).toString() },
          },
          ConditionExpression:
            "attribute_not_exists(LockKey) OR ExpirationTime < :now",
          ExpressionAttributeValues: {
            ":now": { N: Date.now().toString() },
          },
        })
        .promise();
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ConditionalCheckFailedException"
      ) {
        return false;
      }

      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ResourceNotFoundException"
      ) {
        const createTableParams = {
          TableName: this.tableName,
          KeySchema: [{ AttributeName: "LockKey", KeyType: "HASH" }],
          AttributeDefinitions: [
            { AttributeName: "LockKey", AttributeType: "S" },
          ],
          ProvisionedThroughput: {
            ReadCapacityUnits: 1,
            WriteCapacityUnits: 1,
          },
        };

        await this.client.createTable(createTableParams).promise();
        return this.lock(key, expires);
      }

      throw error;
    }
  }

  public async unlock(key: string) {
    await this.client
      .deleteItem({
        TableName: this.tableName,
        Key: {
          LockKey: { S: key },
        },
      })
      .promise();
    return true;
  }
}
