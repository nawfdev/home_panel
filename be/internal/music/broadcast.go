package music

import (
	"io"
	"sync"
)

// broadcaster fans a single live audio stream out to any number of HTTP
// listeners (browser tabs with the mini-player open) — like an internet
// radio relay, every subscriber hears the same feed, there's no per-listener
// buffering of history or seeking.
type broadcaster struct {
	mu   sync.Mutex
	subs map[chan []byte]struct{}
}

func newBroadcaster() *broadcaster {
	return &broadcaster{subs: make(map[chan []byte]struct{})}
}

func (b *broadcaster) subscribe() chan []byte {
	ch := make(chan []byte, 32)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *broadcaster) unsubscribe(ch chan []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.subs[ch]; !ok {
		return
	}
	delete(b.subs, ch)
	close(ch)
}

// publish fans chunk out to every current subscriber. A subscriber that
// isn't draining fast enough (a stalled/slow browser tab) has the chunk
// dropped rather than blocking every other listener — audio glitches for
// that one tab instead of stalling the whole relay.
func (b *broadcaster) publish(chunk []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- chunk:
		default:
		}
	}
}

// run reads from r until it errors/closes (the ffmpeg relay exiting or
// being restarted), publishing each chunk read. Called synchronously by
// superviseFFmpeg's loop — returning here means that ffmpeg process is done
// and the caller should restart it.
func (b *broadcaster) run(r io.Reader) {
	buf := make([]byte, 8192)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			b.publish(chunk)
		}
		if err != nil {
			return
		}
	}
}
