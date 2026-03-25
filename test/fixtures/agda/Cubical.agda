{-# OPTIONS --cubical #-}

module Cubical where

open import Agda.Primitive
open import Agda.Primitive.Cubical

-- Path type is built-in with --cubical
myRefl : {A : Set} {x : A} → PathP (λ _ → A) x x
myRefl {x = x} = λ _ → x
