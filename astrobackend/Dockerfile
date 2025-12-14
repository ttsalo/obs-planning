FROM public.ecr.aws/docker/library/rockylinux:8
# Changed the base image to rockylinux, amazonlinux had a lot
# of problems with python modules, like pip-compile not found
# and flasgger not compatible with flask
# FROM public.ecr.aws/amazonlinux/amazonlinux:latest

# Update installed packages
RUN dnf update -y && dnf install -y python3 python3-pip

RUN mkdir /opt/obs-astro
WORKDIR /opt/obs-astro
RUN python3 -m venv .astrovenv
ADD requirements.txt .
RUN source .astrovenv/bin/activate
RUN pip3 install -r requirements.txt
ADD fetch_data.py .
RUN ./fetch_data.py
ADD . .

EXPOSE 8000

CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0", "server:app"]
