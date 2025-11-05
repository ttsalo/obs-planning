import json

import aws_cdk as cdk
from constructs import Construct

import aws_cdk.aws_ecs as ecs
import aws_cdk.aws_ecs_patterns as ecsp
import aws_cdk.aws_ecr as ecr
import aws_cdk.aws_ec2 as ec2
import aws_cdk.aws_elasticloadbalancingv2 as elbv2


class ObsEcsStack(cdk.Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        with open("../backend/repository.json", "r") as f:
            repository = json.load(f).get("repository")

        print(f"Using server repo: {repository}")

        vpc = ec2.Vpc(self, "ObsVpc", max_azs=2)
        cluster = ecs.Cluster(self, "ObsCluster", vpc=vpc)

        serv1 = ecsp.ApplicationLoadBalancedFargateService(
            self, "ObsServerService",
            task_image_options=ecsp.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_ecr_repository(
                    ecr.Repository.from_repository_arn(
                        scope=self, id="ObsServerRepo",
                        repository_arn=repository["repositoryArn"])),
                container_port=80),
            cluster=cluster,
            public_load_balancer=True,
            service_name="ObsServerAPIService"
        )

        with open("../astrobackend/repository.json", "r") as f:
            repository2 = json.load(f).get("repository")

        print(f"Using astro server repo: {repository2}")

        alb = serv1.load_balancer
        taskdef2 = ecs.FargateTaskDefinition(self, "ObsAstroServerTask")
        container2 = taskdef2.add_container("ObsAstroServerContainer",
            image=ecs.ContainerImage.from_ecr_repository(
                ecr.Repository.from_repository_arn(
                    scope=self, id="ObsAstroServerRepo",
                    repository_arn=repository2["repositoryArn"])),
            memory_limit_mib=256,
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
            service_name="ObsAstroServerAPIService"
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
        # the target port
        serv2.connections.allow_from(alb, ec2.Port.tcp(8000),
                                     "Allow 8080 traffic from ALB")
