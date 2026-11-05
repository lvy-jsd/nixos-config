# GUI proxy: Clash Verge Rev (mihomo core), replacing the hand-rolled mihomo unit.
#
# Why the switch: the previous setup ran mihomo as a systemd service whose
# config lived in /var/lib/mihomo-secrets (root, mode 600) with TUN auto-route
# always on. It worked, but nodes and rules could only be changed by root, and
# there was no way to see or switch anything without reading journalctl. Verge
# owns the core instead: profiles are edited in the GUI, and `serviceMode`
# gives it a privileged helper so TUN, DNS and routing are configured on
# request rather than being wired in at boot.
#
# The helper still runs as root with CAP_NET_ADMIN -- that is inherent to
# creating a TUN device -- but it is confined by the systemd hardening the
# nixpkgs module applies (ProtectSystem=strict, NoNewPrivileges, syscall
# filter, PrivateTmp), and it only listens on a socket under
# /run/clash-verge-rev that members of `group` can reach.
{ ... }:
{
  programs.clash-verge = {
    enable = true;

    # Root helper (clash-verge-service): creates the TUN device and the policy
    # routes on behalf of the GUI. This is the alternative to running the whole
    # GUI as root, and the reason we do not need a custom capability wrapper.
    serviceMode = true;

    # Additionally gives the GUI binary cap_net_bind_service/cap_net_raw/
    # cap_net_admin. Verge needs these for DNS handling inside TUN mode, and
    # the module flips networking.firewall.checkReversePath to "loose" -- strict
    # reverse-path filtering drops the asymmetric traffic a TUN setup produces.
    tunMode = true;

    # Single-user machine: the helper socket only needs to be reachable by ilo.
    # Narrow this to a dedicated group if more users ever share the box.
    group = "users";

    # XDG autostart entry (/etc/xdg/autostart/clash-verge.desktop). niri honours
    # XDG autostart, but if Verge does not come up after login, add
    # `spawn-at-startup "clash-verge"` to niri/config.kdl next to the noctalia
    # line -- that path always works.
    autoStart = true;
  };
}
