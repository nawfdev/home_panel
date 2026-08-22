import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, ApiError } from "../context/AuthContext";
import { api } from "../lib/api";
import { ServerIcon, FingerPrintIcon } from "@heroicons/react/24/outline";
export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(username, password, code, rememberMe);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && err.message === "Two-factor code required") {
        setRequiresTwoFactor(true);
      }
      setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
      setIsSubmitting(false);
    }
  }

  async function handlePasskeyLogin() {
    setError(null);
    setIsSubmitting(true);
    try {
      if (!window.PublicKeyCredential) {
        throw new Error("Passkeys are not supported on this browser");
      }
      const beginRes = await api<{
        success: boolean;
        options: { challenge: string; rpId: string; userVerification: string; timeout: number };
      }>("/auth/passkeys/login/begin", { method: "POST" });

      const rawChal = beginRes.options.challenge.replace(/-/g, "+").replace(/_/g, "/");
      const paddedChal = rawChal + "===".slice((rawChal.length + 3) % 4);
      const challengeBytes = Uint8Array.from(atob(paddedChal), (c) => c.charCodeAt(0));

      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge: challengeBytes,
          rpId: beginRes.options.rpId,
          userVerification: (beginRes.options.userVerification as UserVerificationRequirement) || "preferred",
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error("Biometric verification cancelled");
      }

      const rawResp = credential.response as AuthenticatorAssertionResponse;
      const clientDataJSON = btoa(String.fromCharCode(...new Uint8Array(rawResp.clientDataJSON)));
      const authenticatorData = btoa(String.fromCharCode(...new Uint8Array(rawResp.authenticatorData)));
      const signature = btoa(String.fromCharCode(...new Uint8Array(rawResp.signature)));

      const finishRes = await api<{ success: boolean }>("/auth/passkeys/login/finish", {
        method: "POST",
        body: JSON.stringify({
          response: {
            id: credential.id,
            rawId: credential.id,
            type: credential.type,
            response: {
              clientDataJSON,
              authenticatorData,
              signature,
            },
          },
        }),
      });

      if (finishRes.success) {
        navigate("/dashboard", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Biometric login failed");
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

        {/* Biometric Passkey Login Button */}
        <div className="mb-6">
          <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2.5 bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 text-blue-300 font-semibold py-3 rounded-xl transition active:scale-[0.98] disabled:opacity-60 text-sm"
          >
            <FingerPrintIcon className="w-5 h-5 text-blue-400" />
            <span>Sign in with Passkey / Biometrics</span>
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">or password</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>
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
          {requiresTwoFactor && (
            <div className="mb-5">
              <label className="block text-gray-400 text-sm font-medium mb-2">Authenticator or recovery code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="input-field w-full font-mono tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
              />
            </div>
          )}
          <div className="mb-5 flex items-center justify-between">
            <label className="flex items-center gap-2.5 text-xs text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded bg-black/40 border-white/10 text-blue-600 focus:ring-blue-500/20 cursor-pointer accent-blue-600"
              />
              <span>Ingat saya di perangkat ini (Tetap masuk 30 hari)</span>
            </label>
          </div>
          <button type="submit" disabled={isSubmitting} className="btn-primary w-full disabled:opacity-60">
            {isSubmitting ? "Signing in..." : "Login with password"}
          </button>
          {error && <p className="text-red-400 text-sm text-center mt-4">{error}</p>}
        </form>
      </div>
    </div>
  );
}
