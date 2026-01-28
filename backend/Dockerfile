FROM public.ecr.aws/docker/library/rockylinux:9

# Update installed packages and install Go
RUN yum update -y && yum install -y golang iputils

RUN mkdir /opt/obs-planner
WORKDIR /opt/obs-planner
ADD go.mod go.sum .
RUN go mod download
ADD . .
RUN go build server.go db.go api.go

EXPOSE 80

CMD ["go", "run", "server.go", "db.go", "api.go"]
