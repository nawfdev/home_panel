package aigateway

import (
	"fmt"
	"regexp"
	"strings"
)

// Heuristic, non-ML token compression. OmniRoute's real compression pipeline
// includes ML semantic pruning (LLMLingua-2), which would require embedding a
// transformer model — infeasible in native Go without a second runtime,
// contradicting the "no sidecar" decision. This is intentionally rule-based
// only: whitespace stripping, truncating very long blocks, and dropping
// exact-duplicate messages.

const defaultTruncateCharLimit = 4000

var (
	multiBlankLines = regexp.MustCompile(`\n{3,}`)
	multiSpaces     = regexp.MustCompile(`[ \t]{2,}`)
)

func (s *Service) maybeCompress(req ChatRequest) ChatRequest {
	cs := s.GetCompression()
	if !cs.Enabled {
		return req
	}
	return compressRequest(req, cs)
}

func compressRequest(req ChatRequest, cs CompressionSettings) ChatRequest {
	limit := cs.TruncateCharLimit
	if limit <= 0 {
		limit = defaultTruncateCharLimit
	}

	msgs := make([]ChatMessage, 0, len(req.Messages))
	seen := map[string]bool{}
	for _, m := range req.Messages {
		content := m.Content
		if cs.StripWhitespace {
			content = stripExcessWhitespace(content)
		}
		if cs.TruncateLongBlocks && len(content) > limit {
			content = content[:limit] + fmt.Sprintf("\n...[truncated %d chars]", len(content)-limit)
		}
		if cs.DedupeMessages {
			key := m.Role + "\x00" + content
			if seen[key] {
				continue // drop exact repeats (e.g. identical tool-output blocks)
			}
			seen[key] = true
		}
		msgs = append(msgs, ChatMessage{Role: m.Role, Content: content})
	}
	req.Messages = msgs
	return req
}

func stripExcessWhitespace(s string) string {
	s = multiBlankLines.ReplaceAllString(s, "\n\n")
	s = multiSpaces.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}
