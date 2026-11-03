# 阅文「作家助手」- the desktop client authors use to write and publish on
# 起点中文网 / QQ阅读 / 创世 etc.
#
# Yuewen only ships a Debian package built for Ubuntu/Kylin/UOS: it expects a
# normal FHS layout plus a full set of Chromium shared libraries. On NixOS the
# practical route is to unpack the .deb and run the bundled Electron binary
# inside buildFHSEnv.
{
  lib,
  stdenv,
  fetchurl,
  dpkg,
  buildFHSEnv,
  makeWrapper,
  runCommand,
  nspr,
  nss,
  libdrm,
  libgbm,
  libGL,
  alsa-lib,
  at-spi2-atk,
  at-spi2-core,
  cups,
  dbus,
  expat,
  gdk-pixbuf,
  glib,
  gtk3,
  pango,
  cairo,
  udev,
  libsecret,
  libxkbcommon,
  libx11,
  libxcb,
  libxcomposite,
  libxdamage,
  libxext,
  libxfixes,
  libxrandr,
  libxshmfence,
  libxtst,
  harfbuzz,
  freetype,
  fontconfig,
  krb5,
  libuuid,
  zlib,
}:
let
  version = "5.24.0";

  src = fetchurl {
    # Official Linux x64 channel published on zuojia.write.qq.com
    url = "https://cc-author-appapk-1252317822.file.myqcloud.com/authorappapk/10001/1/authorwrite_${version}_amd64.deb";
    hash = "sha256-tK/81mBZ9qqEpH1nkez6a2vLYBZwR6TPg4eamIZ82tg=";
  };

  # The .deb installs to /opt/作家助手; rename to an ASCII path.
  app = stdenv.mkDerivation {
    pname = "authorwrite-unwrapped";
    inherit version src;

    nativeBuildInputs = [ dpkg ];

    unpackPhase = "dpkg-deb -x $src .";

    installPhase = ''
      runHook preInstall
      mkdir -p $out/lib $out/share
      cp -r "opt/作家助手" $out/lib/authorwrite
      chmod -R u+w $out/lib/authorwrite
      cp -r usr/share/icons $out/share/icons
      runHook postInstall
    '';

    meta.platforms = [ "x86_64-linux" ];
  };

  fhs = buildFHSEnv {
    name = "authorwrite-fhs";
    inherit version;

    targetPkgs =
      ps:
      with ps;
      [
        nspr
        nss
        libdrm
        libgbm
        libGL
        alsa-lib
        at-spi2-atk
        at-spi2-core
        cups
        dbus
        expat
        gdk-pixbuf
        glib
        gtk3
        pango
        cairo
        udev
        libsecret
        libxkbcommon
        libx11
        libxcb
        libxcomposite
        libxdamage
        libxext
        libxfixes
        libxrandr
        libxshmfence
        libxtst
        harfbuzz
        freetype
        fontconfig
        krb5
        libuuid
        zlib
      ];

    # niri runs X11 apps through xwayland-satellite. The client's native Wayland
    # path trips GTK scale-factor assertions and never paints, so pin it to X11.
    # buildFHSEnv execs runScript directly, so this has to stay a single command.
    runScript = "sh -c 'export GDK_BACKEND=x11; cd ${app}/lib/authorwrite; exec ./authorwrite --no-sandbox --ozone-platform=x11'";
  };
in
runCommand "authorwrite-${version}"
  {
    nativeBuildInputs = [ makeWrapper ];
    meta = {
      description = "阅文作家助手 - official novel writing client for Yuewen platforms";
      homepage = "https://zuojia.write.qq.com/";
      license = lib.licenses.unfree;
      mainProgram = "authorwrite";
      platforms = [ "x86_64-linux" ];
    };
  }
  ''
    mkdir -p $out/bin $out/share/applications
    makeWrapper ${fhs}/bin/authorwrite-fhs $out/bin/authorwrite

    cp -r ${app}/share/icons $out/share/

    cat > $out/share/applications/authorwrite.desktop <<EOF
    [Desktop Entry]
    Type=Application
    Name=作家助手
    Name[zh_CN]=作家助手
    GenericName=Novel Writing Client
    Comment=阅文官方网文创作工具：离线写作、多端同步、一键发布
    Exec=$out/bin/authorwrite %U
    Icon=authorwrite
    Terminal=false
    Categories=Office;WordProcessor;
    Keywords=novel;writing;网文;写作;起点;
    StartupWMClass=作家助手
    MimeType=x-scheme-handler/authorwrite;
    EOF
  ''
