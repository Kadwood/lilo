//! Discovery of Brother machines on the local network.
//!
//! Brother machines do not announce themselves via mDNS/SSDP (the official
//! client also scans), so discovery is an active probe:
//!
//!   1. enumerate the host's private IPv4 interfaces,
//!   2. sweep each interface's /24 with a short TCP dial to port 443,
//!   3. for hosts that accept, `GET /info` and check for the `pedxml` API.
//!
//! The sweep is bounded: only RFC-1918/link-local networks, only /24-sized
//! slices (254 addresses), bounded concurrency, sub-second dial timeout —
//! a full scan of one interface takes a few seconds.

use crate::machine::{DiscoveredMachine, MachineBackend, ScanProgressFn};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

/// How long to wait for a TCP SYN-ACK from a candidate host.
const DIAL_TIMEOUT: Duration = Duration::from_millis(600);
/// Parallel probes. Home routers cope fine with this; it keeps a /24 sweep
/// under ~5 seconds even when most addresses time out.
const CONCURRENCY: usize = 48;

/// The /24 networks to sweep, derived from local interface addresses.
fn candidate_networks() -> Vec<Ipv4Addr> {
    let Ok(interfaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };
    networks_from_addrs(
        interfaces
            .into_iter()
            .map(|iface| (iface.ip(), iface.is_loopback())),
    )
}

/// Pure part of [`candidate_networks`]: (address, is_loopback) pairs to a
/// sorted, de-duplicated list of private IPv4 /24 base addresses.
fn networks_from_addrs(addrs: impl IntoIterator<Item = (IpAddr, bool)>) -> Vec<Ipv4Addr> {
    let mut networks: Vec<Ipv4Addr> = addrs
        .into_iter()
        .filter(|(_, is_loopback)| !is_loopback)
        .filter_map(|(ip, _)| match ip {
            IpAddr::V4(v4) if v4.is_private() => {
                let octets = v4.octets();
                Some(Ipv4Addr::new(octets[0], octets[1], octets[2], 0))
            }
            _ => None,
        })
        .collect();
    networks.sort();
    networks.dedup();
    networks
}

/// Hosts .1 to .254 of each /24 network.
fn hosts_of(networks: &[Ipv4Addr]) -> Vec<Ipv4Addr> {
    networks
        .iter()
        .flat_map(|net| {
            let base = net.octets();
            (1u8..=254).map(move |host| Ipv4Addr::new(base[0], base[1], base[2], host))
        })
        .collect()
}

/// Sweep the local network for Brother machines.
///
/// `on_progress` is called with (probed, total) as addresses complete, so the
/// UI can show a scan bar.
pub async fn discover(on_progress: ScanProgressFn) -> Vec<DiscoveredMachine> {
    let networks = candidate_networks();
    let candidates = hosts_of(&networks);

    let total = candidates.len();
    let semaphore = Arc::new(Semaphore::new(CONCURRENCY));
    let probed = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    let mut tasks = Vec::with_capacity(total);
    for ip in candidates {
        let semaphore = semaphore.clone();
        let probed = probed.clone();
        let on_progress = on_progress.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = semaphore.acquire_owned().await.ok()?;
            let found = probe_address(ip).await;
            let done = probed.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            on_progress(done, total);
            found
        }));
    }

    let mut machines = Vec::new();
    for task in tasks {
        if let Ok(Some(machine)) = task.await {
            machines.push(machine);
        }
    }
    machines
}

/// Probe a single address: fast TCP dial, then a real protocol probe.
async fn probe_address(ip: Ipv4Addr) -> Option<DiscoveredMachine> {
    // Cheap reachability filter first: most of the /24 is empty space and a
    // TCP dial is far cheaper than a TLS handshake.
    let addr = SocketAddr::from((ip, 443));
    tokio::time::timeout(DIAL_TIMEOUT, tokio::net::TcpStream::connect(addr))
        .await
        .ok()?
        .ok()?;

    let backend = super::BrotherBackend::new();
    match backend.probe(IpAddr::V4(ip)).await {
        Ok(Some(info)) => Some(DiscoveredMachine { info }),
        _ => None,
    }
}

/// Probe one specific address (used for manual "test connection" flows).
pub async fn probe_one(ip: IpAddr) -> Option<DiscoveredMachine> {
    match ip {
        IpAddr::V4(v4) => probe_address(v4).await,
        IpAddr::V6(_) => None,
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    fn v4(a: u8, b: u8, c: u8, d: u8) -> (IpAddr, bool) {
        (IpAddr::V4(Ipv4Addr::new(a, b, c, d)), false)
    }

    #[test]
    fn enumerates_private_slash24s_sorted_and_deduped() {
        let nets = networks_from_addrs([
            v4(192, 168, 1, 40),
            v4(10, 0, 5, 7),
            v4(192, 168, 1, 41),
            v4(172, 16, 3, 9),
        ]);
        assert_eq!(
            nets,
            vec![
                Ipv4Addr::new(10, 0, 5, 0),
                Ipv4Addr::new(172, 16, 3, 0),
                Ipv4Addr::new(192, 168, 1, 0)
            ]
        );
    }

    #[test]
    fn skips_loopback_ipv6_link_local_and_public() {
        let nets = networks_from_addrs([
            (IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), true),
            // Flagged loopback is skipped even if the address were private.
            (IpAddr::V4(Ipv4Addr::new(192, 168, 9, 1)), true),
            ("fe80::1".parse().unwrap(), false),
            ("fd00::5".parse().unwrap(), false),
            v4(169, 254, 10, 10),
            v4(8, 8, 8, 8),
            v4(172, 32, 0, 1), // just outside 172.16/12
            v4(192, 168, 7, 3),
        ]);
        assert_eq!(nets, vec![Ipv4Addr::new(192, 168, 7, 0)]);
    }

    #[test]
    fn no_interfaces_means_no_networks() {
        assert!(networks_from_addrs([]).is_empty());
        assert!(hosts_of(&[]).is_empty());
    }

    #[test]
    fn hosts_cover_1_to_254_only() {
        let hosts = hosts_of(&[Ipv4Addr::new(192, 168, 1, 0)]);
        assert_eq!(hosts.len(), 254);
        assert_eq!(hosts[0], Ipv4Addr::new(192, 168, 1, 1));
        assert_eq!(*hosts.last().unwrap(), Ipv4Addr::new(192, 168, 1, 254));
        assert!(!hosts.contains(&Ipv4Addr::new(192, 168, 1, 0)));
        assert!(!hosts.contains(&Ipv4Addr::new(192, 168, 1, 255)));
    }

    #[test]
    fn host_count_scales_per_network() {
        let nets = [Ipv4Addr::new(10, 0, 0, 0), Ipv4Addr::new(10, 0, 1, 0)];
        assert_eq!(hosts_of(&nets).len(), 508);
    }

    #[tokio::test]
    async fn probe_one_ignores_ipv6() {
        assert!(probe_one("::1".parse().unwrap()).await.is_none());
    }
}
