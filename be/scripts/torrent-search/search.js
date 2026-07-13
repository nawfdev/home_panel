// One-shot CLI: `node search.js "<query>"` -> JSON array of
// { title, size, seeds, peers, provider, magnet } on stdout.
//
// Invoked per-search by internal/torrentsearch (be/internal/torrentsearch/search.go)
// via exec.CommandContext, same "shell out to an external tool" shape as
// ffmpeg/ffprobe/aria2c elsewhere in this repo — just Node instead of a
// native binary.
//
// Queries official/stable JSON APIs directly instead of scraping HTML (the
// prior torrent-search-api dependency wrapped ~10 scraper providers whose
// underlying sites constantly rotate domains/layouts/certs — in practice
// only one of them still worked). No npm dependency needed: Node's built-in
// fetch is enough, so there's nothing to `npm install` for this script
// anymore either.
//
// Each provider is fetched independently and a failure in one (network,
// timeout, bad response) never sabotages the others — same "drop what a
// provider can't deliver" spirit as the old magnet-resolution filter.

const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
];

function magnetFromHash(hash, name) {
  const tr = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join("");
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${tr}`;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// apibay.org — unofficial but stable JSON search API over ThePirateBay's
// index. cat=200 scopes to the Movies category tree. A "no results" query
// comes back as a single row with id "0" rather than an empty array.
async function searchApibay(query) {
  const rows = await fetchJson(
    `https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=200`,
    10000
  );
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r.id !== "0" && r.info_hash)
    .map((r) => ({
      title: r.name || "",
      size: formatBytes(r.size),
      sizeBytes: Number(r.size) || 0,
      seeds: Number(r.seeders) || 0,
      peers: Number(r.leechers) || 0,
      provider: "ThePirateBay",
      magnet: magnetFromHash(r.info_hash, r.name || "torrent"),
    }));
}

// bitsearch.eu — DHT-backed torrent metasearch with a stable JSON API
// (formerly solidtorrents.to; both redirect here now — the underlying
// project just renamed). category 2 is its Movies bucket.
async function searchBitsearch(query) {
  const data = await fetchJson(
    `https://bitsearch.eu/api/v1/search?q=${encodeURIComponent(query)}`,
    10000
  );
  const results = data?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r) => r.category === 2 && r.infohash)
    .map((r) => ({
      title: r.title || "",
      size: formatBytes(r.size),
      sizeBytes: Number(r.size) || 0,
      seeds: Number(r.seeders) || 0,
      peers: Number(r.leechers) || 0,
      provider: "BitSearch",
      magnet: magnetFromHash(r.infohash, r.title || "torrent"),
    }));
}

async function main() {
  const query = process.argv[2] || "";
  const providers = [searchApibay(query), searchBitsearch(query)];
  const settled = await Promise.allSettled(providers);
  const results = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  process.stdout.write(JSON.stringify(results));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
