module FixtureDeps.Chain.Types where

data Bool : Set where
  true  : Bool
  false : Bool

data List (A : Set) : Set where
  []  : List A
  _∷_ : A → List A → List A

infixr 5 _∷_
