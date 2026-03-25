module InstanceArgs where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

data Bool : Set where
  true  : Bool
  false : Bool

-- Type class via instance arguments
record Show (A : Set) : Set where
  field
    show : A → Nat  -- simplified: map to Nat instead of String

open Show {{...}}

instance
  showNat : Show Nat
  Show.show showNat n = n

  showBool : Show Bool
  Show.show showBool true  = suc zero
  Show.show showBool false = zero

-- Instance search resolves the Show instance
test : Nat
test = show true
