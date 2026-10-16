# SPDX-License-Identifier: MIT
import time
from collections import deque

from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from .. import mail
from ..config import settings
from ..schemas import ContactIn

router = APIRouter(prefix="/api/contact", tags=["contact"])

LIMIT, WINDOW = 10, 600  # at most this many messages in this many seconds, for the whole site (nobody can mail-bomb the inbox through us)
_recent: deque[float] = deque()


@router.post("", status_code=status.HTTP_202_ACCEPTED)
def contact(body: ContactIn, tasks: BackgroundTasks):
    if body.website:  # honeypot: pretend success
        return {"ok": True}
    to = settings.contact_to or settings.smtp_user
    t = time.monotonic()
    while _recent and t - _recent[0] > WINDOW:
        _recent.popleft()
    if len(_recent) >= LIMIT:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many messages right now, please try again later")
    _recent.append(t)
    tasks.add_task(mail.send, to or "", f"Contact form: {body.name}", f"From: {body.name} <{body.email}>\n\n{body.message}\n", body.email)
    return {"ok": True}
