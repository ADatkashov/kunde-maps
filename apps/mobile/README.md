# KUNDE Maps for Android and iOS

Flutter 3.50.1. Android application ID and iOS bundle ID are `kz.kunde.maps`.
The default environment is DEV. Production builds take four public HTTPS
`--dart-define` values, `KUNDE_WEB_URL`, `KUNDE_SEARCH_URL`,
`KUNDE_ROUTING_URL` and `KUNDE_TILE_URL`. Keep credentials out of build
defines and app bundles.

Run from this directory.

```sh
flutter pub get --enforce-lockfile
flutter analyze
flutter test
flutter run
```

## Android release

The manual **KUNDE Maps Android release** workflow runs from main. Use the
existing KUNDE Maps distribution key if one exists. Configure repository
secrets `KUNDE_ANDROID_KEYSTORE_B64`, `KUNDE_ANDROID_STORE_PASSWORD`,
`KUNDE_ANDROID_KEY_ALIAS` and `KUNDE_ANDROID_KEY_PASSWORD`. Store the key
securely outside the repository and retain it for upgrades. Production
additionally requires `KUNDE_PROD_WEB_URL`, `KUNDE_PROD_SEARCH_URL`,
`KUNDE_PROD_ROUTING_URL` and `KUNDE_PROD_TILE_URL` as repository variables.
The workflow verifies the APK signature and uploads the APK and its checksum.

Extract the Actions artifact ZIP. Compare the checksum and connect an
Android device with USB debugging enabled, or open the APK on the phone and
allow installation from that source.

```sh
sha256sum -c KUNDE-Maps.apk.sha256
adb install -r KUNDE-Maps.apk
```

## iOS and TestFlight

The Mobile verification workflow builds without signing on macOS. For
TestFlight, register `kz.kunde.maps` in the organization's Apple Developer
team, select that team in `ios/Runner.xcworkspace`, and configure signing
for the Runner target. On macOS, build a signed archive with
`flutter build ipa --release` using the approved provisioning profile.
Upload the signed archive through Xcode or Transporter, then configure an
internal TestFlight group. Validate permissions and background navigation
on a physical iPhone. iOS can continue an active Core Location session in
the background under system rules. Start a fresh trip after force-quitting.

## Manual device checks

1. Install the signed APK, verify the map appears, then pan, zoom, rotate and tilt.
2. Search for Abay in Almaty. Open a result and its place card. Save it,
   restart the app, and check the Saved tab.
3. Select A and B, then build a car route. Check alternatives and repeat
   for walking and cycling. Verify both directions after swapping.
4. Start navigation, grant while-in-use location and exercise approximate
   and precise permissions separately. Verify the GPS marker and ETA.
5. Simulate a trip on an emulator using its route replay or
   `adb emu geo fix LONGITUDE LATITUDE`. Feed fixes at realistic intervals.
   Confirm a turn, three sustained off-route fixes, rerouting, arrival and stop.
6. Background the app or lock the display mid-trip. Check the Android
   navigation notification and location updates on return. Revoke the
   permission and verify a new trip prompts or directs you to Settings.
7. Disable networking mid-trip. Verify the loaded route remains visible
   and test recovery after reconnect. Try RU, KK and EN and both map themes.
8. Separately record a physical trip on Android and iPhone. Measure cold
   and warm startup, first map render, frame timing, memory, CPU, search
   latency and battery impact on the target hardware and log only aggregate timings.

An emulator route replay verifies simulated behavior. Physical-device
validation requires an actual trip on the platform in question.
