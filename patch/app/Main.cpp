// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// The Bleep App (spec §11): the board without a DAW.
#include "AppController.h"

#include <cstdio>

class BleepApplication : public juce::JUCEApplication {
public:
    const juce::String getApplicationName() override { return "Bleep App"; }
    const juce::String getApplicationVersion() override { return JUCE_APPLICATION_VERSION_STRING; }
    bool moreThanOneInstanceAllowed() override { return false; }

    void initialise(const juce::String& commandLine) override {
        controller_ = std::make_unique<bleep::app::AppController>();
        const bool smoke = commandLine.contains("--smoke");
        controller_->setSmokeTest(smoke);
        controller_->setForceSystemAudio(commandLine.contains("--system-audio"));
        controller_->start(smoke ? juce::String() : commandLine.replace("--system-audio", "").trim());
        if (smoke)
            juce::Timer::callAfterDelay(4000, [this] {
                std::printf("%s\n", controller_->report().toRawUTF8());
                std::fflush(stdout);
                quit();
            });
    }
    void shutdown() override { controller_.reset(); }
    void systemRequestedQuit() override {
        if (controller_) controller_->confirmDiscard([] { quit(); });
        else quit();
    }
    void anotherInstanceStarted(const juce::String& commandLine) override {
        if (controller_) controller_->openFromCommandLine(commandLine);
    }

private:
    std::unique_ptr<bleep::app::AppController> controller_;
};

START_JUCE_APPLICATION(BleepApplication)
