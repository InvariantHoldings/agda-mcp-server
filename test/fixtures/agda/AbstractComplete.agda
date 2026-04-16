-- Stress test: abstract block with fully defined values (no holes).
-- This must be ok-complete — abstract blocks without holes should not
-- produce any invisible goals.
module AbstractComplete where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

abstract
  secret : Nat
  secret = suc (suc zero)

  double : Nat → Nat
  double zero    = zero
  double (suc n) = suc (suc (double n))

-- Public use of the abstract value.
result : Nat
result = double secret
