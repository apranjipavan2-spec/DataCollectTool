"""Email service — send transactional emails via SMTP.

Uses stdlib smtplib (synchronous).  Fails silently when SMTP_HOST is not
configured so the app works without an email provider.
"""

import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib

from app.core.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Core sender
# ---------------------------------------------------------------------------

def send_email(to: str, subject: str, html_body: str) -> bool:
    """Send an email via SMTP. Returns True on success, False on failure.
    Fails silently if SMTP is not configured (empty host)."""
    if not settings.SMTP_HOST:
        logger.info("[Email] SMTP not configured — skipping email to %s", to)
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
        msg["To"] = to
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            if settings.SMTP_USE_TLS:
                server.starttls()
            if settings.SMTP_USER:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
        logger.info("[Email] Sent to %s: %s", to, subject)
        return True
    except Exception as e:
        logger.error("[Email] Failed to send to %s: %s", to, e)
        return False


# ---------------------------------------------------------------------------
# Template helpers
# ---------------------------------------------------------------------------

def send_password_reset_email(to: str, name: str, reset_token: str) -> bool:
    """Send a password-reset link to the user."""
    url = f"{settings.APP_URL}/reset-password?token={reset_token}"
    html = f"""
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1e1e2e;">Reset Your Password</h2>
      <p>Hi {name},</p>
      <p>You requested a password reset for your FieldPulse account.
         Click the button below to set a new password:</p>
      <a href="{url}"
         style="display: inline-block; background: #2563eb; color: white;
                padding: 12px 24px; border-radius: 8px; text-decoration: none;
                font-weight: 600; margin: 16px 0;">
        Reset Password
      </a>
      <p style="color: #6c7086; font-size: 14px;">
        This link expires in 1 hour. If you didn't request this, ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #d4d4de; margin: 24px 0;">
      <p style="color: #6c7086; font-size: 12px;">FieldPulse — Field Data Collection</p>
    </div>
    """
    return send_email(to, "Reset Your FieldPulse Password", html)


def send_flagged_submission_email(
    to: str,
    supervisor_name: str,
    form_title: str,
    enumerator_name: str,
    flag_note: str,
    submission_id: str,
) -> bool:
    """Notify supervisors / admins that a submission has been flagged."""
    url = f"{settings.APP_URL}/?tab=submissions"
    html = f"""
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1e1e2e;">Submission Flagged</h2>
      <p>A submission has been flagged for review:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px 0; color: #6c7086; width: 120px;">Form</td>
          <td style="padding: 8px 0; font-weight: 600;">{form_title}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6c7086;">Enumerator</td>
          <td style="padding: 8px 0;">{enumerator_name}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6c7086;">Flagged by</td>
          <td style="padding: 8px 0;">{supervisor_name}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6c7086;">Note</td>
          <td style="padding: 8px 0; color: #ca8a04;">{flag_note or "No note provided"}</td>
        </tr>
      </table>
      <a href="{url}"
         style="display: inline-block; background: #2563eb; color: white;
                padding: 12px 24px; border-radius: 8px; text-decoration: none;
                font-weight: 600;">
        Review in Dashboard
      </a>
      <hr style="border: none; border-top: 1px solid #d4d4de; margin: 24px 0;">
      <p style="color: #6c7086; font-size: 12px;">FieldPulse — Field Data Collection</p>
    </div>
    """
    return send_email(to, f"Submission Flagged: {form_title}", html)


def send_assignment_email(to: str, enumerator_name: str, form_title: str) -> bool:
    """Notify an enumerator that a new form has been assigned to them."""
    url = f"{settings.APP_URL}/collect"
    html = f"""
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1e1e2e;">New Form Assigned</h2>
      <p>Hi {enumerator_name},</p>
      <p>You have been assigned a new form: <strong>{form_title}</strong></p>
      <a href="{url}"
         style="display: inline-block; background: #2563eb; color: white;
                padding: 12px 24px; border-radius: 8px; text-decoration: none;
                font-weight: 600; margin: 16px 0;">
        Open FieldPulse
      </a>
      <hr style="border: none; border-top: 1px solid #d4d4de; margin: 24px 0;">
      <p style="color: #6c7086; font-size: 12px;">FieldPulse — Field Data Collection</p>
    </div>
    """
    return send_email(to, f"New Form: {form_title}", html)
