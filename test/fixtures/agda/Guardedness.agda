{-# OPTIONS --guardedness #-}

module Guardedness where

open import Agda.Builtin.Coinduction

-- Coinductive stream using guardedness checking
record Stream (A : Set) : Set where
  coinductive
  field
    head : A
    tail : Stream A

open Stream

-- Guarded definition: repeat x = x ∷ repeat x
repeat : {A : Set} → A → Stream A
head (repeat x) = x
tail (repeat x) = repeat x
