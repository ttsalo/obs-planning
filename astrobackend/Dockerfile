FROM public.ecr.aws/amazonlinux/amazonlinux:latest

# Update installed packages
RUN yum update -y && yum install -y pip

RUN mkdir /opt/obs-astro
WORKDIR /opt/obs-astro
RUN python3 -m venv .astrovenv
ADD requirements.txt .
RUN source .astrovenv/bin/activate
RUN pip install -r requirements.txt
ADD fetch_data.py .
RUN ./fetch_data.py
ADD . .

EXPOSE 8000

CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0", "server:app"]
