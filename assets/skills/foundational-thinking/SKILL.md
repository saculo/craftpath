---
name: foundational-thinking
description: An engineering principle — settle the data shapes first, and build the scaffold before the detail. Load it whenever you plan work or start implementing something new. What the data looks like and how the parts connect decide most of what follows; get those right before filling anything in.
---

# Foundational thinking

Settle the data shapes first. Then build the scaffold before the detail: the
parts connected end to end, thinly, before any one of them is finished.

## Why

The shape of the data -- what is stored, what crosses a boundary, what a
function takes and returns -- decides most of the code around it. Change it
late and every piece built on the old shape changes too. A scaffold that runs
end to end shows early whether the parts fit; detail built first, in isolation,
is detail that may have to be rebuilt once it meets the rest.

## In practice

- Before the logic, write down the types, records or messages the work reads
  and writes, and check them against every criterion that touches them.
- Make the shape say what is allowed: a value that cannot be missing is not
  optional, two states that cannot both hold are not two flags.
- Wire the path through first -- input to output, thinly -- and see it run, then
  fill in each part.
- When a criterion does not fit the shape, change the shape now rather than
  working around it later.
