package com.example.orders.idempotency;

import com.example.orders.idempotency.IdempotencyRepository.IdempotencyRecord;
import java.util.Optional;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Executes an operation at-most-once per (endpoint, caller, idempotency key).
 *
 * <h2>Why this shape</h2>
 *
 * The ledger row and the business effect are written in <em>one</em> transaction.
 * That is the whole point: there is no window in which an order exists without its
 * key recorded, or vice versa. A "reserve first, do work, mark done" design needs two
 * transactions and therefore needs orphan/stuck-row recovery; this one does not.
 *
 * <p>Concurrency is handled by Postgres' unique index rather than by us:
 * <ul>
 *   <li>Retry arrives <b>after</b> the first request committed → INSERT raises 23505
 *       immediately → we replay the stored response.</li>
 *   <li>Retry arrives <b>while</b> the first request is still running → INSERT blocks
 *       on the index tuple until the first transaction ends, then either raises 23505
 *       (it committed → replay) or succeeds (it rolled back → this attempt does the
 *       work). Either way exactly one order is created.</li>
 * </ul>
 *
 * <p>Note the transaction gymnastics: in Postgres, a constraint violation aborts the
 * <em>whole</em> transaction. You cannot catch 23505 and keep using that connection.
 * So the attempt runs in its own transaction and the replay read happens in a fresh
 * one — which is why this method is deliberately NOT {@code @Transactional} and uses
 * an explicit {@link TransactionTemplate} instead of relying on proxy semantics.
 */
@Service
public class IdempotencyService {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyService.class);

    /** How long a retry waits behind an in-flight sibling before we return 409. */
    private static final String LOCK_TIMEOUT = "3000ms";

    private final IdempotencyRepository repository;
    private final TransactionTemplate transactions;

    public IdempotencyService(IdempotencyRepository repository, TransactionTemplate transactions) {
        this.repository = repository;
        this.transactions = transactions;
    }

    /**
     * @param scope       endpoint + caller + key
     * @param requestBody used to detect key reuse with a different payload
     * @param work        the business operation; must be side-effect-free outside the
     *                    database (no emails, no payment captures — see solution.md)
     * @return the response to return, plus whether it was a replay
     */
    public Outcome execute(IdempotencyScope scope, Object requestBody, Supplier<StoredResponse> work) {
        byte[] fingerprint = RequestFingerprint.of(requestBody);

        // Fast path: already completed. Avoids taking any lock at all for the common
        // "client retried 200ms after we answered" case.
        Optional<IdempotencyRecord> existing = readCommitted(scope);
        if (existing.isPresent()) {
            return replay(scope, fingerprint, existing.get());
        }

        try {
            StoredResponse response = transactions.execute(status -> {
                repository.setLockTimeout(LOCK_TIMEOUT);
                StoredResponse result = work.get();
                repository.insert(scope, fingerprint, result);
                return result;
            });
            return new Outcome(response, false);

        } catch (DuplicateKeyException e) {
            // Someone else got there first (possibly while we were blocked on the
            // index). Our transaction rolled back, so no order was created by us.
            log.info("idempotent replay after conflict scope={} key={}", scope.scope(), scope.key());
            IdempotencyRecord record = readCommitted(scope).orElseThrow(
                    () -> new IllegalStateException("duplicate key but no row; check constraint mapping", e));
            return replay(scope, fingerprint, record);

        } catch (CannotAcquireLockException | QueryTimeoutException e) {
            throw new IdempotencyInProgressException(
                    "A request with this Idempotency-Key is still in progress; retry shortly", e);
        }
    }

    private Optional<IdempotencyRecord> readCommitted(IdempotencyScope scope) {
        return transactions.execute(status -> repository.find(scope));
    }

    private Outcome replay(IdempotencyScope scope, byte[] fingerprint, IdempotencyRecord record) {
        if (!RequestFingerprint.matches(record.requestFingerprint(), fingerprint)) {
            throw new IdempotencyKeyReusedException(
                    "Idempotency-Key '%s' was already used for a different request body"
                            .formatted(scope.key()));
        }
        return new Outcome(record.response(), true);
    }

    /** @param replayed true when nothing new happened and we returned a stored answer */
    public record Outcome(StoredResponse response, boolean replayed) {
    }
}
