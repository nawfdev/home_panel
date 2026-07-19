import { useEffect, useRef, useState } from "react";

export interface TvDrm {
  system: string; // "clearkey" | "widevine" | "unknown"
  clearKeys?: Record<string, string>;
  serverUrl?: string;
}

export interface TvChannel {
  id: string;
  name: string;
  tvgId?: string;
  logo?: string;
  group: string;
  source: string;
  url: string;
  type: "hls" | "dash" | "ts";
  headers?: Record<string, string>;
  drm?: TvDrm;
}

function proxify(url: string, headers?: Record<string, string>) {
  let q = `/tv-proxy?url=${encodeURIComponent(url)}`;
  if (headers && Object.keys(headers).length) {
    const enc = btoa(unescape(encodeURIComponent(JSON.stringify(headers))));
    q += `&h=${encodeURIComponent(enc)}`;
  }
  return q;
}

type PlayState = "loading" | "playing" | "error";

// Adaptive/DRM channel player: HLS via hls.js, DASH/DRM (ClearKey + Widevine)
// via Shaka Player. Both libraries are dynamically imported so the ~1MB Shaka
// bundle only loads when the TV page is actually opened. Channels that need a
// Referer/User-Agent header or a Widevine license server — neither settable
// directly from browser JS — go through the backend's /tv-proxy instead of
// hitting the origin directly. Live TV has no seek/duration, so this uses
// plain native <video controls> rather than the VOD-oriented NestVideo player.
export function TvPlayer({ channel }: { channel: TvChannel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlayState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let hls: any = null;
    let shakaPlayer: any = null;

    async function destroy() {
      if (hls) {
        try {
          hls.destroy();
        } catch {
          /* noop */
        }
        hls = null;
      }
      if (shakaPlayer) {
        try {
          await shakaPlayer.destroy();
        } catch {
          /* noop */
        }
        shakaPlayer = null;
      }
    }

    const needsProxy = !!(channel.headers && Object.keys(channel.headers).length);
    const useDash = channel.type === "dash" || !!channel.drm;

    async function playShaka() {
      const shakaMod: any = await import("shaka-player");
      const shaka = shakaMod.default ?? shakaMod;
      if (cancelled) return;

      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        throw new Error("This browser doesn't support DASH/DRM playback (EME). Try Chrome or Edge.");
      }

      const player = new shaka.Player();
      shakaPlayer = player;
      await player.attach(video!);

      if (channel.drm) {
        if (channel.drm.system === "clearkey" && channel.drm.clearKeys) {
          player.configure({ drm: { clearKeys: channel.drm.clearKeys } });
        } else if (channel.drm.system === "widevine" && channel.drm.serverUrl) {
          const serverUrl = needsProxy ? proxify(channel.drm.serverUrl, channel.headers) : channel.drm.serverUrl;
          player.configure({ drm: { servers: { "com.widevine.alpha": serverUrl } } });
        } else if (channel.drm.system === "unknown") {
          throw new Error("This channel uses a DRM system that isn't supported in the browser.");
        }
      }

      if (needsProxy) {
        player.getNetworkingEngine()?.registerRequestFilter((_type: unknown, request: any) => {
          request.uris = request.uris.map((u: string) => (u.startsWith("/tv-proxy") ? u : proxify(u, channel.headers)));
        });
      }

      player.addEventListener("error", (ev: any) => {
        if (cancelled) return;
        setState("error");
        setMessage(`Couldn't play this channel (DASH error ${ev?.detail?.code ?? "?"}).`);
      });

      const src = needsProxy ? proxify(channel.url, channel.headers) : channel.url;
      await player.load(src);
      if (cancelled) return;
      setState("playing");
      video!.play().catch(() => {});
    }

    async function playHls() {
      const src = needsProxy ? proxify(channel.url, channel.headers) : channel.url;
      const canNative = video!.canPlayType("application/vnd.apple.mpegurl");
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;

      if (Hls.isSupported()) {
        const inst = new Hls({ enableWorker: true });
        hls = inst;
        inst.attachMedia(video!);
        inst.on(Hls.Events.MEDIA_ATTACHED, () => inst.loadSource(src));
        inst.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          setState("playing");
          video!.play().catch(() => {});
        });
        inst.on(Hls.Events.ERROR, (_evt, data) => {
          if (!data.fatal || cancelled) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            try {
              inst.startLoad();
            } catch {
              /* noop */
            }
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try {
              inst.recoverMediaError();
            } catch {
              setState("error");
              setMessage("Media error — couldn't recover.");
            }
          } else {
            setState("error");
            setMessage("Couldn't play this channel.");
          }
        });
      } else if (canNative) {
        video!.src = src;
        video!.addEventListener(
          "loadedmetadata",
          () => {
            if (cancelled) return;
            setState("playing");
            video!.play().catch(() => {});
          },
          { once: true }
        );
        video!.addEventListener(
          "error",
          () => {
            if (cancelled) return;
            setState("error");
            setMessage("Couldn't play this channel.");
          },
          { once: true }
        );
      } else {
        throw new Error("HLS isn't supported in this browser.");
      }
    }

    (async () => {
      setState("loading");
      setMessage("");
      try {
        if (useDash) {
          await playShaka();
        } else {
          await playHls();
        }
      } catch (err) {
        if (!cancelled) {
          setState("error");
          setMessage(err instanceof Error ? err.message : "Couldn't play this channel.");
        }
      }
    })();

    return () => {
      cancelled = true;
      destroy();
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  return (
    <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
      <video ref={videoRef} className="w-full h-full" controls playsInline autoPlay />
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-gray-300 pointer-events-none">
          Loading {channel.name}…
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-sm text-red-400 text-center p-6">
          {message || "Couldn't play this channel."}
        </div>
      )}
    </div>
  );
}
