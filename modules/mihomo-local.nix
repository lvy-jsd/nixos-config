# Local mihomo for Claude egress via own Sydney VPS (hysteria2).
# Secrets live in /var/lib/mihomo-secrets/ (mode 600), never in the nix store.
{ pkgs, lib, ... }:
{
  # Ensure secrets dir exists with tight perms; do not populate contents from nix.
  systemd.tmpfiles.rules = [
    "d /var/lib/mihomo-secrets 0700 root root -"
  ];

  services.mihomo = {
    enable = true;
    tunMode = true;
    configFile = "/var/lib/mihomo-secrets/config.yaml";
  };

  # Allow the DynamicUser service to read the secrets file via LoadCredential;
  # also open mixed-port only on loopback (config binds 127.0.0.1).
  # CAP_NET_ADMIN already granted by tunMode.

  # Handy package for manual checks (curl --proxy etc. already on system).
  environment.systemPackages = [ pkgs.mihomo ];
}
