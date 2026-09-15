package com.example.orders.idempotency;

import java.util.Optional;
import java.util.function.Supplier;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The single transaction that claims the key, does the work, and records the
 * response.
 *
 * <p>All three in one transaction is the whole point. The order row and the
 * dedup row commit together or not at all, so there is no window in which an
 * order exists without its key (a retry would create a second one) or a key
 * exists without its order (a retry would be told about an order that was never
 * created).
 *
 * <p>This lives in its own bean rather than as a method on
 * {@link IdempotentExecutor} on purpose: Spring's {@code @Transactional} is a
 * proxy, and a self-invocation from the executor would silently run with no
 * transaction at all. That failure is invisible until two requests race.
 */
@Component
public class IdempotentTransaction {

    private final IdempotencyStore store;

    public IdempotentTransaction(IdempotencyStore store) {
        this.store = store;
    }

    /**
     * @return the fresh response if this call won the key; {@link Optional#empty()}
     *         if a committed record already exists, in which case nothing was
     *         written and the caller should replay the existing record
     */
    @Transactional
    public Optional<StoredResponse> claimAndRun(
            IdempotencyContext context, Supplier<StoredResponse> work) {

        if (!store.tryClaim(context)) {
            // Lost the race. Returning rather than throwing keeps this out of the
            // error path: nothing was written, so committing an empty transaction
            // is both correct and cheaper than a rollback.
            return Optional.empty();
        }

        StoredResponse response = work.get();
        store.complete(context, response);
        return Optional.of(response);
    }

    /**
     * Reads the record outside the claiming transaction.
     *
     * <p>{@code REQUIRES_NEW} is not needed — this is called when no transaction
     * is active — but {@code NOT_SUPPORTED} documents and enforces that we are
     * reading committed state, not our own aborted attempt.
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED, readOnly = true)
    public Optional<IdempotencyRecord> read(IdempotencyContext context) {
        return store.find(context);
    }
}
