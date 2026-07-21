plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization") version "1.9.24"
}

android {
    namespace = "com.nawfdev.homepanel.remoteagent"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.nawfdev.homepanel.remoteagent"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
        compose = true
    }

    composeOptions {
        // Compose compiler build matching Kotlin 1.9.24 (pre-K2 setup — no
        // separate compose Gradle plugin needed at this Kotlin version).
        kotlinCompilerExtensionVersion = "1.5.14"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Panel app shell: Compose + Navigation
    val composeBom = platform("androidx.compose:compose-bom:2024.09.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.8.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Panel REST client
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-kotlinx-serialization:2.11.0")
    // Pinned to 1.6.3 — kotlinx-serialization 1.7+ requires Kotlin 2.0, and
    // this project stays on Kotlin 1.9.24 (see composeOptions above).
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // Encrypted storage for the panel base URL + bearer token
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Stream library (progressive MP4/MKV playback) + Live TV (DASH manifests,
    // Widevine/ClearKey DRM via MediaDrm) — see panel/ui/stream and
    // panel/ui/tv. media3-datasource-okhttp lets ExoPlayer attach the same
    // bearer-token Authorization header ApiClient uses, on every manifest,
    // segment, and license request.
    val media3Version = "1.5.1"
    implementation("androidx.media3:media3-exoplayer:$media3Version")
    implementation("androidx.media3:media3-exoplayer-dash:$media3Version")
    implementation("androidx.media3:media3-exoplayer-hls:$media3Version")
    implementation("androidx.media3:media3-ui:$media3Version")
    implementation("androidx.media3:media3-datasource-okhttp:$media3Version")

    // Poster/thumbnail loading — also needs the bearer token header, wired via
    // a Coil ImageLoader built from the same OkHttpClient pattern as ApiClient.
    implementation("io.coil-kt:coil-compose:2.7.0")
}
