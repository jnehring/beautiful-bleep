// SPDX-License-Identifier: GPL-3.0-or-later
// Live Params: which inputs the bridge sends, and when.
#include "LiveParamsDsp.h"
#include "dsp/tests/TestUtil.h"

#include <utility>
#include <vector>

using namespace bleep::patch;
using Sent = std::vector<std::pair<int, float>>;

static Sent poll(LiveParamsSender& s, const LiveParamsMailbox& box) {
    Sent out;
    s.poll(box, [&](int k, float v) { out.push_back({k, v}); });
    return out;
}

static void onlyCabledInputsAreSent() {
    TEST("only inputs with a cable are sent, with their last sample");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(0, true, 0.25f);
    box.publish(3, true, -0.5f);
    box.publish(5, false, 0.9f);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 2);
    EXPECT(m[0].first == 0 && m[0].second == 0.25f);
    EXPECT(m[1].first == 3 && m[1].second == -0.5f);
}

static void unchangedValuesAreNotRepeated() {
    TEST("a value that did not move is not sent again; one that moved is");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(1, true, 0.5f);
    EXPECT(poll(s, box).size() == 1);
    box.publish(1, true, 0.5f + 0.0001f);   // inside the deadband
    EXPECT(poll(s, box).empty());
    box.publish(1, true, 0.6f);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 1 && m[0].second == 0.6f);
}

static void unpatchingReleases() {
    TEST("removing the cable sends 0 once, so the device releases the parameter");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(2, true, 0.8f);
    poll(s, box);
    box.publish(2, false, 0.0f);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 1 && m[0].first == 2 && m[0].second == 0.0f);
    EXPECT(poll(s, box).empty());
}

static void reconnectSendsEverything() {
    TEST("a device that (re)connects gets every cabled input again");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(0, true, 0.1f);
    box.publish(1, true, 0.2f);
    poll(s, box);
    s.resendAll();
    EXPECT(poll(s, box).size() == 2);
}

static void channelResendsOnlyItsRows() {
    TEST("a device of channel 2 saying hello gets its four rows again, and nothing else is repeated");
    LiveParamsMailbox box;
    LiveParamsSender s;
    for (int k = 0; k < kNumLiveParams; ++k) box.publish(k, true, 0.1f * (float)k);
    poll(s, box);
    s.resendChannel(2);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 4);
    for (size_t i = 0; i < m.size(); ++i) EXPECT(m[i].first == (int)(4 + i));
    s.resendChannel(0);    // out of range: ignored
    s.resendChannel(kNumChannels + 1);
    EXPECT(poll(s, box).empty());
}

static void notANumberIsZero() {
    TEST("NaN and infinity never reach Live");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(0, true, std::nanf(""));
    const Sent m = poll(s, box);
    EXPECT(m.size() == 1 && m[0].second == 0.0f);
}

static void clearChannelReleasesItsRows() {
    TEST("clearChannel() (a node was deleted or changed channel) uncables its four rows and no others");
    LiveParamsMailbox box;
    LiveParamsSender s;
    for (int k = 0; k < kNumLiveParams; ++k) box.publish(k, true, 0.3f);
    poll(s, box);
    box.clearChannel(3);   // rows 8..11
    const Sent m = poll(s, box);
    EXPECT(m.size() == 4);
    for (size_t i = 0; i < m.size(); ++i) EXPECT(m[i].first == (int)(8 + i) && m[i].second == 0.0f);
    box.clearChannel(0);   // out of range: ignored
    box.clearChannel(kNumChannels + 1);
    EXPECT(poll(s, box).empty());
}

static void eightChannelsFit() {
    TEST("eight channels of four rows: the last channel's rows are rows 28..31 and are sent");
    LiveParamsMailbox box;
    LiveParamsSender s;
    box.publish(31, true, 0.5f);
    const Sent m = poll(s, box);
    EXPECT(m.size() == 1 && m[0].first == 31 && m[0].second == 0.5f);
    s.resendChannel(kNumChannels);
    EXPECT(poll(s, box).size() == 1);
}

int main() {
    onlyCabledInputsAreSent();
    unchangedValuesAreNotRepeated();
    unpatchingReleases();
    reconnectSendsEverything();
    channelResendsOnlyItsRows();
    notANumberIsZero();
    clearChannelReleasesItsRows();
    eightChannelsFit();
    return bleep::test::finish("live-params");
}
