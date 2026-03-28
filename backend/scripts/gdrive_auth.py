"""
One-time Google Drive OAuth2 authorization.

Run:  cd backend && python scripts/gdrive_auth.py

A browser opens → sign in → grant access → token is saved automatically.
"""
import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/drive.file"]
CLIENT_SECRET = Path("credentials/gdrive-oauth-client.json")
TOKEN_PATH = Path("credentials/gdrive-token.json")


def main():
    if not CLIENT_SECRET.exists():
        print(f"\nOAuth client secret not found at: {CLIENT_SECRET}")
        print("\nTo fix:")
        print("  1. Go to https://console.cloud.google.com/apis/credentials")
        print("  2. Create OAuth 2.0 Client ID (type: Desktop app)")
        print("  3. Download JSON")
        print(f"  4. Save as: {CLIENT_SECRET.absolute()}")
        sys.exit(1)

    print("\nStarting Google Drive authorization...")
    print("A browser window will open. Sign in with your Google account.\n")

    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), SCOPES)

    # Use console-based flow (no local server needed)
    creds = flow.run_local_server(
        port=8090,
        open_browser=True,
        authorization_prompt_message="Opening browser for authorization...",
        success_message="Authorization complete! You can close this tab and return to the terminal.",
        timeout_seconds=120,
    )

    # Save token
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.write_text(creds.to_json())

    print(f"\nAuthorization successful!")
    print(f"Token saved to: {TOKEN_PATH.absolute()}")
    print(f"\nYou can now start the backend - Drive uploads will work automatically.")

    # Quick test
    from googleapiclient.discovery import build
    svc = build("drive", "v3", credentials=creds, cache_discovery=False)
    about = svc.about().get(fields="user").execute()
    print(f"Authorized as: {about['user']['emailAddress']}\n")


if __name__ == "__main__":
    main()
