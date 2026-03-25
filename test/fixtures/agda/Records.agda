module Records where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- Record type with eta-equality
record Pair (A B : Set) : Set where
  constructor _,_
  field
    fst : A
    snd : B

-- Copattern definition
swap : {A B : Set} → Pair A B → Pair B A
Pair.fst (swap p) = Pair.snd p
Pair.snd (swap p) = Pair.fst p

example : Pair Nat Nat
example = zero , suc zero
