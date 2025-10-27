FROM public.ecr.aws/amazonlinux/amazonlinux:latest

# Update installed packages and install Go
RUN yum update -y && yum install -y golang

RUN mkdir /opt/obs-planner
WORKDIR /opt/obs-planner
ADD go.mod go.sum .
RUN go mod download
ADD . .

EXPOSE 80

CMD go run server.go
