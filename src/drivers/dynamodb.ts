import { LockDriver } from "../index";
import {
  ConditionalCheckFailedException,
  DynamoDB,
  DynamoDBClientConfig,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";

export class DynamoDBDriver implements LockDriver {
  private readonly client: DynamoDB;
  private readonly tableName: string;

  constructor(connection: DynamoDBClientConfig | DynamoDB, tableName: string) {
    this.client =
      connection instanceof DynamoDB ? connection : new DynamoDB(connection);
    this.tableName = tableName;
  }

  public async lock(key: string, expires: number): Promise<boolean> {
    try {
      await this.client.putItem({
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
      });

      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }

      if (error instanceof ResourceNotFoundException) {
        await this.client.createTable({
          TableName: this.tableName,
          KeySchema: [{ AttributeName: "LockKey", KeyType: "HASH" }],
          AttributeDefinitions: [
            { AttributeName: "LockKey", AttributeType: "S" },
          ],
          ProvisionedThroughput: {
            ReadCapacityUnits: 1,
            WriteCapacityUnits: 1,
          },
        });
        return this.lock(key, expires);
      }

      throw error;
    }
  }

  public async unlock(key: string) {
    await this.client.deleteItem({
      TableName: this.tableName,
      Key: {
        LockKey: { S: key },
      },
    });
    return true;
  }
}
