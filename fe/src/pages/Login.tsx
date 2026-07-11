import { useState, type FormEvent } from "react";
import { useAuth, ApiError } from "../context/AuthContext";
import { ServerIcon } from "@heroicons/react/24/outline";

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="login-card w-full max-w-md">
        <div className="text-center mb-8">
          <div className="brand-mark mx-auto mb-5">
            <ServerIcon />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Nestcore</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in to manage your server</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-gray-400 text-sm font-medium mb-2">Username</label>
            <input
              type="text"
              autoComplete="username"
              className="input-field w-full"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="mb-5">
            <label className="block text-gray-400 text-sm font-medium mb-2">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              className="input-field w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={isSubmitting} className="btn-primary w-full disabled:opacity-60">
            {isSubmitting ? "Signing in..." : "Login"}
          </button>
          {error && <p className="text-red-400 text-sm text-center mt-4">{error}</p>}
        </form>
      </div>
    </div>
  );
}
