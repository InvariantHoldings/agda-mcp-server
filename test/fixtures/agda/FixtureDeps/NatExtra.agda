module FixtureDeps.NatExtra where

open import FixtureDeps.NatCore

one : Nat
one = suc zero

two : Nat
two = add one one

inc : Nat -> Nat
inc n = suc n
