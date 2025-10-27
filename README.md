# obs-planning
Graphical astronomical observations planning utility

# Setup
- Install AWS CLI and set up SSO
- Install AWS CDK
- Install docker
- Install golang

# Build backend image
`cd backend
make build`

## Push the latest backend image
`cd backend
make push`

## Build and run the backend locally
`cd backend
make runserver`

# Set up CDK (one-time setup in the repo)
`mkdir obs-ecs
cd obs-ecs
cdk bootstrap
cdk init --language python`

# Init CDK
`cd obs-ecs
source .venv/bin/activate
pip install -r requirements.txt`

# Deployment cycle of the built and pushed image
`cd obs-ecs
cdk synth
cdk deploy
cdk destroy`
