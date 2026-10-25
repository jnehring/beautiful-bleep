// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "RecordingsSettings.h"

#include "Recording.h"

#include <atomic>
#include <memory>
#include <mutex>
#include <string>

namespace bleep::engine {
namespace {

std::unique_ptr<juce::FileChooser> g_chooser;   // message thread
std::atomic<bool> g_choosing{false};
std::mutex g_lock;
std::string g_error;                            // what the last choice could not do

void remember(const std::string& error) {
    std::lock_guard<std::mutex> l(g_lock);
    g_error = error;
}

}  // namespace

void chooseFolder(const std::string& start, std::function<void(std::string)> done) {
    if (g_choosing.exchange(true)) {
        done({});
        return;
    }
    juce::File from(juce::String::fromUTF8(start.c_str()));
    while (from != juce::File() && !from.isDirectory()) from = from.getParentDirectory();
    g_chooser = std::make_unique<juce::FileChooser>("Choose the folder to record to", from);
    g_chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories,
                           [done = std::move(done)](const juce::FileChooser& c) {
                               const juce::File chosen = c.getResult();
                               g_choosing = false;
                               done(chosen == juce::File() ? std::string() : chosen.getFullPathName().toStdString());
                           });
}

juce::var recordingsState() {
    auto* o = new juce::DynamicObject();
    recording::ensureDiskService();
    const std::string folder = recording::folder(), def = recording::defaultFolder();
    o->setProperty("folder", juce::String::fromUTF8(folder.c_str()));
    o->setProperty("defaultFolder", juce::String::fromUTF8(def.c_str()));
    o->setProperty("isDefault", folder == def);
    if (auto* svc = recording::service()) o->setProperty("freeBytes", svc->freeBytes());
    o->setProperty("choosing", g_choosing.load());
    std::lock_guard<std::mutex> l(g_lock);
    if (!g_error.empty()) o->setProperty("error", juce::String::fromUTF8(g_error.c_str()));
    return juce::var(o);
}

juce::var recordingsCall(const juce::var& arg) {
    recording::ensureDiskService();
    std::string error;
    if (arg["folder"].isString()) {
        recording::saveFolder(arg["folder"].toString().toStdString(), &error);
    } else if ((bool)arg["reset"]) {
        recording::saveFolder("", &error);
    } else if ((bool)arg["reveal"]) {
        const juce::File folder(juce::String::fromUTF8(recording::folder().c_str()));
        folder.createDirectory();
        folder.revealToUser();
    } else if ((bool)arg["choose"] && !g_choosing.exchange(true)) {
        g_chooser = std::make_unique<juce::FileChooser>("Choose the Recordings folder", juce::File(juce::String::fromUTF8(recording::folder().c_str())));
        g_chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories, [](const juce::FileChooser& c) {
            const juce::File chosen = c.getResult();
            std::string why;
            if (chosen != juce::File()) recording::saveFolder(chosen.getFullPathName().toStdString(), &why);
            remember(why);
            g_choosing = false;
        });
    }
    remember(error);
    auto state = recordingsState();
    return state;
}

}  // namespace bleep::engine
