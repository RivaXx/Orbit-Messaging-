plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.orbit.messenger"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.orbit.messenger"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            // Match the signing certificate of existing Orbit sideloads.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.biometric:biometric:1.1.0")
}

val orbitWebAssets = layout.buildDirectory.dir("orbit-web")
val bundleOrbitWeb by tasks.registering(Sync::class) {
    from(rootProject.projectDir.resolve("../..")) {
        include("index.html", "*.css", "manifest.json", "orbit-icon*", "assets/**", "js/**")
    }
    into(orbitWebAssets)
}
android.sourceSets.getByName("main").assets.srcDir(orbitWebAssets.get().asFile)
tasks.named("preBuild") { dependsOn(bundleOrbitWeb) }

flutter {
    source = "../.."
}
