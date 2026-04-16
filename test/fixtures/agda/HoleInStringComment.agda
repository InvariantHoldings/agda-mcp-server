module HoleInStringComment where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- These are NOT real holes — they are inside string literals and comments.

-- {!!} this is a comment with a hole-like marker
-- ? this is a comment with a question mark

{- Block comment with {!!} and ? inside -}

msg₁ : Nat
msg₁ = zero

msg₂ : Nat
msg₂ = suc zero
