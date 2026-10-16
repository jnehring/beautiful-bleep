# SPDX-License-Identifier: MIT
"""Outgoing email: the two messages the accounts need (confirm the address, reset the password).

Sent over SMTP with STARTTLS (Gmail: smtp.gmail.com:587 and an app password). Without BLEEP_SMTP_HOST the message is only
logged, so development and tests need no mail server. Callers hand `send` to FastAPI's BackgroundTasks, so a slow or
failing mail server never delays or breaks the request."""
import logging
import smtplib
import ssl
from email.message import EmailMessage

from .config import settings

log = logging.getLogger("bleep.mail")


def send(to: str, subject: str, body: str, reply_to: str | None = None) -> None:
    sender = settings.smtp_from or settings.smtp_user
    if not (settings.smtp_host and sender):
        log.warning("Email not sent (BLEEP_SMTP_HOST is not set). To: %s\nSubject: %s\n\n%s", to, subject, body)
        return
    msg = EmailMessage()
    msg["From"] = f"Beautiful Bleep <{sender}>"
    msg["To"] = to
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            if settings.smtp_user and settings.smtp_password:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException):
        log.exception("Could not send email to %s", to)  # the address stays out of the user's view: nothing to tell them


def verification_message(name: str, link: str) -> tuple[str, str]:
    return "Confirm your email address", (
        f"Hi {name},\n\nwelcome to Beautiful Bleep. Please confirm your email address:\n\n{link}\n\n"
        f"The link works for {settings.verify_hours} hours. If you did not register, ignore this message.\n")


def reset_message(name: str, link: str) -> tuple[str, str]:
    return "Reset your password", (
        f"Hi {name},\n\nsomeone asked to reset the password of your Beautiful Bleep account. Choose a new one here:\n\n{link}\n\n"
        f"The link works once, for {settings.reset_minutes} minutes. If it was not you, ignore this message; your password stays as it is.\n")
