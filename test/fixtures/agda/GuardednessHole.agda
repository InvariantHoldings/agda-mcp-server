{-# OPTIONS --guardedness #-}

module GuardednessHole where

-- Coinductive stream with a hole for guarded definition
record Stream (A : Set) : Set where
  coinductive
  field
    head : A
    tail : Stream A

open Stream

-- Mapping over a stream — has a hole
mapStream : {A B : Set} → (A → B) → Stream A → Stream B
head (mapStream f s) = f (head s)
tail (mapStream f s) = {!!}
