// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// AppControllerProjects.cpp — projects (new, open, save) and the menus.
#include "AppControllerInternal.h"

namespace bleep::app {

// ---- projects ---------------------------------------------------------------------------------

bool AppController::dirty() const { return engine_->boardGeneration() != savedGeneration_; }

void AppController::updateTitle() {
    const juce::String title = projectName(project_) + (dirty() ? u8(" •") : "") + u8(" — Bleep App");
    if (title == lastTitle_) return;
    lastTitle_ = title;
    engine::setBoardWindowTitle(title);
}

void AppController::newProject() {
    const auto json = engine::board::toJson(engine::board::create()).toStdString();
    engine_->loadBoard(main_, json.data(), json.size());
    engine_->reconcileNow();
    project_ = juce::File();
    savedGeneration_ = engine_->boardGeneration();
    updateTitle();
}

bool AppController::openProject(const juce::File& file) {
    const auto doc = bleep::safejson::parse(file.loadFileAsString(), bleep::safejson::kProjectMaxDepth);
    if (!doc["board"].isObject()) {
        juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::WarningIcon, "Can't open project",
                                               file.getFullPathName() + " is not a Bleep App project.");
        return false;
    }
    const auto json = engine::board::toJson(doc["board"]).toStdString();
    engine_->loadBoard(main_, json.data(), json.size());
    engine_->reconcileNow();
    project_ = file;
    savedGeneration_ = engine_->boardGeneration();
    if (doc["tempo"].isDouble() || doc["tempo"].isInt()) clock_.setTempo((double)doc["tempo"]);
    updateTitle();
    return true;
}

void AppController::loadPatch(const juce::var& board, double tempo, const juce::String& name) {
    if (!board["nodes"].isArray()) return;
    confirmDiscard([this, board, tempo, name] {
        const auto json = engine::board::toJson(board).toStdString();
        engine_->loadBoard(main_, json.data(), json.size());
        engine_->reconcileNow();
        project_ = juce::File();  // a patch is a starting point: Save asks for a new file
        savedGeneration_ = engine_->boardGeneration();
        if (tempo >= 20.0 && tempo <= 400.0) clock_.setTempo(tempo);
        if (!clock_.playing()) clock_.setPlaying(true);  // demo boards play with the transport
        commands_.commandStatusChanged();
        updateTitle();
        juce::ignoreUnused(name);
    });
}

bool AppController::saveProject(const juce::File& file) {
    const size_t len = engine_->saveBoard(main_, nullptr, 0);
    std::string json(len, '\0');
    engine_->saveBoard(main_, json.data(), len);
    auto* o = new juce::DynamicObject();
    o->setProperty("format", 1);
    o->setProperty("app", "Bleep App");
    o->setProperty("tempo", clock_.tempo());
    o->setProperty("board", bleep::safejson::parse(juce::String::fromUTF8(json.data(), (int)json.size())));
    if (!file.replaceWithText(juce::JSON::toString(juce::var(o)))) {
        juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::WarningIcon, "Can't save project",
                                               "Could not write " + file.getFullPathName());
        return false;
    }
    project_ = file;
    savedGeneration_ = engine_->boardGeneration();
    updateTitle();
    return true;
}

void AppController::save(std::function<void()> then) {
    if (project_ == juce::File()) return saveAs(std::move(then));
    if (saveProject(project_) && then) then();
}

void AppController::saveAs(std::function<void()> then) {
    const auto start = project_ != juce::File() ? project_
                                               : juce::File::getSpecialLocation(juce::File::userDocumentsDirectory)
                                                     .getChildFile("Untitled" + juce::String(kProjectSuffix));
    chooser_ = std::make_unique<juce::FileChooser>("Save Bleep App project", start, "*" + juce::String(kProjectSuffix));
    chooser_->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting,
                          [this, then](const juce::FileChooser& c) {
                              auto f = c.getResult();
                              if (f == juce::File()) return;
                              if (!f.hasFileExtension(kProjectSuffix)) f = f.withFileExtension(kProjectSuffix);
                              if (saveProject(f) && then) then();
                          });
}

void AppController::confirmDiscard(std::function<void()> then) {
    if (!dirty()) return then();
    juce::AlertWindow::showYesNoCancelBox(
        juce::MessageBoxIconType::QuestionIcon, "Save changes to " + projectName(project_) + "?",
        "Your changes are lost if you don't save them.", "Save", "Don't Save", "Cancel", nullptr,
        juce::ModalCallbackFunction::create([this, then](int result) {
            if (result == 1) save(then);
            else if (result == 2) then();
        }));
}

// ---- menus ------------------------------------------------------------------------------------

// The page defines the menus (app-menu.js, one list for all hosts) and sends them; until then, and if it never does, File and Help.
void AppController::setMenuModel(const juce::var& menus) {
    const auto json = juce::JSON::toString(menus, true);
    if (!menus.isArray() || json == menuModelJson_) return;
    menuModelJson_ = json;
    menuModel_ = menus;
    menuItemsChanged();
}

juce::StringArray AppController::getMenuBarNames() {
    juce::StringArray names;
    if (auto* a = menuModel_.getArray())
        for (const auto& m : *a) names.add(m["title"].toString());
    if (names.isEmpty()) names = {"File", "Help"};
    return names;
}

namespace {
// The items the app performs itself (project files, native shortcuts): the rest the page answers.
int appCommandFor(const juce::String& id) {
    if (id == "project.new") return cmdNew;
    if (id == "project.openFile") return cmdOpen;
    if (id == "project.browse") return cmdPresets;
    if (id == "project.save") return cmdSave;
    if (id == "project.saveAs") return cmdSaveAs;
    if (id == "file.settings") return cmdSettings;
    if (id == "help.docs") return cmdDocs;
    if (id == "help.about") return cmdAbout;
    return 0;
}
}  // namespace

void AppController::menuItemSelected(int itemId, int) {
    const auto it = menuIds_.find(itemId);
    if (it != menuIds_.end()) engine::openBoardMenu(it->second);
}

juce::PopupMenu AppController::getMenuForIndex(int index, const juce::String&) {
    juce::PopupMenu m;
    if (auto* menus = menuModel_.getArray(); menus && index < menus->size()) {
        int n = 0;
        const int base = 1000 * (index + 1);
        for (auto it = menuIds_.lower_bound(base); it != menuIds_.end() && it->first < base + 1000;) it = menuIds_.erase(it);
        if (auto* items = (*menus)[index]["items"].getArray())
            for (const auto& item : *items) {
                if (!item.isObject()) { m.addSeparator(); continue; }
                const auto id = item["id"].toString();
                if (const int cmd = appCommandFor(id)) { m.addCommandItem(&commands_, cmd); continue; }
                menuIds_[base + n] = id;
                m.addItem(base + n, item["label"].toString(), !item.hasProperty("enabled") || (bool)item["enabled"]);
                ++n;
            }
        return m;
    }
    if (index == 0) {
        m.addCommandItem(&commands_, cmdNew);
        m.addCommandItem(&commands_, cmdOpen);
        m.addCommandItem(&commands_, cmdPresets);
        m.addSeparator();
        m.addCommandItem(&commands_, cmdSave);
        m.addCommandItem(&commands_, cmdSaveAs);
        m.addSeparator();
        m.addCommandItem(&commands_, cmdSettings);
    } else {
        m.addCommandItem(&commands_, cmdDocs);
        m.addSeparator();
        m.addCommandItem(&commands_, cmdAbout);
    }
    return m;
}

void AppController::getAllCommands(juce::Array<juce::CommandID>& c) {
    c.addArray({cmdNew, cmdOpen, cmdPresets, cmdSave, cmdSaveAs, cmdSettings, cmdDocs, cmdAbout, cmdPlay, cmdLink});
}

void AppController::getCommandInfo(juce::CommandID id, juce::ApplicationCommandInfo& info) {
    const auto cmd = juce::ModifierKeys::commandModifier;
    switch (id) {
        case cmdNew: info.setInfo(u8("New Project"), "New project", "File", 0); info.addDefaultKeypress('n', cmd); break;
        case cmdOpen: info.setInfo(u8("Open Project File…"), "Open a project file", "File", 0); info.addDefaultKeypress('o', cmd); break;
        case cmdPresets:
            info.setInfo(u8("Open Project…"), "Browse the demo projects and your own", "File", 0);
            info.addDefaultKeypress('p', cmd);
            break;
        case cmdSave: info.setInfo(u8("Save Project"), "Save the project", "File", 0); info.addDefaultKeypress('s', cmd); break;
        case cmdSaveAs:
            info.setInfo(u8("Save Project As…"), "Save the project as", "File", 0);
            info.addDefaultKeypress('s', cmd | juce::ModifierKeys::shiftModifier);
            break;
        case cmdSettings: info.setInfo(u8("Settings…"), "Audio, MIDI, Link, the Library and Security", "File", 0); info.addDefaultKeypress(',', cmd); break;
        case cmdDocs: info.setInfo("Documentation", "Open the documentation in your browser", "Help", 0); break;
        case cmdAbout: info.setInfo("Info", "About Bleep", "Help", 0); break;
        case cmdPlay:
            info.setInfo(clock_.playing() ? "Stop" : "Play", "Start or stop the transport", "Transport", 0);
            info.addDefaultKeypress(juce::KeyPress::returnKey, cmd);
            break;
        case cmdLink:
            info.setInfo("Ableton Link", "Sync tempo, beat and start/stop with Link", "Transport", 0);
            info.setTicked(clock_.enabled());
            info.setActive(LinkClock::available());
            break;
        default: break;
    }
}

bool AppController::perform(const InvocationInfo& info) {
    switch (info.commandID) {
        case cmdNew: confirmDiscard([this] { newProject(); }); return true;
        case cmdOpen:
            confirmDiscard([this] {
                chooser_ = std::make_unique<juce::FileChooser>(
                    "Open Bleep App project", juce::File::getSpecialLocation(juce::File::userDocumentsDirectory),
                    "*" + juce::String(kProjectSuffix));
                chooser_->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                                      [this](const juce::FileChooser& c) {
                                          if (c.getResult().existsAsFile()) openProject(c.getResult());
                                      });
            });
            return true;
        case cmdPresets: engine::openPresetBrowser(); return true;
        case cmdSave: save(); return true;
        case cmdSaveAs: saveAs(); return true;
        case cmdSettings: showSettings(); return true;
        case cmdDocs: engine::openBoardMenu("docs"); return true;
        case cmdAbout: engine::openBoardMenu("about"); return true;
        case cmdPlay:
            clock_.setPlaying(!clock_.playing());
            commands_.commandStatusChanged();
            return true;
        case cmdLink:
            setLinkEnabled(!clock_.enabled());
            commands_.commandStatusChanged();
            return true;
        default: return false;
    }
}

void AppController::showSettings() { engine::openSettings(); }

}  // namespace bleep::app
