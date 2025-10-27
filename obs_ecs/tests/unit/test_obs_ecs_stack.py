import aws_cdk as core
import aws_cdk.assertions as assertions

from obs_ecs.obs_ecs_stack import ObsEcsStack

# example tests. To run these tests, uncomment this file along with the example
# resource in obs_ecs/obs_ecs_stack.py
def test_sqs_queue_created():
    app = core.App()
    stack = ObsEcsStack(app, "obs-ecs")
    template = assertions.Template.from_stack(stack)

#     template.has_resource_properties("AWS::SQS::Queue", {
#         "VisibilityTimeout": 300
#     })
