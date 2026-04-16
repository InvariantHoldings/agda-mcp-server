-- Stress test: postulates coexist with holes.
-- Postulates are complete definitions and must NOT appear in
-- visibleGoals or invisibleGoals. The hole should produce
-- ok-with-holes, not ok-complete.
module PostulateAndHole where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

postulate
  axiom : Nat → Nat

-- This is a real hole — the presence of a postulate should not
-- mask it or change the classification.
incomplete : Nat
incomplete = {!!}
