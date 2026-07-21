package com.nawfdev.homepanel.remoteagent.panel.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.nawfdev.homepanel.remoteagent.panel.data.PanelPrefs
import okhttp3.OkHttpClient

/** Coil loader that attaches the same bearer token ApiClient uses — poster
 * URLs from the backend (`/api/files/download?path=...`) sit behind
 * RequireAuth just like every other endpoint. */
@Composable
fun rememberAuthImageLoader(prefs: PanelPrefs): ImageLoader {
    val context = LocalContext.current
    return remember(prefs.token) {
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val builder = chain.request().newBuilder()
                prefs.token?.let { builder.addHeader("Authorization", "Bearer $it") }
                chain.proceed(builder.build())
            }
            .build()
        ImageLoader.Builder(context).okHttpClient(client).build()
    }
}

@Composable
fun AuthAsyncImage(
    url: String,
    prefs: PanelPrefs,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    val context = LocalContext.current
    val loader = rememberAuthImageLoader(prefs)
    AsyncImage(
        model = ImageRequest.Builder(context).data(url).crossfade(true).build(),
        imageLoader = loader,
        contentDescription = contentDescription,
        contentScale = contentScale,
        modifier = modifier,
    )
}
