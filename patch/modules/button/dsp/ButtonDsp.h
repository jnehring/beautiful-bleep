// SPDX-License-Identifier: MIT
// Button core (specs/modules/button.md §4): presses and releases in, gate and
// triggers out. Every press flips the Toggle output; Gate follows the finger
// (Momentary) or the toggle (Toggle).
#pragma once

namespace bleep::patch {

enum ButtonMode { ButtonMomentary = 0, ButtonToggle };

struct ButtonFrame {
    float gate = 0.0f, trigger = 0.0f, release = 0.0f, toggle = 0.0f;
};

class ButtonDsp {
public:
    void reset() noexcept { held_ = pressed_ = released_ = false; }
    /// The latched state (Toggle mode), e.g. restored from the node's data.
    void setLatched(bool on) noexcept { latched_ = on; }
    bool latched() const noexcept { return latched_; }
    bool held() const noexcept { return held_; }

    /// `latch`: the toggle's new state (the view saves it), or −1 to flip.
    void press(int latch = -1) noexcept {
        if (held_) return;
        held_ = pressed_ = true;
        latched_ = latch < 0 ? !latched_ : latch > 0;
    }
    void release() noexcept {
        if (!held_) return;
        held_ = false;
        released_ = true;
    }

    /// One sample, after this sample's presses. A press and release in the
    /// same chunk still give a one-sample gate.
    void tick(int mode, ButtonFrame& f) noexcept {
        f.trigger = pressed_ ? 1.0f : 0.0f;
        f.release = released_ && !pressed_ ? 1.0f : 0.0f;
        f.toggle = latched_ ? 1.0f : 0.0f;
        f.gate = mode == ButtonToggle ? f.toggle : (held_ || pressed_ ? 1.0f : 0.0f);
        if (pressed_) pressed_ = false;
        else released_ = false;
    }

private:
    bool held_ = false, pressed_ = false, released_ = false, latched_ = false;
};

}  // namespace bleep::patch
