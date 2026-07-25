FROM public.ecr.aws/docker/library/rockylinux:9
# Changed the base image to rockylinux, amazonlinux had a lot
# of problems with python modules, like pip-compile not found
# and flasgger not compatible with flask

# Update installed packages
RUN dnf update -y && dnf install -y python3 python3-pip make

RUN mkdir /opt/obs-astro
WORKDIR /opt/obs-astro
# Keep astropy's cache and any downloads on the WORKDIR filesystem, so
# it stops warning "Invalid cross-device link" when moving downloaded
# files into ~/.astropy from a tmpfs staging area.
ENV HOME=/opt/obs-astro
RUN python3 -m venv .astrovenv
ADD requirements.txt .
# commented lines are for updating the pinned requirements versions
# to latest in the docker image
# ADD requirements.in .
RUN source .astrovenv/bin/activate
# RUN pip3 install pip-tools
# RUN pip-compile requirements.in -o requirements.txt
RUN pip3 install -r requirements.txt
ADD fetch_data.py .
RUN ./fetch_data.py
ADD . .

EXPOSE 8000

CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0", "--timeout", "60", "server:app"]
