package com.nawfdev.homepanel.remoteagent.panel.data

import kotlinx.serialization.Serializable
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

// DTOs mirror the JSON shapes from be/internal/handlers/auth.go and
// dashboard.go. Every response type declares only the fields this app
// currently uses — ApiClient configures kotlinx.serialization with
// ignoreUnknownKeys so backend fields we don't model yet are simply skipped.

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class UserDto(
    val id: Int = 0,
    val username: String = "",
    val role: String = "",
    val features: List<String> = emptyList(),
)

@Serializable
data class LoginResponse(val success: Boolean = false, val token: String = "", val user: UserDto = UserDto())

@Serializable
data class MeResponse(val user: UserDto = UserDto())

@Serializable
data class CpuStats(val usage: Double = 0.0, val cores: Int = 0)

@Serializable
data class MemoryStats(val total: Long = 0, val used: Long = 0, val free: Long = 0, val usagePercent: Double = 0.0)

@Serializable
data class OsStats(
    val platform: String = "",
    val distro: String = "",
    val release: String = "",
    val hostname: String = "",
    val arch: String = "",
)

@Serializable
data class SystemStats(
    val cpu: CpuStats = CpuStats(),
    val memory: MemoryStats = MemoryStats(),
    val os: OsStats = OsStats(),
    val uptime: Long = 0,
)

@Serializable
data class TunnelInfo(val configured: Boolean = false, val processRunning: Boolean = false)

@Serializable
data class ProjectsSummary(val total: Int = 0, val running: Int = 0)

@Serializable
data class DashboardResponse(
    val system: SystemStats = SystemStats(),
    val tunnel: TunnelInfo = TunnelInfo(),
    val projects: ProjectsSummary = ProjectsSummary(),
)

// --- Files ---

@Serializable
data class FilesListRequest(val path: String = "")

@Serializable
data class FileItem(
    val name: String,
    val path: String,
    val isDirectory: Boolean = false,
    val size: Long = 0,
    val modified: String = "",
)

@Serializable
data class FilesListResponse(
    val success: Boolean = false,
    val path: String? = null,
    val items: List<FileItem> = emptyList(),
    val error: String? = null,
)

// --- Network ---

@Serializable
data class NetInterface(
    val name: String = "",
    val ip4: String? = null,
    val ip6: String? = null,
    val mac: String? = null,
    val internal: Boolean = false,
)

@Serializable
data class NetworkInfo(
    val publicIp: String = "",
    val interfaces: List<NetInterface> = emptyList(),
    val connections: Int = 0,
    val connectivity: Boolean = false,
    val gateway: String? = null,
)

@Serializable
data class NetworkInfoResponse(val success: Boolean = false, val network: NetworkInfo = NetworkInfo())

// --- Services ---

@Serializable
data class ServiceInfo(
    val name: String = "",
    val status: String = "",
    val type: String = "",
)

@Serializable
data class ServicesListResponse(
    val success: Boolean = false,
    val services: List<ServiceInfo> = emptyList(),
    val platform: String = "",
    val error: String? = null,
)

@Serializable
data class ServiceActionResponse(val success: Boolean = false, val message: String? = null, val error: String? = null)

// --- Logs ---

@Serializable
data class LogSource(
    val id: String = "",
    val name: String = "",
    val type: String = "",
    val available: Boolean = false,
)

@Serializable
data class LogSourcesResponse(val success: Boolean = false, val sources: List<LogSource> = emptyList())

@Serializable
data class LogTarget(val id: String = "", val name: String = "")

@Serializable
data class LogTargetsResponse(val success: Boolean = false, val targets: List<LogTarget> = emptyList())

@Serializable
data class LogContentResponse(val success: Boolean = false, val logs: String = "")

// --- PM2 ---

@Serializable
data class Pm2Process(
    val name: String = "",
    val pid: Int = 0,
    val status: String = "",
    val memory: Long = 0,
    val uptime: String = "",
    val restarts: Int = 0,
    val mode: String = "",
)

@Serializable
data class Pm2ListResponse(
    val success: Boolean = false,
    val processes: List<Pm2Process> = emptyList(),
    val error: String? = null,
)

@Serializable
data class Pm2ActionResponse(val success: Boolean = false, val message: String? = null)

// --- Docker ---

@Serializable
data class DockerContainer(
    val id: String = "",
    val name: String = "",
    val image: String = "",
    val state: String = "",
    val status: String = "",
    val ports: String = "",
)

@Serializable
data class DockerListResponse(
    val success: Boolean = false,
    val containers: List<DockerContainer> = emptyList(),
    val error: String? = null,
)

@Serializable
data class DockerActionResponse(val success: Boolean = false, val message: String? = null)

// --- Tunnel (read-only status) ---

@Serializable
data class CloudflaredInfo(val installed: Boolean = false, val version: String? = null)

@Serializable
data class TunnelStatus(
    val processRunning: Boolean = false,
    val isReady: Boolean = false,
    val autoRestart: Boolean = false,
    val restartCount: Int = 0,
    val pid: Int? = null,
    val cloudflared: CloudflaredInfo = CloudflaredInfo(),
)

// --- Users / Roles (admin-only, see be/internal/handlers/users.go) ---

@Serializable
data class FamilyUser(
    val id: Int = 0,
    val username: String = "",
    val role: String = "",
    @kotlinx.serialization.SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class CreateUserRequest(val username: String, val password: String, val role: String)

@Serializable
data class UpdateUserRequest(val role: String? = null, val newPassword: String? = null)

@Serializable
data class Role(
    val id: String = "",
    val label: String = "",
    val features: List<String> = emptyList(),
    val locked: Boolean = false,
)

@Serializable
data class RolesResponse(val roles: List<Role> = emptyList(), val featureKeys: List<String> = emptyList())

@Serializable
data class UpdateRoleRequest(val features: List<String>)

@Serializable
data class SuccessResponse(val success: Boolean = false)

// --- Cloudflare / Telegram (read-only status) ---

@Serializable
data class CloudflareStatus(
    val configured: Boolean = false,
    val connected: Boolean = false,
    val error: String = "",
    val accountId: String = "",
)

@Serializable
data class TelegramStatus(
    val connected: Boolean = false,
    val configured: Boolean = false,
    val monitoring: Boolean = false,
    val chatId: String? = null,
    val notificationsEnabled: Boolean = false,
)

// --- Projects ---

@Serializable
data class Project(
    val id: Int = 0,
    val name: String = "",
    val path: String = "",
    val port: Int = 0,
    val domain: String = "",
    val status: String = "",
    val pid: Int = 0,
)

@Serializable
data class ProjectActionResult(val success: Boolean = false, val message: String = "")

// --- AI Gateway (providers overview only — usage stats are a follow-up) ---

@Serializable
data class AiKeyView(val id: String = "", val label: String = "", val masked: String = "")

@Serializable
data class AiProviderView(
    val id: String = "",
    val name: String = "",
    val kind: String = "",
    val enabled: Boolean = false,
    val keys: List<AiKeyView> = emptyList(),
)

@Serializable
data class ProvidersResponse(val success: Boolean = false, val providers: List<AiProviderView> = emptyList())

// --- Movies (search + download queue; no in-app playback yet) ---

@Serializable
data class MovieSearchRequest(val query: String = "", val page: Int = 1)

@Serializable
data class Film(val title: String = "", val poster: String = "", val detailUrl: String = "", val year: String = "")

@Serializable
data class MovieSearchResponse(val success: Boolean = false, val films: List<Film> = emptyList(), val error: String? = null)

@Serializable
data class MovieDetailRequest(val url: String)

@Serializable
data class DownloadOption(val quality: String = "", val size: String = "", val host: String = "", val link: String = "")

@Serializable
data class MovieDetailResponse(val success: Boolean = false, val options: List<DownloadOption> = emptyList(), val error: String? = null)

@Serializable
data class MovieStartDownloadRequest(val title: String, val url: String, val poster: String = "")

@Serializable
data class Job(
    val id: String = "",
    val title: String = "",
    val dest: String = "",
    val poster: String? = null,
    val status: String = "",
    val downloaded: Long = 0,
    val total: Long = 0,
    val speedBps: Long = 0,
    val error: String? = null,
)

@Serializable
data class MovieStartDownloadResponse(val success: Boolean = false, val job: Job? = null, val error: String? = null)

@Serializable
data class MoviesListResponse(val success: Boolean = false, val jobs: List<Job> = emptyList())

// --- Stream library (manual add + rename/re-thumbnail/delete of finished
// downloads; see be/internal/handlers/movies.go) ---

@Serializable
data class MovieRenameRequest(val title: String)

@Serializable
data class MovieLibraryResponse(val success: Boolean = false, val job: Job? = null, val error: String? = null)

// --- Live TV (be/internal/tv/tv.go — channels parsed from public M3U
// playlists, some DASH/HLS with ClearKey or Widevine DRM) ---

@Serializable
data class DrmInfo(
    val system: String = "unknown", // "clearkey" | "widevine" | "unknown"
    val clearKeys: Map<String, String>? = null,
    val serverUrl: String? = null,
)

@Serializable
data class Channel(
    val id: String = "",
    val name: String = "",
    val tvgId: String? = null,
    val logo: String? = null,
    val group: String? = null,
    val source: String? = null,
    val url: String = "",
    val type: String = "hls", // "hls" | "dash" | "ts"
    val headers: Map<String, String>? = null,
    val drm: DrmInfo? = null,
)

@Serializable
data class ChannelsResponse(val success: Boolean = false, val channels: List<Channel> = emptyList())

interface PanelApi {
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @GET("auth/me")
    suspend fun me(): MeResponse

    @POST("auth/logout")
    suspend fun logout()

    @GET("dashboard")
    suspend fun dashboard(): DashboardResponse

    @POST("files/list")
    suspend fun filesList(@Body body: FilesListRequest): FilesListResponse

    @GET("network/info")
    suspend fun networkInfo(): NetworkInfoResponse

    @GET("services")
    suspend fun services(): ServicesListResponse

    @POST("services/{name}/start")
    suspend fun startService(@Path("name") name: String): ServiceActionResponse

    @POST("services/{name}/stop")
    suspend fun stopService(@Path("name") name: String): ServiceActionResponse

    @GET("logs/sources")
    suspend fun logSources(): LogSourcesResponse

    @GET("logs/sources/{sourceId}/targets")
    suspend fun logTargets(@Path("sourceId") sourceId: String): LogTargetsResponse

    @GET("logs/sources/{sourceId}")
    suspend fun logContent(
        @Path("sourceId") sourceId: String,
        @Query("lines") lines: Int = 200,
        @Query("target") target: String? = null,
        @Query("search") search: String? = null,
    ): LogContentResponse

    @GET("pm2/processes")
    suspend fun pm2Processes(): Pm2ListResponse

    @POST("pm2/processes/{name}/start")
    suspend fun pm2Start(@Path("name") name: String): Pm2ActionResponse

    @POST("pm2/processes/{name}/stop")
    suspend fun pm2Stop(@Path("name") name: String): Pm2ActionResponse

    @POST("pm2/processes/{name}/restart")
    suspend fun pm2Restart(@Path("name") name: String): Pm2ActionResponse

    @GET("docker/containers")
    suspend fun dockerContainers(): DockerListResponse

    @POST("docker/containers/{id}/start")
    suspend fun dockerStart(@Path("id") id: String): DockerActionResponse

    @POST("docker/containers/{id}/stop")
    suspend fun dockerStop(@Path("id") id: String): DockerActionResponse

    @POST("docker/containers/{id}/restart")
    suspend fun dockerRestart(@Path("id") id: String): DockerActionResponse

    @GET("tunnel/status")
    suspend fun tunnelStatus(): TunnelStatus

    @GET("users")
    suspend fun listUsers(): List<FamilyUser>

    @POST("users")
    suspend fun createUser(@Body body: CreateUserRequest): FamilyUser

    @retrofit2.http.PUT("users/{id}")
    suspend fun updateUser(@Path("id") id: Int, @Body body: UpdateUserRequest): FamilyUser

    @retrofit2.http.DELETE("users/{id}")
    suspend fun deleteUser(@Path("id") id: Int): SuccessResponse

    @GET("roles")
    suspend fun listRoles(): RolesResponse

    @retrofit2.http.PUT("roles/{id}")
    suspend fun updateRole(@Path("id") id: String, @Body body: UpdateRoleRequest): Role

    @GET("cloudflare/status")
    suspend fun cloudflareStatus(): CloudflareStatus

    @GET("telegram/status")
    suspend fun telegramStatus(): TelegramStatus

    @GET("projects")
    suspend fun listProjects(): List<Project>

    @POST("projects/{id}/start")
    suspend fun startProject(@Path("id") id: Int): ProjectActionResult

    @POST("projects/{id}/stop")
    suspend fun stopProject(@Path("id") id: Int): ProjectActionResult

    @POST("projects/{id}/restart")
    suspend fun restartProject(@Path("id") id: Int): ProjectActionResult

    @GET("ai-gateway/providers")
    suspend fun aiGatewayProviders(): ProvidersResponse

    @POST("movies/search")
    suspend fun moviesSearch(@Body body: MovieSearchRequest): MovieSearchResponse

    @POST("movies/detail")
    suspend fun movieDetail(@Body body: MovieDetailRequest): MovieDetailResponse

    @POST("movies/download")
    suspend fun startMovieDownload(@Body body: MovieStartDownloadRequest): MovieStartDownloadResponse

    @GET("movies/downloads")
    suspend fun listDownloads(): MoviesListResponse

    @retrofit2.http.DELETE("movies/downloads/{id}")
    suspend fun cancelDownload(@Path("id") id: String): SuccessResponse

    @POST("movies/downloads/{id}/pause")
    suspend fun pauseDownload(@Path("id") id: String): SuccessResponse

    @POST("movies/downloads/{id}/resume")
    suspend fun resumeDownload(@Path("id") id: String): SuccessResponse

    @Multipart
    @POST("movies/manual")
    suspend fun addMovieManual(
        @Part("title") title: RequestBody,
        @Part file: MultipartBody.Part,
        @Part poster: MultipartBody.Part?,
    ): MovieLibraryResponse

    @PATCH("movies/library/{id}")
    suspend fun renameMovie(@Path("id") id: String, @Body body: MovieRenameRequest): MovieLibraryResponse

    @Multipart
    @POST("movies/library/{id}/thumbnail")
    suspend fun updateMovieThumbnail(@Path("id") id: String, @Part file: MultipartBody.Part): MovieLibraryResponse

    @retrofit2.http.DELETE("movies/library/{id}")
    suspend fun deleteMovie(@Path("id") id: String): SuccessResponse

    @GET("tv/channels")
    suspend fun tvChannels(): ChannelsResponse
}
