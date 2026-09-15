package com.example.orders.idempotency;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

/** HTTP-level contract: what the mobile client actually observes on retry. */
@SpringBootTest
@AutoConfigureMockMvc
class OrderControllerIdempotencyTest {

    private static final String CUSTOMER = "7f1b2f6e-0000-4000-8000-000000000001";

    private static final String BODY = """
            {"lines":[{"skuId":"11111111-0000-4000-8000-000000000001","quantity":2}],
             "shippingAddressId":"22222222-0000-4000-8000-000000000002"}""";

    @Autowired
    MockMvc mvc;

    @Test
    @WithMockUser(username = CUSTOMER)
    void retryOfTheSameRequestReturnsTheSameOrderAndIsMarkedAsReplayed() throws Exception {
        String key = UUID.randomUUID().toString();

        var first = mvc.perform(post("/orders")
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isCreated())
                .andExpect(header().string("Idempotent-Replayed", "false"))
                .andReturn();

        String orderId = com.jayway.jsonpath.JsonPath.read(
                first.getResponse().getContentAsString(), "$.id");

        mvc.perform(post("/orders")
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isCreated())
                .andExpect(header().string("Idempotent-Replayed", "true"))
                .andExpect(header().string("Location", "/orders/" + orderId))
                .andExpect(jsonPath("$.id").value(orderId));
    }

    @Test
    @WithMockUser(username = CUSTOMER)
    void missingIdempotencyKeyIsRejected() throws Exception {
        mvc.perform(post("/orders").contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("https://errors.example.com/idempotency-key-required"));
    }

    @Test
    @WithMockUser(username = CUSTOMER)
    void reusingAKeyForADifferentBasketIsRejected() throws Exception {
        String key = UUID.randomUUID().toString();
        mvc.perform(post("/orders").header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON).content(BODY)).andExpect(status().isCreated());

        String differentBody = BODY.replace("\"quantity\":2", "\"quantity\":5");

        mvc.perform(post("/orders").header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(differentBody))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.type").value("https://errors.example.com/idempotency-key-reused"));
    }

    @Test
    @WithMockUser(username = CUSTOMER)
    void placingTheSameBasketTwiceWithDifferentKeysCreatesTwoOrders() throws Exception {
        // The customer is allowed to order the same thing twice. Any dedupe scheme
        // that blocks this is wrong, which is why we key on the attempt, not the cart.
        mvc.perform(post("/orders").header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isCreated())
                .andExpect(header().string("Idempotent-Replayed", "false"));

        mvc.perform(post("/orders").header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isCreated())
                .andExpect(header().string("Idempotent-Replayed", "false"));
    }
}
