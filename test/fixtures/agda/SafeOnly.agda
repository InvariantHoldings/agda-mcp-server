{-# OPTIONS --safe #-}

module SafeOnly where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- Safe: no postulates, no unsafe pragmas
pred : Nat → Nat
pred zero    = zero
pred (suc n) = n
