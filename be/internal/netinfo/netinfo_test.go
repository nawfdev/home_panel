package netinfo

import (
	"testing"
)

const openWrtAddresses = `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host 
       valid_lft forever preferred_lft forever
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1504 qdisc mq state UP qlen 1000
    link/ether 50:33:f0:33:c0:20 brd ff:ff:ff:ff:ff:ff
    inet6 fe80::5233:f0ff:fe33:c020/64 scope link 
       valid_lft forever preferred_lft forever
3: wan: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP qlen 1000
    link/ether 50:33:f0:33:c0:20 brd ff:ff:ff:ff:ff:ff
    inet 192.168.1.64/24 brd 192.168.1.255 scope global wan
       valid_lft forever preferred_lft forever
    inet6 2404:c0:ba02:c47:5233:f0ff:fe33:c020/64 scope global dynamic noprefixroute 
       valid_lft 258913sec preferred_lft 172513sec
6: br-lan: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP qlen 1000
    link/ether 50:33:f0:33:c0:20 brd ff:ff:ff:ff:ff:ff
    inet 192.168.11.1/24 brd 192.168.11.255 scope global br-lan
       valid_lft forever preferred_lft forever`

const openWrtRoutes = `default via 192.168.1.1 dev wan  src 192.168.1.64 
192.168.1.0/24 dev wan scope link  src 192.168.1.64 
192.168.11.0/24 dev br-lan scope link  src 192.168.11.1 `

const openWrtResolv = `search lan
nameserver 127.0.0.1
nameserver ::1`

const openWrtNetDev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:   11193      93    0    0    0     0          0         0    11193      93    0    0    0     0       0          0
  eth0: 2266351486 2139657    0    0    0     0          0         0 448897086  877686    0    0    0     0       0          0
   wan: 2101782834 2194274    0 3069    0     0          0         0 2318309960 2451949    0    0    0     0       0          0
br-lan: 2255648344 1840450    0 7385    0     0          0      3134 2085201673 1992401    0    2    0     0       0          0`

func TestParseLinuxSnapshotOpenWrt(t *testing.T) {
	snapshot, err := ParseLinuxSnapshot(openWrtAddresses, openWrtRoutes, openWrtResolv, openWrtNetDev)
	if err != nil {
		t.Fatalf("ParseLinuxSnapshot failed: %v", err)
	}

	if len(snapshot.Interfaces) == 0 {
		t.Fatalf("expected interfaces, got 0")
	}

	if snapshot.Gateway == nil || *snapshot.Gateway != "192.168.1.1" {
		t.Fatalf("expected gateway 192.168.1.1, got %v", snapshot.Gateway)
	}

	if len(snapshot.DNS) != 2 || snapshot.DNS[0] != "127.0.0.1" {
		t.Fatalf("expected 2 DNS entries, got %v", snapshot.DNS)
	}

	if len(snapshot.Stats) == 0 {
		t.Fatalf("expected stats, got 0")
	}
}
