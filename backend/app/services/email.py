"""Email service — send transactional emails via SMTP.

Uses stdlib smtplib (synchronous).  Fails silently when SMTP_HOST is not
configured so the app works without an email provider.
"""

import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
import smtplib

from app.core.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Core sender
# ---------------------------------------------------------------------------

def send_email(
    to: str, subject: str, html_body: str,
    attachment_bytes: bytes | None = None,
    attachment_filename: str | None = None,
) -> bool:
    """Send an email via SMTP. Returns True on success, False on failure.
    Fails silently if SMTP is not configured (empty host).
    Optional binary attachment (e.g. DOCX) via attachment_bytes."""
    if not settings.SMTP_HOST:
        logger.info("[Email] SMTP not configured — skipping email to %s", to)
        return False
    try:
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
        msg["To"] = to
        msg.attach(MIMEText(html_body, "html"))

        if attachment_bytes and attachment_filename:
            part = MIMEApplication(attachment_bytes, Name=attachment_filename)
            part["Content-Disposition"] = f'attachment; filename="{attachment_filename}"'
            msg.attach(part)

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
      <p>You requested a password reset for your FieldGovern account.
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
      <p style="color: #6c7086; font-size: 12px;">FieldGovern — Field Data Collection</p>
    </div>
    """
    return send_email(to, "Reset Your FieldGovern Password", html)


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
      <p style="color: #6c7086; font-size: 12px;">FieldGovern — Field Data Collection</p>
    </div>
    """
    return send_email(to, f"Submission Flagged: {form_title}", html)


def send_daily_digest_email(
    to: str,
    recipient_name: str,
    org_name: str,
    date_label: str,           # e.g. "April 15, 2026"
    total_yesterday: int,
    total_alltime: int,
    flagged_open: int,
    top_enumerators: list,     # [{"name": str, "count": int}, ...]
    form_breakdown: list,      # [{"title": str, "count": int}, ...]
) -> bool:
    """Daily digest email for supervisors / admins."""
    url = f"{settings.APP_URL}/"

    top_enum_rows = "".join(
        f'<tr><td style="padding:6px 0;color:#cdd6f4;">{e["name"]}</td>'
        f'<td style="padding:6px 0;text-align:right;font-weight:600;color:#89b4fa;">{e["count"]}</td></tr>'
        for e in top_enumerators[:5]
    ) or '<tr><td colspan="2" style="padding:8px 0;color:#6c7086;font-style:italic;">No submissions yesterday</td></tr>'

    form_rows = "".join(
        f'<tr><td style="padding:6px 0;color:#cdd6f4;">{f["title"]}</td>'
        f'<td style="padding:6px 0;text-align:right;font-weight:600;color:#89b4fa;">{f["count"]}</td></tr>'
        for f in form_breakdown[:8]
    ) or '<tr><td colspan="2" style="padding:8px 0;color:#6c7086;font-style:italic;">No activity</td></tr>'

    flagged_badge = (
        f'<span style="background:#f38ba8;color:#1e1e2e;padding:2px 10px;border-radius:99px;'
        f'font-size:13px;font-weight:700;">{flagged_open} flagged</span>'
        if flagged_open else
        '<span style="background:#a6e3a1;color:#1e1e2e;padding:2px 10px;border-radius:99px;'
        'font-size:13px;font-weight:700;">All clear</span>'
    )

    html = f"""
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;
                background:#1e1e2e;color:#cdd6f4;padding:28px;border-radius:12px;">
      <div style="margin-bottom:20px;">
        <span style="font-size:22px;font-weight:700;color:#cba6f7;">FieldGovern</span>
        <span style="font-size:13px;color:#6c7086;margin-left:8px;">Daily Digest</span>
      </div>

      <h2 style="margin:0 0 4px;font-size:18px;color:#cdd6f4;">Hi {recipient_name},</h2>
      <p style="margin:0 0 20px;color:#6c7086;font-size:14px;">
        Here's what happened in <strong style="color:#cdd6f4;">{org_name}</strong> on {date_label}.
      </p>

      <!-- KPI row -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px;">
        <div style="background:#313244;padding:16px;border-radius:8px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#89b4fa;">{total_yesterday}</div>
          <div style="font-size:11px;color:#6c7086;margin-top:2px;">Yesterday</div>
        </div>
        <div style="background:#313244;padding:16px;border-radius:8px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#a6e3a1;">{total_alltime}</div>
          <div style="font-size:11px;color:#6c7086;margin-top:2px;">All-time</div>
        </div>
        <div style="background:#313244;padding:16px;border-radius:8px;text-align:center;">
          {flagged_badge}
          <div style="font-size:11px;color:#6c7086;margin-top:6px;">Review queue</div>
        </div>
      </div>

      <!-- Top enumerators -->
      <div style="background:#313244;padding:16px;border-radius:8px;margin-bottom:12px;">
        <div style="font-size:13px;font-weight:600;color:#cba6f7;margin-bottom:10px;">Top Enumerators (yesterday)</div>
        <table style="width:100%;border-collapse:collapse;">
          {top_enum_rows}
        </table>
      </div>

      <!-- Form breakdown -->
      <div style="background:#313244;padding:16px;border-radius:8px;margin-bottom:24px;">
        <div style="font-size:13px;font-weight:600;color:#cba6f7;margin-bottom:10px;">By Form (yesterday)</div>
        <table style="width:100%;border-collapse:collapse;">
          {form_rows}
        </table>
      </div>

      <a href="{url}"
         style="display:block;background:#89b4fa;color:#1e1e2e;text-align:center;
                padding:12px;border-radius:8px;text-decoration:none;font-weight:700;
                font-size:14px;">
        Open Dashboard →
      </a>

      <p style="margin:20px 0 0;font-size:11px;color:#45475a;text-align:center;">
        FieldGovern · You're receiving this because you're an admin or supervisor.
      </p>
    </div>
    """
    return send_email(to, f"FieldGovern Daily Digest — {date_label}", html)


def send_otp_email(to: str, name: str, otp: str) -> bool:
    """Send a 6-digit login OTP to the user."""
    html = f"""
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1e1e2e;">Your Login Code</h2>
      <p>Hi {name},</p>
      <p>Use the code below to complete your sign-in. It expires in <strong>10 minutes</strong>.</p>
      <div style="text-align: center; margin: 28px 0; padding: 20px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
        <span style="font-size: 42px; font-weight: 700; letter-spacing: 14px; color: #2563eb; font-variant-numeric: tabular-nums;">{otp}</span>
      </div>
      <p style="color: #6c7086; font-size: 14px;">
        Never share this code with anyone. FieldGovern staff will never ask for your OTP.
      </p>
      <hr style="border: none; border-top: 1px solid #d4d4de; margin: 24px 0;">
      <p style="color: #6c7086; font-size: 12px;">FieldGovern — Field Data Collection</p>
    </div>
    """
    return send_email(to, "Your FieldGovern Login Code", html)


def send_verification_email(to: str, name: str, token: str) -> bool:
    """Send an email verification link to a newly registered user."""
    url = f"{settings.APP_URL}/verify-email?token={token}"
    html = f"""
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1e1e2e;">Verify Your Email</h2>
      <p>Hi {name},</p>
      <p>Thanks for signing up for FieldGovern! Click the button below to verify your email
         and activate your free account:</p>
      <a href="{url}"
         style="display: inline-block; background: #2563eb; color: white;
                padding: 12px 24px; border-radius: 8px; text-decoration: none;
                font-weight: 600; margin: 16px 0;">
        Verify Email &amp; Activate Account
      </a>
      <p style="color: #6c7086; font-size: 14px;">
        This link expires in <strong>24 hours</strong>. If you didn't create an account, ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #d4d4de; margin: 24px 0;">
      <p style="color: #6c7086; font-size: 12px;">FieldGovern — Field Data Collection</p>
    </div>
    """
    return send_email(to, "Verify your FieldGovern account", html)


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
        Open FieldGovern
      </a>
      <hr style="border: none; border-top: 1px solid #d4d4de; margin: 24px 0;">
      <p style="color: #6c7086; font-size: 12px;">FieldGovern — Field Data Collection</p>
    </div>
    """
    return send_email(to, f"New Form: {form_title}", html)
