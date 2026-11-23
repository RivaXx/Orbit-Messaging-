# Orbit for Android

This Flutter project owns the app lock, Android lifecycle, and platform integration. Gradle bundles the web app from the repository root under the existing `https://appassets.androidplatform.net/assets/` origin. That keeps messages, media, and encryption compatible with the web client and lets an in-place Android update reuse the existing WebView session and caches.

Build from `apk/` with Flutter 3.44.0, JDK 17, and the Android SDK 36. Run `flutter pub get` and then `flutter build apk --release`. The output is `build/app/outputs/flutter-apk/app-release.apk`. The compatibility build uses the original machine’s Android debug signing certificate so Android can upgrade v1.0.1 in place. That keystore stays outside the repository. Only releases signed with the installed certificate can update those installations.

Release Android and web from the same commit. Bump the build and version numbers in `pubspec.yaml`, build and sign `Orbit-Messenger-v<version>.apk`, attach it to the corresponding GitHub release, and update the public `orbit-update.json` on Vercel. Keep the update manifest and GitHub APK available at the URLs in that file.

The four-digit PIN is chosen during setup. Strong enrolled biometrics are an alternative after setup. The PIN verifier and remembered encryption data use separate Android Keystore keys, and failed PIN attempts trigger a persistent delay. Keep the original chat recovery passphrase for new devices and recovery. The browser’s opt-in remembered access is scoped to its local profile. The seven-day sign-in checkpoint is enforced by the client while Supabase continues to validate credentials and tokens.
