{
  description = "ilo's NixOS configuration";
    
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    claude-desktop.url = "github:patrickjaja/claude-desktop-extra";
    codex-desktop-linux.url = "github:ilysenko/codex-desktop-linux";
  };

  outputs = { self, nixpkgs, ... }@inputs: {
    nixosConfigurations.nixos = nixpkgs.lib.nixosSystem {
      specialArgs = { inherit inputs; };
      modules = [ ./configuration.nix ];
    };
  };
} 
