# Edit this configuration file to define what should be installed on
# your system. Help is available in the configuration.nix(5) man page, on
# https://search.nixos.org/options and in the NixOS manual (`nixos-help`).

{ config, pkgs, inputs, ... }:

{
  imports =
    [ # Include the results of the hardware scan.
      ./hardware-configuration.nix
    ];

  # Use the systemd-boot EFI boot loader.
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  # Use latest kernel.
  boot.kernelPackages = pkgs.linuxPackages_latest;

  boot.initrd.luks.devices."luks-80e95802-797d-480e-922c-2d0b203fd127".device = "/dev/disk/by-uuid/80e95802-797d-480e-922c-2d0b203fd127";
  networking.hostName = "nixos"; # Define your hostname.
  # networking.wireless.enable = true;  # Enables wireless support via wpa_supplicant.

  # Configure network proxy if necessary
  # networking.proxy.default = "http://user:password@proxy:port/";
  # networking.proxy.noProxy = "127.0.0.1,localhost,internal.domain";

  # Enable networking
  networking.networkmanager.enable = true;

  # Set your time zone.
  time.timeZone = "Australia/Perth";

  # Select internationalisation properties.
  i18n.defaultLocale = "zh_CN.UTF-8";

  i18n.extraLocaleSettings = {
    LC_ADDRESS = "zh_CN.UTF-8";
    LC_IDENTIFICATION = "zh_CN.UTF-8";
    LC_MEASUREMENT = "zh_CN.UTF-8";
    LC_MONETARY = "zh_CN.UTF-8";
    LC_NAME = "zh_CN.UTF-8";
    LC_NUMERIC = "zh_CN.UTF-8";
    LC_PAPER = "zh_CN.UTF-8";
    LC_TELEPHONE = "zh_CN.UTF-8";
    LC_TIME = "zh_CN.UTF-8";
  };

  # Configure keymap in X11
  services.xserver.xkb = {
    layout = "au";
    variant = "";
  };

  # Define a user account. Don't forget to set a password with ‘passwd’.
  users.users."ilo" = {
    isNormalUser = true;
    description = "ilo";
    extraGroups = [ "networkmanager" "wheel" "kvm" ];
    packages = with pkgs; [];
  };

  # Allow unfree packages
  nixpkgs.config.allowUnfree = true;

  # List packages installed in system profile.
  # You can use https://search.nixos.org/ to find more packages (and options).
  environment.systemPackages = with pkgs; [
    vim # Do not forget to add an editor to edit configuration.nix! The Nano editor is also installed by default.
    wget
    kitty
    noctalia
    (catppuccin-sddm.override { flavor = "frappe"; accent = "mauve"; })
    catppuccin-cursors.frappeMauve # cursor theme for niri, SDDM and the lock screens
    inputs.claude-desktop.packages.x86_64-linux.default
    inputs.codex-desktop-linux.packages.x86_64-linux.codex-desktop
    google-chrome
    mpv
    wechat
    qq
    telegram-desktop
    git
    btop
    ripgrep
    fd
    bat
    fastfetch
    bilibili
    nautilus
    labwc # nested Wayland compositor used as Computer Use display 2
    wl-clipboard # clipboard access for display 2
    swaylock # fallback locker (Noctalia has its own lock screen: noctalia msg session lock)
    xwayland-satellite # niri runs X11 apps through it; without it niri disables X11 support
    swayidle # idle timeout handling
    brightnessctl # brightness keys in the niri config
    playerctl # media keys in the niri config
    glib # gsettings
    gsettings-desktop-schemas # org.gnome.desktop.* schemas (GTK dark mode, icon theme)
    pulseaudio # pactl
    libnotify # notify-send
    jq
    yt-dlp
    ffmpeg
    eza # ls with icons
    zoxide # smarter cd (z)
    fzf # fuzzy finder (Ctrl+R / Ctrl+T)
  ];

  # Some programs need SUID wrappers, can be configured further or are
  # started in user sessions.
  # programs.mtr.enable = true;
  # programs.gnupg.agent = {
  #   enable = true;
  #   enableSSHSupport = true;
  # };

  # List services that you want to enable:

  # Enable the OpenSSH daemon.
  # services.openssh.enable = true;

  # Open ports in the firewall.
  # networking.firewall.allowedTCPPorts = [ ... ];
  # networking.firewall.allowedUDPPorts = [ ... ];
  # Or disable the firewall altogether.
  # networking.firewall.enable = false;

  # Copy the NixOS configuration file and link it from the resulting system
  # (/run/current-system/configuration.nix). This is useful in case you
  # accidentally delete configuration.nix.
  # system.copySystemConfiguration = true;

  # This option defines the first version of NixOS you have installed on this particular machine,
  # and is used to maintain compatibility with application data (e.g. databases) created on older NixOS versions.
  #
  # Most users should NEVER change this value after the initial install, for any reason,
  # even if you've upgraded your system to a new NixOS release.
  #
  # This value does NOT affect the Nixpkgs version your packages and OS are pulled from,
  # so changing it will NOT upgrade your system - see https://nixos.org/manual/nixos/stable/#sec-upgrading for how
  # to actually do that.
  #
  # This value being lower than the current NixOS release does NOT mean your system is
  # out of date, out of support, or vulnerable.
  #
  # Do NOT change this value unless you have manually inspected all the changes it would make to your configuration,
  # and migrated your data accordingly.
  #
  # For more information, see `man configuration.nix` or https://nixos.org/manual/nixos/stable/options#opt-system.stateVersion.
  programs.niri.enable = true;
   
  services.displayManager.sddm = {
    enable = true;
    wayland.enable = true;
    theme = "catppuccin-frappe-mauve";
    settings.Theme = {
      CursorTheme = "catppuccin-frappe-mauve-cursors";
      CursorSize = 24;
    };
  };

  hardware.graphics.enable = true;
  hardware.bluetooth.enable = true;
  services.upower.enable = true;
  services.power-profiles-daemon.enable = true;
  security.polkit.enable = true;

  fonts.enableDefaultPackages = true;
  fonts.packages = with pkgs; [
    jetbrains-mono
    lxgw-wenkai
    nerd-fonts.jetbrains-mono # kitty font_family and starship prompt glyphs
    twemoji-color-font
  ];
  i18n.inputMethod = {
    enable = true;
    type = "fcitx5";
    fcitx5 = {
      waylandFrontend = true;
      addons = with pkgs; [ (fcitx5-rime.override { rimeDataPkgs = [ rime-data rime-ice ]; }) fcitx5-gtk catppuccin-fcitx5 ];
    };
  };
  environment.sessionVariables = {
    NIXOS_OZONE_WL = "1";
    # niri's cursor{} block only reaches niri itself; shell/lock-screen processes need these to draw a pointer
    XCURSOR_THEME = "catppuccin-frappe-mauve-cursors";
    XCURSOR_SIZE = "24";
    # org.gnome.desktop.* schemas live under share/gsettings-schemas/<name>/, not share/glib-2.0/, so sw/share never exposes them
    GSETTINGS_SCHEMA_DIR = "${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}/glib-2.0/schemas";
  };
  programs.dconf.enable = true; # gsettings backend, so GTK settings persist
  services.gvfs.enable = true;
  services.udisks2.enable = true;
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
  system.autoUpgrade = {
    enable = true;
    flake = "/home/ilo/nixos-config";
    flags = [ "--print-build-logs" ];
    dates = "weekly";
    randomizedDelaySec = "45min";
    allowReboot = false;
  };

  systemd.services.flake-update = {
    description = "Update flake.lock before the system upgrade";
    wants = [ "network-online.target" ];
    after = [ "network-online.target" ];
    serviceConfig = {
      Type = "oneshot";
      User = "ilo";
      WorkingDirectory = "/home/ilo/nixos-config";
    };
    path = [ pkgs.nix pkgs.git ];
    script = "nix flake update";
  };

  systemd.services.nixos-upgrade = {
    requires = [ "flake-update.service" ];
    after = [ "flake-update.service" ];
  };
 
  programs.git = {
    enable = true;
    config.safe.directory = "/home/ilo/nixos-config";
  };

  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 14d";
  };
  nix.optimise.automatic = true;

  boot.loader.systemd-boot.configurationLimit = 5;
  boot.kernelModules = [ "vhost_vsock" ];
  programs.nix-ld.enable = true;
  programs.appimage = {
    enable = true;
    binfmt = true;
  };
  programs.starship.enable = true; # prompt config lives in ~/.config/starship.toml
  programs.fish.enable = true; # only used by kitty (kitty.conf `shell`), the login shell stays bash
  system.stateVersion = "26.11"; # Did you read the comment?

}


