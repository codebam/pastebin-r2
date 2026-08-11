{
  inputs = {
    utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
      utils,
    }:
    utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShell = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            nodePackages.npm
            typescript
            nodePackages.typescript-language-server
            nodePackages.prettier
          ];

          # Set environment for Nix development
          shellHook = ''
            export NODE_OPTIONS="--no-warnings"
          '';
        };

        packages.default = pkgs.stdenv.mkDerivation {
          name = "pastebin-r2";
          src = ./.;

          buildInputs = with pkgs; [
            nodejs
            nodePackages.npm
          ];

          # Nix build steps
          buildPhase = ''
            # Install dependencies
            npm install

            # Build the project
            npm run build
          '';

          installPhase = ''
            mkdir -p $out
            cp -r dist/* $out/
          '';
        };
      }
    );
}
