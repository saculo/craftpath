---
name: test-behaviour-not-implementation
description: Write tests that prove observable behaviour through owned boundaries, rather than implementation details. Use before writing scenarios, implementation tests, or reviewing tests.
---

# Test behaviour, not implementation

A test is a claim about behaviour a caller or user can observe. Test that claim
through the real boundaries the project owns, not through its internal classes,
functions, state, or call sequence.

## Use the real boundary

Use real owned boundaries: the project's handlers, persistence, serialization,
rendering, and other code it owns. Mock only systems the project does not own,
such as third-party APIs, clocks, randomness, or real-world side effects.

A mock of an owned boundary can make a test pass while the integration it is
supposed to prove is broken. Assert the observable response, rendered result,
or persisted effect instead.

## One claim per test

Make one observable behaviour claim per test, and name the test after that behaviour so its failure says what stopped working. Do not name tests after an internal method, component, class, or implementation path.

Set up all data each test needs and clean up its effects. Tests must be
independent of test order: a test passes alone, in parallel, and after another
test changes the suite.
