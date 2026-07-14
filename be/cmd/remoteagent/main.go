// Command remoteagent is a small standalone binary installed on the device
// you want to control from the panel's Remote Desktop page. It streams JPEG
// screen frames over a WebSocket and injects mouse/keyboard input received
// from the viewer — the panel itself never touches the remote screen, it
// just talks this agent's protocol directly (same LAN, no relay needed).
package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	cfg, err := loadOrCreateConfig()
	if err != nil {
		log.Fatalf("failed to load/create config: %v", err)
	}

	http.HandleFunc("/ws", wsHandler(cfg))
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Remote Desktop agent running")
	})

	addr := fmt.Sprintf(":%d", cfg.Port)
	fmt.Println("=================================================")
	fmt.Println(" Remote Desktop Agent")
	fmt.Println("=================================================")
	fmt.Printf(" Port:  %d\n", cfg.Port)
	fmt.Printf(" Token: %s\n", cfg.Token)
	fmt.Println()
	fmt.Println(" Add this device in the panel's Remote Desktop page")
	fmt.Println(" with this machine's LAN IP, the port and token above.")
	fmt.Println("=================================================")

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("agent server error: %v", err)
	}
}
