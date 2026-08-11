# This file can be included in your NixOS configuration or as a standalone package

{
  lib,
  pkgs ? import <nixpkgs> { },
}:

pkgs.stdenv.mkDerivation {
  name = "pastebin-r2";

  src = ./.;

  buildInputs = with pkgs; [
    nodejs
    yarn
  ];

  # Make sure build environment is set up properly
  nativeBuildInputs = with pkgs; [
    nodePackages.typescript-language-server
    nodePackages.prettier
  ];

  # Nix build steps
  buildPhase = ''
    runHook preBuild

    # Set up node modules
    export NODE_PATH=$(pwd)/node_modules:$NODE_PATH

    # Build the project
    yarn install --frozen-lockfile
    yarn build

    runHook postBuild
  '';

  # Installation phase
  installPhase = ''
    runHook preInstall

    mkdir -p $out
    cp -r dist/* $out/

    runHook postInstall
  '';

  meta = with lib; {
    description = "A simple pastebin service using Cloudflare Workers";
    homepage = "https://github.com/codebam/pastebin-r2";
    license = licenses.mit;
    maintainers = with maintainers; [ ];
  };
}
