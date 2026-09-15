package com.example.orders.api;

import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/**
 * Create-order payload.
 *
 * <p>This DTO is also the input to the request fingerprint, so every field the
 * client can vary must be modelled here. A field accepted but not modelled would
 * be invisible to the fingerprint, and two genuinely different requests sharing
 * a key would hash the same.
 */
public record CreateOrderRequest(
        @NotNull UUID customerId,
        @NotEmpty @Size(max = 200) @Valid List<Line> lines,
        @NotNull @Size(max = 64) String currency) {

    public record Line(
            @NotNull UUID skuId,
            @Positive int quantity) {
    }
}
