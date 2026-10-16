/* SPDX-License-Identifier: MIT */
/* checks_registry.c — endpoints and ports, and duplicated UIDs. */
#include "bb_conf.h"

void check_registry(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    uint32_t gen0 = bb_registry_generation(bus);
    uint32_t ep_count0 = bb_list_endpoints(bus, NULL, 0);
    uint32_t out_count0 = bb_list_outputs(bus, NULL, 0);
    bb_error err;
    bb_endpoint* ep = make_endpoint(bus, "Registry Test", 0);
    CHECK(ep != NULL);
    CHECK(bb_endpoint_uid(ep) != 0);
    CHECK(bb_registry_generation(bus) != gen0);
    CHECK(bb_add_output(ep, "A", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) != NULL);
    CHECK(bb_add_output(ep, "EOC", BB_SIGNAL_TRIGGER, BB_POLARITY_UNIPOLAR, &err) != NULL);
    CHECK(bb_add_output(ep, "A", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_ALREADY_EXISTS);
    CHECK(bb_add_output(ep, "a/b", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_INVALID_ARGUMENT);
    CHECK(bb_add_output(ep, "", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) == NULL);
    CHECK(bb_add_output(ep, "this-output-name-is-much-too-long", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) ==
          NULL);
    CHECK(bb_add_output(ep, "X", BB_SIGNAL_AUDIO, BB_POLARITY_BIPOLAR, &err) == NULL); /* reserved */
    CHECK(bb_add_input(ep, "Rate", BB_SIGNAL_CONTROL, &err) != NULL);
    CHECK(bb_add_input(ep, "Rate", BB_SIGNAL_CONTROL, &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_ALREADY_EXISTS);
    CHECK(bb_add_input(ep, "A", BB_SIGNAL_CONTROL, &err) != NULL); /* inputs and outputs: separate names */

    CHECK_EQ_INT(bb_list_endpoints(bus, NULL, 0), ep_count0 + 1);
    CHECK_EQ_INT(bb_list_outputs(bus, NULL, 0), out_count0 + 2);
    bb_input_info inputs[4];
    CHECK_EQ_INT(bb_list_inputs(bus, bb_endpoint_uid(ep), inputs, 4), 2);
    CHECK(strcmp(inputs[0].name, "Rate") == 0);

    bb_endpoint_info infos[BB_MAX_ENDPOINTS];
    uint32_t n = bb_list_endpoints(bus, infos, BB_MAX_ENDPOINTS);
    int found = 0;
    for (uint32_t i = 0; i < n; ++i) {
        if (infos[i].uid != bb_endpoint_uid(ep)) continue;
        found = 1;
        CHECK(strcmp(infos[i].display_name, "Registry Test") == 0);
        CHECK_EQ_INT(infos[i].num_outputs, 2);
        CHECK_EQ_INT(infos[i].num_inputs, 2);
    }
    CHECK(found);

    CHECK_EQ_INT(bb_set_instance_name(ep, "Renamed \xc3\xa4"), BB_OK); /* UTF-8 is fine */
    CHECK_EQ_INT(bb_set_track_name(ep, "Bass"), BB_OK);
    n = bb_list_endpoints(bus, infos, BB_MAX_ENDPOINTS);
    for (uint32_t i = 0; i < n; ++i)
        if (infos[i].uid == bb_endpoint_uid(ep))
            CHECK(strcmp(infos[i].display_name, "Renamed \xc3\xa4") == 0 && strcmp(infos[i].track_name, "Bass") == 0);

    bb_unregister_instance(ep);
    CHECK_EQ_INT(bb_list_endpoints(bus, NULL, 0), ep_count0);
    CHECK_EQ_INT(bb_list_outputs(bus, NULL, 0), out_count0);
    bb_bus_close(bus);
}

void check_uid_collisions(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    const uint64_t uid = 0x1111222233334444ull;
    bb_error err;
    bb_instance_info info = BB_INSTANCE_INFO_INIT;
    info.uid = uid;
    bb_endpoint* a = bb_register_instance(bus, &info, &err);
    CHECK(a != NULL);
    CHECK_EQ_INT(err, BB_OK);
    CHECK(bb_endpoint_uid(a) == uid);
    bb_endpoint* b = bb_register_instance(bus, &info, &err); /* "duplicated device" */
    CHECK(b != NULL);
    CHECK_EQ_INT(err, BB_ERR_UID_IN_USE);
    CHECK(bb_endpoint_uid(b) != uid && bb_endpoint_uid(b) != 0);
    CHECK_EQ_INT(bb_set_instance_uid(b, uid), BB_ERR_UID_IN_USE);
    CHECK_EQ_INT(bb_set_instance_uid(b, 0x5555ull), BB_OK);
    CHECK(bb_endpoint_uid(b) == 0x5555ull);
    bb_unregister_instance(a);
    CHECK_EQ_INT(bb_set_instance_uid(b, uid), BB_OK); /* free again */
    bb_unregister_instance(b);
    CHECK(bb_generate_uid() != bb_generate_uid());
    bb_bus_close(bus);
}

