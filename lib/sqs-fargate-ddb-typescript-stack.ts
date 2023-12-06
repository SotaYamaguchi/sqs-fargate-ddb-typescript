import {Construct} from 'constructs';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import {ContainerImage, FargatePlatformVersion} from 'aws-cdk-lib/aws-ecs';
import {Duration, RemovalPolicy, Stack, StackProps} from "aws-cdk-lib";
import {DockerImageAsset} from "aws-cdk-lib/aws-ecr-assets";
import * as path from "path";
import config from "../config/config";
import {LogGroup} from "aws-cdk-lib/aws-logs";

export class SqsFargateDdbTypescriptStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const ddbTable = new dynamodb.Table(this, "Table", {
      tableName: `${config.namePrefix}-table`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const queue = new sqs.Queue(this, 'SqsQueue', {
      queueName: `${config.namePrefix}-queue`,
      visibilityTimeout: Duration.seconds(300)
    });

    const asset = new DockerImageAsset(this, "NodeDockerImage", {
      directory: path.join(__dirname, ".."),
    });

    const vpc = new ec2.Vpc(this, "EcsVpc", {
      maxAzs: 3
    });

    const cluster = new ecs.Cluster(this, "EcsCluster", {
      vpc: vpc,
      clusterName: `node-service-cluster`,
      containerInsights: true
    })

    const logGroup = new LogGroup(this, "FargateLogGroup", {
      logGroupName: "/ecs/aws-samples/node-service-logs"
    })

    const taskDefinition = new ecs.FargateTaskDefinition(this, "MyTask", {
      cpu: config.service.cpu,
      memoryLimitMiB: config.service.memory,
    })

    const container = new ecs.ContainerDefinition(this, "MyContainer", {
      image: ContainerImage.fromDockerImageAsset(asset),
      taskDefinition: taskDefinition,
      environment: {
        SQS_URL: queue.queueUrl,
        DDB_TABLE: ddbTable.tableName
      },
      logging: new ecs.AwsLogDriver({
        logGroup: logGroup,
        streamPrefix: "node-service"
      })
    })

    const myService = new ecs.FargateService(this, "MyService", {
      taskDefinition: taskDefinition,
      cluster: cluster,
      platformVersion: FargatePlatformVersion.VERSION1_4,
      serviceName: "node-fargate-service",
      desiredCount: 1,
    })

    // SQSメッセージの読み取り権限を付与
    queue.grantConsumeMessages(taskDefinition.taskRole)

    ddbTable.grantWriteData(taskDefinition.taskRole)

    // CloudWatch dashboard
    const dashboardStart = "-P1D" // 直近1日
    const dashboard = new cw.Dashboard(this, "ServiceDashboard", {
      dashboardName: config.dashboard.name,
      start: dashboardStart
    })

    dashboard.addWidgets(new cw.LogQueryWidget({
      logGroupNames: [config.dashboard.name],
      view: cw.LogQueryVisualizationType.LINE,
      queryLines: [
        'filter @message like /is saved in DDB/',
        '| stats count(*) as messagesSavedInDynamoDBCount by bin(5m)',
        '| sort exceptionCount desc',
      ],
      title: "Saved to DDB",
      width: 24
    }))

    dashboard.addWidgets(new cw.LogQueryWidget({
      logGroupNames: [config.dashboard.name],
      view: cw.LogQueryVisualizationType.LINE,
      queryLines: [
        'filter @message like /is received from SQS/',
        '| stats count(*) as sqsMessageReceivedCount by bin(5m)',
        '| sort exceptionCount desc',
      ],
      title: "Received from SQS",
      width: 24
    }))
  }
}
