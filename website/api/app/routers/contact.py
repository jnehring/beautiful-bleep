# SPDX-License-Identifier: MIT
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from .. import mail
from ..config import settings
from ..ratelimit import client_ip, limiter
from ..schemas import ContactIn

router = APIRouter(prefix="/api/contact", tags=["contact"])

LIMIT, WINDOW = 5, 600  # per visitor address: at most this many messages in this many seconds
GLOBAL_LIMIT, GLOBAL_WINDOW = 100, 3600  # and for the whole site, so the inbox cannot be mail-bombed from many addresses
_per_ip = limiter(LIMIT, WINDOW)
_global = limiter(GLOBAL_LIMIT, GLOBAL_WINDOW)


@router.post("", status_code=status.HTTP_202_ACCEPTED)
def contact(body: ContactIn, request: Request, tasks: BackgroundTasks):
    if body.website:  # honeypot: pretend success
        return {"ok": True}
    to = settings.contact_to or settings.smtp_user
    if not _per_ip.hit(client_ip(request)) or not _global.hit("site"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many messages right now, please try again later")
    tasks.add_task(mail.send, to or "", f"Contact form: {body.name}", f"From: {body.name} <{body.email}>\n\n{body.message}\n", body.email)
    return {"ok": True}
