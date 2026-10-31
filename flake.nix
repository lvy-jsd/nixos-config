{
  description = "ilo's NixOS configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    # Third-party packages that are not in nixpkgs.
    claude-desktop.url = "github:patrickjaja/claude-desktop-extra";
    codex-desktop-linux.url = "github:ilysenko/codex-desktop-linux";
  };

  outputs =
    { nixpkgs, ... }@inputs:
    {
      # Build with: sudo nixos-rebuild switch --flake .#nixos
      nixosConfigurations.nixos = nixpkgs.lib.nixosSystem {
        specialArgs = { inherit inputs; }; # lets configuration.nix use inputs.claude-desktop etc.
        modules = [ ./configuration.nix ];
      };
    };
}
