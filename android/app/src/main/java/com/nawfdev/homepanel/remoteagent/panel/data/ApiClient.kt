package com.nawfdev.homepanel.remoteagent.panel.data

import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * Builds a [PanelApi] for [PanelPrefs.baseUrl], attaching the stored bearer
 * token to every request (the Android auth path — see RequireAuth's
 * bearerToken() handling in be/internal/handlers/auth.go). Rebuilt whenever
 * the base URL changes; there's no per-request base URL in Retrofit.
 */
class ApiClient(private val prefs: PanelPrefs) {
    private var cachedBaseUrl: String? = null
    private var cachedApi: PanelApi? = null

    fun api(): PanelApi {
        val baseUrl = prefs.baseUrl?.trimEnd('/') ?: error("Base URL not set")
        cachedApi?.let { if (cachedBaseUrl == baseUrl) return it }

        val json = Json { ignoreUnknownKeys = true }
        val client = OkHttpClient.Builder()
            .addInterceptor(Interceptor { chain ->
                val builder = chain.request().newBuilder()
                prefs.token?.let { builder.addHeader("Authorization", "Bearer $it") }
                chain.proceed(builder.build())
            })
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl("$baseUrl/api/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

        val api = retrofit.create(PanelApi::class.java)
        cachedBaseUrl = baseUrl
        cachedApi = api
        return api
    }

    /** Base URL changed (e.g. logged out and back in on a different host). */
    fun invalidate() {
        cachedApi = null
    }
}

fun Throwable.isUnauthorized(): Boolean = this is HttpException && code() == 401
