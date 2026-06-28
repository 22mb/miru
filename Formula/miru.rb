# Homebrew formula for miru (custom tap: 22mb/homebrew-miru).
#
# Installs the pre-built single-file binary from GitHub Releases of 22mb/miru
# (built with `bun build --compile`, so no Bun runtime is required at install time).
#
# `version`, every `url` tag, and every `sha256` below are bumped automatically by
# the release CI on each tagged release. The sha256 values are placeholders until
# then. See Formula/README.md for the tap layout and the bump workflow.
class Miru < Formula
  desc "Inline review for AI-generated Markdown and HTML, fully local"
  homepage "https://github.com/22mb/miru"
  license "MIT"
  version "2026.6.27"

  on_macos do
    on_arm do
      url "https://github.com/22mb/miru/releases/download/#{version}/miru-macos-arm64"
      sha256 "REPLACE_MACOS_ARM64_SHA256"
    end
    on_intel do
      url "https://github.com/22mb/miru/releases/download/#{version}/miru-macos-x64"
      sha256 "REPLACE_MACOS_X64_SHA256"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/22mb/miru/releases/download/#{version}/miru-linux-arm64"
      sha256 "REPLACE_LINUX_ARM64_SHA256"
    end
    on_intel do
      url "https://github.com/22mb/miru/releases/download/#{version}/miru-linux-x64"
      sha256 "REPLACE_LINUX_X64_SHA256"
    end
  end

  livecheck do
    url :stable
    strategy :github_latest
  end

  def install
    bin.install Dir["miru-*"].first => "miru"
  end

  test do
    # miru prints a usage line to stderr and exits 1 when invoked with no/invalid args.
    assert_match "usage", shell_output("#{bin}/miru 2>&1", 1)
  end
end
