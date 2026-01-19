import json

import aws_cdk as cdk
from constructs import Construct

import aws_cdk.aws_ecs as ecs
import aws_cdk.aws_ecs_patterns as ecsp
import aws_cdk.aws_ecr as ecr
import aws_cdk.aws_ec2 as ec2
import aws_cdk.aws_rds as rds
import aws_cdk.aws_elasticloadbalancingv2 as elbv2


class ObsEcsStack(cdk.Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        with open("../backend/repository.json", "r") as f:
            repository = json.load(f).get("repository")

        print(f"Using server repo: {repository}")

        # Create common VPC and cluster
        vpc = ec2.Vpc(self, "ObsVpc", max_azs=2)
        cluster = ecs.Cluster(self, "ObsCluster", vpc=vpc)

        db_instance = rds.DatabaseInstance(
            self, "PostgresInstance",
            engine=rds.DatabaseInstanceEngine.postgres(
                version=rds.PostgresEngineVersion.VER_15
            ),
            instance_type=ec2.InstanceType.of(
                ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO
            ),
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
            database_name="obs_db",
        )

        # Create first ALB service as usual, but with an explicit cluster
        # created above.
        serv1 = ecsp.ApplicationLoadBalancedFargateService(
            self, "ObsServerService",
            enable_execute_command=True,
            task_image_options=ecsp.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_ecr_repository(
                    ecr.Repository.from_repository_arn(
                        scope=self, id="ObsServerRepo",
                        repository_arn=repository["repositoryArn"])),
                container_port=80,
                secrets={
                    "DB_PASSWORD": ecs.Secret.from_secrets_manager(
                        db_instance.secret, "password"),
                    "DB_HOST": ecs.Secret.from_secrets_manager(
                        db_instance.secret, "host"),
                    "DB_USER": ecs.Secret.from_secrets_manager(
                        db_instance.secret, "username"),
                },
                environment={
                    "DB_NAME": "obs_db",
                    "DB_PORT": "5432"
                }),
            cluster=cluster,
            public_load_balancer=True,
            service_name="ObsServerAPIService"
        )

        db_instance.connections.allow_default_port_from(serv1.service)

        with open("../astrobackend/repository.json", "r") as f:
            repository2 = json.load(f).get("repository")

        print(f"Using astro server repo: {repository2}")

        # Create everything required for the second service and attach
        # it to the load balancer created for the first service, so that
        # the two services are available in different ports of the same
        # public IP.
        alb = serv1.load_balancer
        taskdef2 = ecs.FargateTaskDefinition(self, "ObsAstroServerTask")
        container2 = taskdef2.add_container("ObsAstroServerContainer",
            image=ecs.ContainerImage.from_ecr_repository(
                ecr.Repository.from_repository_arn(
                    scope=self, id="ObsAstroServerRepo",
                    repository_arn=repository2["repositoryArn"])),
            memory_limit_mib=512,
            cpu=256,
        )
        
        container2.add_port_mappings(
            ecs.PortMapping(container_port=8000, protocol=ecs.Protocol.TCP)
        )

        serv2 = ecs.FargateService(
            self, "ObsAstroServerService",
            cluster=cluster,
            task_definition=taskdef2,
            desired_count=1,
            service_name="ObsAstroServerAPIService",
            enable_execute_command=True,
        )

        targetgroup2 = elbv2.ApplicationTargetGroup(
            self, "TargetGroup8000",
            vpc=vpc,
            port=8000,
            targets=[serv2],
            protocol=elbv2.ApplicationProtocol.HTTP,
            target_type=elbv2.TargetType.IP
        )

        alb.add_listener("Listener8081",
            port=8081, # The port the ALB listens on for external requests
            protocol=elbv2.ApplicationProtocol.HTTP,
            default_action=elbv2.ListenerAction.forward(
                target_groups=[targetgroup2]
            )
        )

        # Grant the ALB security group access to the Fargate tasks on
        # the target port.
        serv2.connections.allow_from(alb, ec2.Port.tcp(8000),
                                     "Allow 8080 traffic from ALB")
