// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// ModuleLibrary.h — the modules of this machine as the app and the plugins see them: loaded at start, installed and removed
// from the Library section of the board window (developers/modules/library.md, sections 5a and 9). One per process, owned by the engine.
//
// Threads: start(), status() and the *Async calls are for the message thread. The work (network, disk) runs on a worker
// thread; what changes the registry happens on the message thread again. Nothing here touches the audio thread.
#pragma once

#include "InstalledModules.h"
#include "library/Client.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <functional>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <vector>

namespace bleep::engine {

class ModuleLibrary {
public:
    static ModuleLibrary& instance();

    /// Reads the settings and registers every installed module that may load. Once, when the engine starts.
    void start();

    /// Everything the Library section shows, as JSON: settings, installed modules, what the library offers, what is busy.
    juce::var status();

    void refreshIndexAsync(std::function<void()> done = {});
    /// Repeats the signature checks of the installed modules on a worker thread (the Library view serves the earlier result meanwhile).
    void recheckInstalledAsync();
    /// Installs (or updates) a module and registers its node types. `done(ok, message)` on the message thread.
    void installAsync(const std::string& slug, std::function<void(bool, std::string)> done = {});
    /// Installs one exact version of a module next to the newest (a board pins it) and registers it for the nodes that pin it.
    /// Older versions are not kept for their own sake: installing a newer version of the module removes them (the board asks again).
    void installVersionAsync(const std::string& slug, const std::string& version, std::function<void(bool, std::string)> done = {});
    void removeAsync(const std::string& slug, std::function<void(bool, std::string)> done = {});
    /// Installs every module the library offers that is not installed (the default module bundle).
    void installAllAsync(std::function<void(bool, std::string)> done = {});
    /// Updates every module installed from the library for which the library offers a newer version (local modules stay as they are).
    void updateAllAsync(std::function<void(bool, std::string)> done = {});

    /// Installs the plugin bundle (every VST3 plugin the library has for this platform) into the user's VST3 folder, on a worker
    /// thread. Refused while Ableton Live runs. The outcome is `pluginJob` in status().
    void installPluginsAsync();

    library::Settings settings() const;
    bool setSettings(const library::Settings& s, std::string& error);   ///< saves them (false + `error`: the address is not allowed); modules already loaded stay as they are until the next start
    juce::File dataDir() const { return dataDir_; }

    /// A view script or doc file (ui/<name>, doc/<name>) of an installed module, for the board window; by file name.
    bool viewFile(const std::string& name, std::vector<uint8_t>& bytes) const;
    /// The names of the view scripts of the installed modules (module-views.json).
    std::string moduleViewsJson() const;

    /// Called on the message thread when the set of node types changed (an install finished): the window asks for them again.
    std::function<void()> onTypesChanged;
    /// How work gets back to the message thread (the app sets juce::MessageManager::callAsync); without it, work runs where it is.
    std::function<void(std::function<void()>)> postToMessageThread;

    /// For tests and tools: another data folder and root keys before start().
    void configure(juce::File dataDir, std::vector<std::vector<uint8_t>> extraRoots);

private:
    /// Looks for a newer signed revocation list (signing.md section 8) and has the installed modules checked again if there is one.
    void fetchRevocations(const library::Client& c);
    ModuleLibrary() = default;
    std::unique_ptr<library::Client> client() const;
    void registerInstalled(const std::string& slug, const std::string& version = {});   // message thread; no version: the newest installed
    void post(std::function<void()> f);
    void setBusy(const std::string& slug, const std::string& what);

    mutable std::mutex mutex_;
    juce::File dataDir_;
    library::Settings settings_;
    std::vector<std::vector<uint8_t>> roots_;
    std::vector<LoadReport> reports_;
    library::Index index_;
    std::string indexError_;
    bool haveIndex_ = false;
    bool indexFromCache_ = false;   ///< the index is the copy saved on disk: the library was not reached
    int64_t indexAt_ = 0;           ///< unix seconds the saved index was fetched
    bool cacheTried_ = false;
    std::map<std::string, std::string> busy_;
    std::set<std::string> registered_;   ///< "slug version" of the older versions already in the registry (message thread)
    struct PluginJob { std::string state = "idle", message; bool ok = false; } pluginJob_;   // idle | running | done
    std::atomic<bool> started_{false};
    std::atomic<bool> rechecking_{false};
    /// The view scripts and docs of the installed modules by file name, read from the packages once (every request to the
    /// window used to verify and unpack all of them). Dropped when the set of installed modules changes.
    void buildViewCache() const;
    void dropViewCache();
    mutable std::mutex viewMutex_;
    mutable bool viewCacheBuilt_ = false;
    mutable std::map<std::string, std::vector<uint8_t>> viewFiles_;
    mutable std::string viewScripts_;   // module-views.json
};

}  // namespace bleep::engine
