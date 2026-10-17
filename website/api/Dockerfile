# SPDX-License-Identifier: MIT
#
# The Beautiful Bleep API (FastAPI). Build context: website/api.
# python:3.12-slim
FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt constraints.txt ./
RUN pip install --no-cache-dir -c constraints.txt -r requirements.txt
# The patch assistant library (agent/ in the repository, passed as the named build context `agentlib` by docker-compose.yml).
COPY --from=agentlib . /tmp/agentlib
RUN pip install --no-cache-dir -c constraints.txt /tmp/agentlib && rm -rf /tmp/agentlib
COPY . .
RUN useradd --system --no-create-home api
USER api
EXPOSE 8000
# Migrations run on start (one API instance); then the server. X-Forwarded-For is trusted only from the private networks Docker uses
# (set FORWARDED_ALLOW_IPS for another proxy address); never '*', which would let anyone who can reach port 8000 pick their own address.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips=\"${FORWARDED_ALLOW_IPS:-172.16.0.0/12,10.0.0.0/8,192.168.0.0/16}\""]
