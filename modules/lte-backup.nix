# LTE backup via Intel XMM7560 (iosm / MBIM). Wi-Fi (metric 600) stays primary;
# the gsm connection has a higher metric so it only carries traffic when Wi-Fi is gone.
# No PIN/password here; APN left empty so ModemManager/NM pick it automatically.
{ ... }:
{
  networking.modemmanager.enable = true;

  networking.networkmanager.ensureProfiles.profiles.lte-backup = {
    connection = {
      id = "lte-backup";
      type = "gsm";
      autoconnect = "true";
      autoconnect-priority = "-10";
    };
    gsm = { };
    ipv4 = { method = "auto"; route-metric = "1000"; };
    ipv6 = { method = "auto"; addr-gen-mode = "default"; route-metric = "1000"; };
  };
}
