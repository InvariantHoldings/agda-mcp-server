module NestedModules where

module Inner where
  data Nat : Set where
    zero : Nat
    suc  : Nat -> Nat

  id : Nat -> Nat
  id n = n

open Inner public

outer : Nat -> Nat
outer = id
