// One-shot CLI: `node search.js "<query>"` -> JSON array of
// { title, size, seeds, peers, provider, magnet } on stdout.
//
// Invoked per-search by internal/torrentsearch (be/internal/torrentsearch/search.go)
// via exec.CommandContext, same "shell out to an external tool" shape as
// ffmpeg/ffprobe/aria2c elsewhere in this repo — just Node instead of a
// native binary, since torrent-search-api is Node-only.
//
// Magnet resolution happens here (not in Go) so the Go/HTTP layer stays
// completely provider-agnostic: every result printed already has a
// ready-to-download magnet link. Results a provider can't resolve one for
// are dropped rather than shown as unusable.
const TorrentSearchApi = require("torrent-search-api");

TorrentSearchApi.enablePublicProviders();

async function main() {
  const query = process.argv[2] || "";
  const raw = await TorrentSearchApi.search(query, "Movies", 20);

  const results = await Promise.all(
    raw.map(async (t) => {
      let magnet = t.magnet || null;
      if (!magnet) {
        try {
          magnet = await TorrentSearchApi.getMagnet(t);
        } catch {
          magnet = null;
        }
      }
      return {
        title: t.title || "",
        size: t.size || "",
        seeds: Number(t.seeds) || 0,
        peers: Number(t.peers) || 0,
        provider: t.provider || "",
        magnet,
      };
    })
  );

  process.stdout.write(JSON.stringify(results.filter((r) => r.magnet)));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
