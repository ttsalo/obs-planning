import json

import aws_cdk as cdk
from constructs import Construct

import aws_cdk.aws_ecs as ecs
import aws_cdk.aws_ecs_patterns as ecsp
import aws_cdk.aws_ecr as ecr

class ObsEcsStack(cdk.Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        with open("../backend/repository.json", "r") as f:
            repository = json.load(f).get("repository")

        print(f"Using: {repository}")

        ecsp.ApplicationLoadBalancedFargateService(self, "ObsServer",
            task_image_options=ecsp.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_ecr_repository(
                    ecr.Repository.from_repository_arn(
                        scope=self, id="ObsServerRepo",
                        repository_arn=repository["repositoryArn"]))),
            public_load_balancer=True
        )
        
