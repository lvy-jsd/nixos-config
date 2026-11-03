# Novel Studio - a small Electron writing desk for long-form fiction.
#
# Everything under ./app is plain JS with no node_modules: main.js talks to the
# filesystem and to the AI endpoint, renderer/ is the UI. We only need to wrap
# nixpkgs' electron around the directory.
{
  lib,
  stdenv,
  electron,
  makeWrapper,
}:
stdenv.mkDerivation (finalAttrs: {
  pname = "novel-studio";
  version = "0.1.0";

  src = ./app;

  nativeBuildInputs = [ makeWrapper ];

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/novel-studio $out/bin \
             $out/share/applications \
             $out/share/icons/hicolor/scalable/apps

    cp -r $src/. $out/lib/novel-studio/
    chmod -R u+w $out/lib/novel-studio

    install -Dm644 ${./icon.svg} $out/share/icons/hicolor/scalable/apps/novel-studio.svg

    cat > $out/share/applications/novel-studio.desktop <<EOF
    [Desktop Entry]
    Type=Application
    Name=Novel Studio
    Name[zh_CN]=小说工坊
    GenericName=Novel Writing Studio
    Comment=Offline writing desk for long-form fiction with an AI assistant
    Comment[zh_CN]=离线长篇小说写作台，内置可接入自建推理服务的 AI 助手
    Exec=$out/bin/novel-studio %U
    Icon=novel-studio
    Terminal=false
    Categories=Office;WordProcessor;Literature;
    Keywords=novel;writing;fiction;写作;小说;
    StartupWMClass=novel-studio
    EOF

    runHook postInstall
  '';

  # The unpacked electron from nixpkgs ships a non-setuid chrome-sandbox, which
  # cannot be used from a nix store path. The app only ever loads local files,
  # so --no-sandbox is an acceptable trade-off here.
  postFixup = ''
    makeWrapper ${electron}/bin/electron $out/bin/novel-studio \
      --add-flags "$out/lib/novel-studio" \
      --add-flags "--no-sandbox" \
      --add-flags "--class=novel-studio"
  '';

  meta = {
    description = "Offline novel writing studio with an AI assistant";
    homepage = "https://github.com/lvy-jsd/nixos-config";
    license = lib.licenses.mit;
    mainProgram = "novel-studio";
    platforms = lib.platforms.linux;
  };
})
