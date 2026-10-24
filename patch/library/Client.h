// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Client.h — the Bleep Library from the app and the plugins (developers/modules/library.md, signing.md): read its index, install and remove
// modules on this machine, list what is installed. Everything here blocks (network, disk): call it from a worker thread,
// never from the audio thread.
#pragma once

#include "Verify.h"

#include <optional>

#include <juce_core/juce_core.h>

#include <string>
#include <vector>

namespace bleep::library {

/// The settings the app and every plugin share (<data>/settings.json).
#ifndef BLEEP_LIBRARY_URL
#define BLEEP_LIBRARY_URL "https://library.bleep.invalid"   // the site's address, put in at build time (CMake: BLEEP_LIBRARY_URL)
#endif

/// May this address be used for the library? https anywhere; plain http only for the machine itself (localhost, 127.0.0.1, [::1],
/// *.localhost), since the token and the index would travel in cleartext; file: (a local folder, tests). `why` says what is wrong.
bool libraryUrlAllowed(const std::string& url, std::string& why);

struct Settings {
    std::string libraryUrl = BLEEP_LIBRARY_URL;  ///< the site's address; the library lives under /registry/v1/
    std::string channel = "stable";
    AllowUnsigned allowUnsigned;                           ///< Settings → Security
    bool firstRunDone = false;                             ///< the setup assistant has been answered (developers/modules/library.md 5a)
    bool updateCheck = true;                               ///< the app asks the library for updates at every start (Settings → Library)

    static Settings load(const juce::File& dataDir);       ///< defaults for what is missing
    bool save(const juce::File& dataDir) const;
};

/// ~/Library/Application Support/Bleep (macOS), %APPDATA%\Bleep (Windows), ~/.local/share/Bleep (Linux).
juce::File defaultDataDir();

/// `macos-arm64`, `windows-x86_64`, ...: the platform names of the library's plugin files (scripts/release/release.py platform_id).
std::string platformId();
/// The VST3 folder of this user (no administrator rights needed).
juce::File userPluginFolder();
/// Is Ableton Live running? Replacing a plugin it has loaded can crash it.
bool abletonLiveRunning();
/// Is version `a` newer than version `b` ("1.2.3" form; anything else is never newer)?
bool versionNewer(const std::string& a, const std::string& b);

struct IndexModule {
    std::string slug, version, entry;   ///< entry: path of entry.json under /registry/v1/
    std::string title, summary, category, image;   ///< the tile: image is a path under /registry/v1/, empty without a screenshot
    std::vector<std::string> types;
};
struct IndexPlugin {
    std::string slug, version, entry;
    std::string title, summary, category, image;
};
struct Index {
    std::vector<IndexModule> modules;
    std::vector<IndexPlugin> plugins;   ///< the VST3 plugins (and the app); `bleep-app` is not one to install into a DAW
    const IndexModule* find(const std::string& slug) const;
    /// The module that provides a node type, or null.
    const IndexModule* providing(const std::string& type) const;
};

/// An installed module: a .bleepmod in the data folder, checked just now.
struct InstalledModule {
    std::string slug, version, source;      ///< source: "registry" or "local"
    juce::File file;
    Result result;                          ///< what verification said
    bool allowed = false;                   ///< may it load, given the settings
    std::string why;                        ///< why it may or may not
    std::vector<std::string> types;
};

class Client {
public:
    /// `roots`: the pinned root public keys. `now`: unix seconds (the device clock; tests pass a fixed one).
    Client(Settings settings, juce::File dataDir, std::vector<std::vector<uint8_t>> roots, int64_t now = 0);

    /// Fetches the index from the library. Every index that was fetched is kept in the data folder (cache/index.json), so the
    /// library works offline: see loadCachedIndex.
    bool fetchIndex(Index& out, std::string& error) const;
    /// The index as it was last fetched from this library address and channel; `fetchedAt`: unix seconds. False when there is none.
    bool loadCachedIndex(Index& out, int64_t& fetchedAt, std::string& error) const;
    /// Downloads, checks and installs the newest version of a module; older versions are removed after it worked.
    bool install(const std::string& slug, InstalledModule& out, std::string& error) const;
    /// Downloads, checks and installs one exact version of a module next to the newest, for a board that pins it. The library keeps every
    /// version it published; an older one stays on this machine until a newer one is installed (install() removes older versions).
    bool installVersion(const std::string& slug, const std::string& version, InstalledModule& out, std::string& error) const;
    bool remove(const std::string& slug, std::string& error) const;
    /// Downloads a plugin from the library for this platform, checks its signature (kind "plugin") and the settings, and puts the
    /// .vst3 bundle(s) it holds into `folder`, replacing what is there. `names` receives the bundle names. Live must be closed (the caller checks).
    bool installPlugin(const std::string& slug, const juce::File& folder, std::vector<std::string>& names, std::string& error) const;
    /// The library's signed revocation list (signing.md section 8): fetched from v1/revocations.json, checked against the pinned roots, and
    /// kept in cache/revocations.json if its serial is higher than that of the list in use. `changed` says that it was. A list with
    /// a lower or equal serial is not an error: it is ignored, so a mirror cannot take revocations back. Every Client made afterwards
    /// applies the kept list when it verifies, with no network, and installed() notices it (the cache is keyed on its serial).
    bool fetchRevocations(bool& changed, std::string& error) const;
    /// The serial of the revocation list in use; 0 when the library has never given one.
    int64_t revocationSerial() const { return revocations_ ? revocations_->serial : 0; }
    /// Every module in the data folder (the newest version of each), verified. Nothing is loaded.
    /// From the cache where the package is unchanged; `recheck` verifies every package again (a worker thread's job: see cacheStale).
    /// `allVersions`: every version of a module from the library, not only the newest (older ones were fetched for boards that pin them).
    std::vector<InstalledModule> installed(bool recheck = false, bool allVersions = false) const;
    /// Has a cached check grown old enough to be repeated with installed(true)?
    static bool cacheStale();
    /// The module.wasm and spec.json of an installed module, for the engine; checked again against its signature here.
    /// `spec` stays empty if the package has none.
    bool contentOf(const InstalledModule& module, std::vector<uint8_t>& wasm, std::string& spec, std::string& error) const;
    /// Every file of an installed module (ui/, doc/, ...), from the bytes that were checked against its signature just now.
    /// Anything that serves or runs a file of a package takes it from here, not from installed(): that may answer from the cache.
    bool filesOf(const InstalledModule& module, Package& out, std::string& error) const;

    juce::File modulesFolder(const std::string& source) const;
    const Settings& settings() const { return settings_; }

    /// The address of a path under /registry/v1/ (an index entry's image, say).
    juce::String url(const std::string& path) const;

private:
    bool installEntry(const std::string& slug, const std::string& entryPath, const std::string& expectVersion, bool pruneOlder, InstalledModule& out, std::string& error) const;
    bool check(const std::vector<uint8_t>& bytes, const std::string& slug, const std::string& version, const juce::var* signatureDoc,
               const juce::var* receiptDoc, InstalledModule& out, std::string& error) const;

    std::optional<Revocations> loadRevocations() const;
    int64_t highestRevocationSerial() const;
    void keepRevocationSerial(int64_t serial) const;

    Settings settings_;
    juce::File dataDir_;
    std::vector<std::vector<uint8_t>> roots_;
    int64_t now_;
    mutable std::optional<Revocations> revocations_;  ///< the kept list, checked again against the roots whenever a Client is made
};

}  // namespace bleep::library
