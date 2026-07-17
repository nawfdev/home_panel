package com.nawfdev.homepanel.remoteagent.panel.data

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

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

interface PanelApi {
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @GET("auth/me")
    suspend fun me(): MeResponse

    @POST("auth/logout")
    suspend fun logout()

    @GET("dashboard")
    suspend fun dashboard(): DashboardResponse
}
