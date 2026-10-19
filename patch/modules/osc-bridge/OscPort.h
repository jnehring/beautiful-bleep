// SPDX-License-Identifier: GPL-3.0-or-later
// The one UDP port the OSC Bridge modules share (doc/specs/modules/osc-bridge.md §5): a thread that
// reads packets into a message log and sends what the modules queue. Nothing is opened until a
// module is switched on; one module at a time owns the port.
#pragma once

#include "Osc.h"
#include "OscBridgeDsp.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <atomic>
#include <memory>
#include <vector>

namespace bleep::engine {

namespace osc = patch::osc;

class OscPort final : private juce::Thread {
public:
    struct Config {
        bool active = false;
        int listenPort = 9000;
        bool network = false;  ///< false: only this computer may send to us
        juce::String host = "127.0.0.1";
        int sendPort = 9001;
        bool operator==(const Config& o) const {
            return active == o.active && listenPort == o.listenPort && network == o.network && host == o.host && sendPort == o.sendPort;
        }
    };
    enum Status { Closed = 0, Listening, Failed, Busy };

    static OscPort& instance() {
        static OscPort port;
        return port;
    }

    /// [message thread] `owner` asks for this configuration. The owner of an active configuration keeps the
    /// port until it switches off or goes away; another module asking meanwhile gets Busy.
    Status configure(const void* owner, const Config& want) {
        const juce::ScopedLock l(lock_);
        if (want.active) {
            if (owner_ != nullptr && owner_ != owner) return Busy;
            owner_ = owner;
            if (!(want == config_)) {
                config_ = want;
                dirty_ = true;
            }
            if (!isThreadRunning()) startThread();
            notify();
            return (Status)status_.load();
        }
        if (owner_ == owner) {
            owner_ = nullptr;
            config_.active = false;
            dirty_ = true;
            notify();
        }
        return Closed;
    }
    /// [message thread] The module is going away.
    void release(const void* owner) {
        Config off;
        configure(owner, off);
    }

    Status status() const noexcept { return (Status)status_.load(); }
    const osc::Log& inbox() const noexcept { return inbox_; }
    uint32_t sent() const noexcept { return sent_.load(); }

    void addSender(patch::OscOutQueue* q) {
        const juce::ScopedLock l(lock_);
        senders_.push_back(q);
    }
    void removeSender(patch::OscOutQueue* q) {
        const juce::ScopedLock l(lock_);
        senders_.erase(std::remove(senders_.begin(), senders_.end(), q), senders_.end());
    }

private:
    OscPort() : juce::Thread("OSC port") {}
    ~OscPort() override { stopThread(1000); }

    void run() override {
        std::vector<uint8_t> buf(2048);
        patch::OscOutgoing out;
        uint8_t packet[256];
        while (!threadShouldExit()) {
            bool reconfigure = false;
            Config cfg;
            {
                const juce::ScopedLock l(lock_);
                reconfigure = dirty_;
                dirty_ = false;
                cfg = config_;
            }
            if (reconfigure) open(cfg);
            if (!socket_) {
                wait(100);
                continue;
            }
            // Receive: wait a couple of milliseconds, then send what is queued, so replies are never late.
            if (socket_->waitUntilReady(true, 2) == 1) {
                for (int burst = 0; burst < 64; ++burst) {
                    const int n = socket_->read(buf.data(), (int)buf.size(), false);
                    if (n <= 0) break;
                    osc::decodePacket(buf.data(), (size_t)n, [&](const osc::Message& m) { inbox_.push(m); });
                    if (socket_->waitUntilReady(true, 0) != 1) break;
                }
            }
            const juce::ScopedLock l(lock_);
            for (auto* q : senders_)
                while (q->pop(out)) {
                    const size_t n = osc::encode(out.address, &out.value, 1, packet, sizeof packet);
                    if (n > 0 && socket_->write(cfg.host, cfg.sendPort, packet, (int)n) > 0) sent_.fetch_add(1);
                }
        }
    }

    void open(const Config& cfg) {
        socket_.reset();
        status_.store(Closed);
        if (!cfg.active) return;
        auto s = std::make_unique<juce::DatagramSocket>(false);
        if (s->bindToPort(cfg.listenPort, cfg.network ? juce::String() : juce::String("127.0.0.1"))) {
            socket_ = std::move(s);
            status_.store(Listening);
        } else {
            status_.store(Failed);
        }
    }

    juce::CriticalSection lock_;
    Config config_;
    bool dirty_ = false;
    const void* owner_ = nullptr;
    std::vector<patch::OscOutQueue*> senders_;
    std::unique_ptr<juce::DatagramSocket> socket_;  // run() thread only
    std::atomic<int> status_{Closed};
    std::atomic<uint32_t> sent_{0};
    osc::Log inbox_;
};

}  // namespace bleep::engine
