package com.example.orders.idempotency;

import java.util.Optional;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Entry point for running an operation at most once per idempotency key.
 *
 * <p>Not transactional itself. It must be able to observe another transaction's
 * commit, which is impossible from inside a transaction that started earlier.
 */
@Service
public class IdempotentExecutor {

    private static final Logger log = LoggerFactory.getLogger(IdempotentExecutor.class);

    private final IdempotentTransaction transaction;
    private final RequestFingerprint fingerprint;

    public IdempotentExecutor(IdempotentTransaction transaction, RequestFingerprint fingerprint) {
        this.transaction = transaction;
        this.fingerprint = fingerprint;
    }

    /**
     * Runs {@code work} once for this key, or replays the stored response.
     *
     * <p>Note what happens when {@code work} throws: the transaction rolls back
     * and takes the claim with it, so the key is free again. A failed attempt
     * must not burn the key — otherwise a transient database error would leave
     * the client permanently unable to place that order, with nothing to show
     * for it.
     */
    public StoredResponse execute(IdempotencyContext context, Supplier<StoredResponse> work) {
        Optional<IdempotencyRecord> existing = transaction.read(context);
        if (existing.isPresent()) {
            return replay(context, existing.get());
        }

        Optional<StoredResponse> fresh = transaction.claimAndRun(context, work);
        if (fresh.isPresent()) {
            return fresh.get();
        }

        // The claim found a committed row: a concurrent request with the same key
        // won. Postgres made our INSERT wait for that transaction, so by the time
        // we get here the winner's response is durable and readable.
        IdempotencyRecord winner = transaction.read(context).orElseThrow(() ->
                new IdempotencyExceptions.InconsistentRecord(
                        "key %s claimed by a concurrent request but no record is readable"
                                .formatted(context.key())));
        log.info("idempotent replay after concurrent claim: scope={} key={}",
                context.scope(), context.key());
        return replay(context, winner);
    }

    private StoredResponse replay(IdempotencyContext context, IdempotencyRecord record) {
        if (!fingerprint.matches(record.requestHash(), context.requestHash())) {
            // Deliberately loud. Silently returning the stored order here is the
            // bug that looks like idempotency working and is impossible to find
            // later: the client believes order B was placed, and order A exists.
            log.warn("idempotency key reused with a different payload: scope={} key={}",
                    context.scope(), context.key());
            throw new IdempotencyExceptions.KeyReusedWithDifferentPayload(
                    "This Idempotency-Key was already used with a different request body. "
                            + "Use a new key for a new request.");
        }

        if (!record.isCompleted()) {
            throw new IdempotencyExceptions.InProgress(
                    "A request with this Idempotency-Key is still being processed. "
                            + "Retry the same key shortly.");
        }

        return new StoredResponse(
                record.responseStatus(), record.responseBody(), record.resourceId(), true);
    }
}
