{
  description = "ilo's NixOS configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    # Third-party packages that are not in nixpkgs.
    claude-desktop.url = "github:patrickjaja/claude-desktop-extra";
    codex-desktop-linux.url = "github:ilysenko/codex-desktop-linux";

    # Declarative Flatpak management: keeps services.flatpak.packages in git
    # instead of installing apps by hand, so a rebuild reproduces the set.
    nix-flatpak.url = "github:gmodena/nix-flatpak/?ref=latest";
  };

  outputs =
    { nixpkgs, ... }@inputs:
    {
      # Build with: sudo nixos-rebuild switch --flake .#nixos
      nixosConfigurations.nixos = nixpkgs.lib.nixosSystem {
        specialArgs = { inherit inputs; }; # lets configuration.nix use inputs.claude-desktop etc.
        modules = [
          ./configuration.nix
          inputs.nix-flatpak.nixosModules.nix-flatpak
        ];
      };
    };
}
