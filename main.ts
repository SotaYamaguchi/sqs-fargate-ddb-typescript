import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { AttributeValue } from "@aws-sdk/client-dynamodb";

const visibilityTimeout = 60 * 10;
const waitingTimeout = 20;

interface MsgType {
    message: string;
}

const awsProfile = process.env.AWS_PROFILE;
console.log(`AWS_PROFILE: ${awsProfile}`);

let config: { credentials?: any };
if (awsProfile) {
    console.log(`Use AWS profile ${awsProfile}`);
    config = {
        credentials: fromIni({ profile: awsProfile }),
    };
} else {
    console.log("Use container role");
    config = {};
}

const main = async () => {
    console.log("Service is started");

    const queueUrl = process.env.SQS_URL;
    console.log(`QUEUE_URL: ${queueUrl}`);

    const tableName = process.env.DDB_TABLE;
    console.log(`DDB_TABLE: ${tableName}`);

    const sqsClient = new SQSClient(config);
    const ddbClient = new DynamoDBClient(config);

    try {
        while (true) {
            const result = await processSQS(sqsClient, queueUrl as string, ddbClient, tableName as string);
            if (!result) {
                break;
            }
        }
    } catch (error) {
        console.error(`Error: ${error}`);
    }

    console.log("Service is safely stopped");
};

const processSQS = async (sqsClient: SQSClient, queueUrl: string, ddbClient: DynamoDBClient, tableName: string): Promise<boolean> => {
    const input = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: visibilityTimeout,
        WaitTimeSeconds: waitingTimeout,
    });

    const response = await sqsClient.send(input);

    console.log(`Received messages: ${response.Messages?.length}`);
    if (!response.Messages || response.Messages.length === 0) {
        return false;
    }

    for (const msg of response.Messages) {
        const newMsg: MsgType = JSON.parse(msg.Body ?? "");
        const id = msg.MessageId;

        console.log(`Message id ${id} is received from SQS: ${newMsg.message}`);

        await putToDDB(ddbClient, tableName, id as string, newMsg.message);
        console.log(`Message id ${id} is saved in DDB`);

        await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: msg.ReceiptHandle,
        }));

        console.log(`Message id ${id} is deleted from queue`);
    }

    return true;
};

const getTimestampNow = (): string => {
    const t = new Date();
    return t.toISOString();
};

const putToDDB = async (ddbSvc: DynamoDBClient, tableName: string, msgId: string, message: string): Promise<void> => {
    const timeISO = getTimestampNow();

    const inputMap: Record<string, AttributeValue> = {
        id: { S: msgId },
        timestamp: { S: timeISO },
        message: { S: message },
    };

    const input = new PutItemCommand({
        Item: inputMap,
        TableName: tableName,
    });

    await ddbSvc.send(input);
};

main().catch(console.error);
