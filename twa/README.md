# FieldPulse TWA — Google Play Store Distribution

## Prerequisites
- Node.js 18+
- Java 11+ (for Android SDK)
- Android SDK (install via Android Studio)

## Build Steps

### 1. Install Bubblewrap
```bash
npm install -g @nicolo-ribaudo/bubblewrap-cli
```

### 2. Initialize TWA project
```bash
cd twa
npx bubblewrap init --manifest https://fieldpulse.app/manifest.webmanifest
```

This generates the full Android project from `twa-manifest.json`.

### 3. Digital Asset Links

The file `frontend/public/.well-known/assetlinks.json` must be served at
`https://fieldpulse.app/.well-known/assetlinks.json` with the correct SHA-256
fingerprint from your signing keystore.

Get the fingerprint:
```bash
keytool -list -v -keystore android.keystore -alias fieldpulse
```

Copy the `SHA256` value and replace `__REPLACE_WITH_YOUR_KEYSTORE_SHA256_FINGERPRINT__`
in `frontend/public/.well-known/assetlinks.json`.

Without this, Chrome will show the URL bar inside the TWA (breaking the
full-screen experience).

### 4. Build APK
```bash
npx bubblewrap build
```

Output files:
- `app-release-signed.apk` — for direct install / testing
- `app-release-bundle.aab` — for Play Store upload

### 5. Upload to Play Store
1. Go to https://play.google.com/console
2. Create new app -> "FieldPulse"
3. Upload the `.aab` file under **Production** (or Internal Testing first)
4. Fill in store listing (screenshots, description, etc.)
5. Set pricing (free)
6. Submit for review

## Testing
```bash
# Install APK directly on a connected device
adb install app-release-signed.apk

# Or use Play Store internal testing track for wider testing
```

## Configuration Reference

Edit `twa-manifest.json` to change:

| Field                  | Purpose                              |
|------------------------|--------------------------------------|
| `host`                 | Your production domain               |
| `packageId`            | Unique Android package ID            |
| `themeColor`           | Status bar color                     |
| `backgroundColor`      | Splash screen background             |
| `navigationColor`      | Android nav bar color                |
| `enableNotifications`  | Push notification support            |
| `minSdkVersion`        | Minimum Android version (19 = 4.4)   |
| `appVersionCode`       | Increment for each Play Store upload |
| `appVersionName`       | Human-readable version string        |

## Updating the App

Since TWA wraps your PWA, most updates happen on the web side:

1. Deploy updated frontend to `fieldpulse.app`
2. The service worker auto-updates on user devices
3. Only bump `appVersionCode`/`appVersionName` and rebuild the APK when
   changing TWA-specific config (icons, splash, permissions, etc.)
