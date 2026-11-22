plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val releaseKeystore = providers.environmentVariable("KUNDE_ANDROID_KEYSTORE")
val releaseStorePassword = providers.environmentVariable("KUNDE_ANDROID_STORE_PASSWORD")
val releaseKeyAlias = providers.environmentVariable("KUNDE_ANDROID_KEY_ALIAS")
val releaseKeyPassword = providers.environmentVariable("KUNDE_ANDROID_KEY_PASSWORD")
val releaseInputs = listOf(releaseKeystore, releaseStorePassword, releaseKeyAlias, releaseKeyPassword)
val signRelease = releaseInputs.all { !it.orNull.isNullOrBlank() }
require(signRelease || releaseInputs.none { !it.orNull.isNullOrBlank() }) {
    "Provide all four KUNDE_ANDROID signing variables"
}

android {
    namespace = "kz.kunde.maps"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "kz.kunde.maps"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = maxOf(23, flutter.minSdkVersion)
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (signRelease) {
            create("kundeRelease") {
                storeFile = file(releaseKeystore.get())
                storePassword = releaseStorePassword.get()
                keyAlias = releaseKeyAlias.get()
                keyPassword = releaseKeyPassword.get()
            }
        }
    }

    buildTypes {
        release {
            if (signRelease) signingConfig = signingConfigs.getByName("kundeRelease")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
