// SPDX-License-Identifier: MIT
//
// Client.h — the Bleep Store from the app and the plugins (doc/specs/store.md, signing.md): read its index, install and remove
// modules on this machine, list what is installed. Everything here blocks (network, disk): call it from a worker thread,
// never from the audio thread.
#pragma once

#include "Verify.h"

#include <juce_core/juce_core.h>

#include <string>
#include <vector>

namespace bleep::store {

/// The settings the app and every plugin share (<data>/settings.json).
#ifndef BLEEP_STORE_URL
#define BLEEP_STORE_URL "https://store.bleep.invalid"   // the site's address, put in at build time (CMake: BLEEP_PATCH_STORE_URL)
#endif

struct Settings {
    std::string storeUrl = BLEEP_STORE_URL;  ///< the site's address; the store lives under /registry/v1/
    std::string channel = "stable";
    AllowUnsigned allowUnsigned;                           ///< Settings → Security
    bool firstRunDone = false;                             ///< the setup assistant has been answered (doc/specs/store.md 5a)

    static Settings load(const juce::File& dataDir);       ///< defaults for what is missing
    bool save(const juce::File& dataDir) const;
};

/// ~/Library/Application Support/Bleep (macOS), %APPDATA%\Bleep (Windows), ~/.local/share/Bleep (Linux).
juce::File defaultDataDir();

struct IndexModule {
    std::string slug, version, entry;   ///< entry: path of entry.json under /registry/v1/
    std::vector<std::string> types;
};
struct Index {
    std::vector<IndexModule> modules;
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

    bool fetchIndex(Index& out, std::string& error) const;
    /// Downloads, checks and installs the newest version of a module; older versions are removed after it worked.
    bool install(const std::string& slug, InstalledModule& out, std::string& error) const;
    bool remove(const std::string& slug, std::string& error) const;
    /// Every module in the data folder (the newest version of each), verified. Nothing is loaded.
    std::vector<InstalledModule> installed() const;
    /// The module.wasm and spec.json of an installed module, for the engine; checked again against its signature here.
    /// `spec` stays empty if the package has none.
    bool contentOf(const InstalledModule& module, std::vector<uint8_t>& wasm, std::string& spec, std::string& error) const;

    juce::File modulesFolder(const std::string& source) const;
    const Settings& settings() const { return settings_; }

private:
    juce::String url(const std::string& path) const;
    bool check(const std::vector<uint8_t>& bytes, const std::string& slug, const std::string& version, const juce::var* signatureDoc,
               InstalledModule& out, std::string& error) const;

    Settings settings_;
    juce::File dataDir_;
    std::vector<std::vector<uint8_t>> roots_;
    int64_t now_;
};

}  // namespace bleep::store
