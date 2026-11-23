# Orbit for Android

This Flutter project owns the app lock, Android lifecycle, and platform integration. Gradle bundles the web app from the repository root under the existing `https://appassets.androidplatform.net/assets/` origin. That keeps messages, media, and encryption compatible with the web client and lets an in-place Android update reuse the existing WebView session and caches.

Build from `apk/` with Flutter 3.44.0, JDK 17, and the Android SDK 36. Run `flutter pub get` and then `flutter build apk --release`. The output is `build/app/outputs/flutter-apk/app-release.apk`. The compatibility build uses the original machine’s Android debug signing certificate so Android can upgrade v1.0.1 in place. That keystore stays outside the repository. Only releases signed with the installed certificate can update those installations.

Release Android and web from the same commit. Bump the build and version numbers in `pubspec.yaml`, build and sign `Orbit-Messenger-v<version>.apk`, and record the final APK’s SHA-256 in `orbit-update.json`. Attach the APK to the matching GitHub release and publish the manifest on Vercel. The Android updater checks the checksum, package, version, and installed signing certificate before opening the system installer. Android may ask for permission to install apps from Orbit.

The four-digit PIN is chosen during setup. Strong enrolled biometrics are an alternative after setup. The PIN verifier and saved chat identity use separate Android Keystore keys, and failed PIN attempts trigger a persistent delay. Keep the recovery passphrase or generated recovery code for reinstalling or moving to another device. The app PIN gates access to the local chat identity. The browser’s opt-in remembered access is scoped to its local profile. The seven-day sign-in checkpoint is enforced by the client while Supabase continues to validate credentials and tokens.

Android posts native alerts for events received while the messaging client is connected. The existing web-push endpoint serves browsers. Receiving alerts after Android stops the app process requires a provisioned Android push transport.
