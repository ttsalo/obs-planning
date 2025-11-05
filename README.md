# obs-planning
Graphical astronomical observations planning utility

# Setup
- Install AWS CLI and set up SSO
- Install AWS CDK
- Install docker
- Install golang
- Install node.js: `nvm install 22`

# Set up React (one-time setup in the repo)
```
cd backend
npm create vite@latest
```

# Build UI code
```
cd ubs-ui
npm run build
```

# Build backend image (includes UI build)
`make build`

# Run backend image locally
`make runserver`

## Push the latest backend image to AWS
```
cd backend
make push
```

# Set up CDK (one-time setup in the repo)
```
mkdir obs-ecs
cd obs-ecs
cdk bootstrap
cdk init --language python
source .venv/bin/activate
pip install -r requirements.txt
```

# Init CDK
```
cd obs_ecs
source .venv/bin/activate
```
`aws sso login` if needed

Also may need to unset

`unset AWS_SECRET_ACCESS_KEY AWS_ACCESS_KEY_ID AWS_SESSION_TOKEN` 

as these will interfere with the sso login, whose details are looked up from whe AWS CLI config using `AWS_PROFILE` env variable. 

# Deployment cycle of the built and pushed image
```
cd obs_ecs
cdk synth
cdk deploy
cdk destroy
```
