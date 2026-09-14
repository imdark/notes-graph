#!/usr/bin/env bash
#
# Install the native toolchain needed to build the NotesGraph Android app
# (packages/frontend/apps/android). Idempotent — safe to re-run; each step
# checks whether the dependency is already present before installing.
#
# Installs / verifies:
#   - Rust (rustup) + toolchain 1.96.0 + target aarch64-linux-android
#   - JDK 21 (Homebrew openjdk@21)
#   - Android SDK cmdline-tools, platform-tools, platform 36, build-tools, NDK
#   - Rewrites App/local.properties with THIS machine's sdk / cargo / rustc paths
#   - Warns if the active Node version is outside the repo's supported range
#
# macOS / Apple Silicon only (the app builds a single arm64-v8a ABI).
#
# Usage:  scripts/install-android-deps.sh
# Bump the pinned versions below if the Gradle config changes.

set -euo pipefail

# ---- versions (keep in sync with apps/android gradle config) ---------------
RUST_TOOLCHAIN="1.96.0"              # rust-toolchain.toml
RUST_ANDROID_TARGET="aarch64-linux-android"
JDK_FORMULA="openjdk@21"            # JavaVersion.VERSION_21
ANDROID_PLATFORM="android-36"       # compileSdk 36
ANDROID_BUILD_TOOLS="36.0.0"
NDK_VERSION="27.2.12479018"          # side-by-side NDK (r27); any installed ndk works
NODE_MIN_MAJOR=22                    # engines: >=22.12 <23
NODE_MAX_MAJOR=22

# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_APP_DIR="$REPO_ROOT/packages/frontend/apps/android"
LOCAL_PROPS="$ANDROID_APP_DIR/App/local.properties"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '\033[36m›\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "This script targets macOS. On Linux, install rustup, JDK 21 and the Android SDK/NDK by hand."

# ---- Homebrew --------------------------------------------------------------
bold "Checking Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  die "Homebrew not found. Install it first: https://brew.sh"
fi
BREW_PREFIX="$(brew --prefix)"
ok "brew at $BREW_PREFIX"

# ---- Rust ------------------------------------------------------------------
bold "Rust toolchain"
if ! command -v rustup >/dev/null 2>&1; then
  info "Installing rustup (non-interactive)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain none
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
else
  ok "rustup present"
fi
# Make cargo available in this shell even if freshly installed.
export PATH="$HOME/.cargo/bin:$PATH"

info "Ensuring toolchain $RUST_TOOLCHAIN + target $RUST_ANDROID_TARGET..."
rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal
rustup target add "$RUST_ANDROID_TARGET" --toolchain "$RUST_TOOLCHAIN"
ok "Rust $RUST_TOOLCHAIN with $RUST_ANDROID_TARGET"

CARGO_BIN="$HOME/.cargo/bin/cargo"
RUSTC_BIN="$HOME/.cargo/bin/rustc"

# ---- JDK 21 ----------------------------------------------------------------
bold "JDK 21"
if brew list --formula "$JDK_FORMULA" >/dev/null 2>&1; then
  ok "$JDK_FORMULA already installed"
else
  info "Installing $JDK_FORMULA..."
  brew install "$JDK_FORMULA"
fi
JAVA_HOME_PATH="$(brew --prefix "$JDK_FORMULA")/libexec/openjdk.jdk/Contents/Home"
[ -x "$JAVA_HOME_PATH/bin/java" ] || die "JDK installed but java not found at $JAVA_HOME_PATH"
export JAVA_HOME="$JAVA_HOME_PATH"
export PATH="$JAVA_HOME/bin:$PATH"
ok "JAVA_HOME=$JAVA_HOME  ($("$JAVA_HOME/bin/java" -version 2>&1 | head -1))"

# ---- Android SDK cmdline-tools --------------------------------------------
bold "Android SDK"
if ! command -v sdkmanager >/dev/null 2>&1; then
  info "Installing Android command-line tools..."
  brew install --cask android-commandlinetools
else
  ok "sdkmanager present"
fi
# Homebrew cask installs the SDK under share/android-commandlinetools.
SDK_ROOT="$BREW_PREFIX/share/android-commandlinetools"
[ -d "$SDK_ROOT" ] || die "Expected Android SDK at $SDK_ROOT but it's missing."
export ANDROID_HOME="$SDK_ROOT"
export ANDROID_SDK_ROOT="$SDK_ROOT"

info "Accepting SDK licenses..."
yes | sdkmanager --sdk_root="$SDK_ROOT" --licenses >/dev/null || true

info "Installing SDK packages (platform-tools, $ANDROID_PLATFORM, build-tools $ANDROID_BUILD_TOOLS, ndk $NDK_VERSION)..."
sdkmanager --sdk_root="$SDK_ROOT" \
  "platform-tools" \
  "platforms;$ANDROID_PLATFORM" \
  "build-tools;$ANDROID_BUILD_TOOLS" \
  "ndk;$NDK_VERSION"
ok "Android SDK ready ($SDK_ROOT), NDK $NDK_VERSION"

# ---- local.properties ------------------------------------------------------
bold "Writing App/local.properties"
[ -d "$ANDROID_APP_DIR/App" ] || die "Android project not found at $ANDROID_APP_DIR/App"
if [ -f "$LOCAL_PROPS" ]; then
  cp "$LOCAL_PROPS" "$LOCAL_PROPS.bak"
  info "Backed up existing file to local.properties.bak"
fi
cat > "$LOCAL_PROPS" <<EOF
sdk.dir=$SDK_ROOT
rust.cargoCommand=$CARGO_BIN
rust.rustcCommand=$RUSTC_BIN
EOF
ok "Wrote $LOCAL_PROPS"

# ---- Node version check ----------------------------------------------------
bold "Node version"
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$NODE_MAJOR" -ge "$NODE_MIN_MAJOR" ] && [ "$NODE_MAJOR" -le "$NODE_MAX_MAJOR" ]; then
    ok "node $(node -v) is within the supported range"
  else
    warn "node $(node -v) is outside the repo range (>=22.12 <23). The web bundle may misbuild."
    warn "Fix with: nvm install \$(cat \"$REPO_ROOT/.nvmrc\") && nvm use"
  fi
else
  warn "node not found on PATH."
fi

# ---- done ------------------------------------------------------------------
echo
bold "All native dependencies installed."
cat <<EOF

Add these to your shell profile (~/.zshrc) so future shells find the tools:

  export JAVA_HOME="$JAVA_HOME_PATH"
  export ANDROID_HOME="$SDK_ROOT"
  export ANDROID_SDK_ROOT="$SDK_ROOT"
  export PATH="\$HOME/.cargo/bin:\$JAVA_HOME/bin:\$PATH"

Then build the app from the repo root:

  yarn install
  BUILD_TYPE=canary PUBLIC_PATH="/" yarn notesgraph @notesgraph/android build
  yarn notesgraph @notesgraph/android cap sync
  yarn notesgraph @notesgraph/android cap open android      # or: cd $ANDROID_APP_DIR/App && ./gradlew assembleCanaryDebug

Note: release (AAB) signing also needs notesgraph.keystore + the
NOTESGRAPH_ANDROID_KEYSTORE_PASSWORD / _ALIAS_PASSWORD env vars — not required for debug builds.
EOF
