module SearchAboutTargets where

open import SearchAboutSupport

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

data List (A : Set) : Set where
  []   : List A
  _::_ : A -> List A -> List A

idNat : Nat -> Nat
idNat n = n

double : Nat -> Nat
double zero = zero
double (suc n) = suc (suc (double n))

headOr : {A : Set} -> A -> List A -> A
headOr fallback [] = fallback
headOr fallback (x :: xs) = x

safeHead : {A : Set} -> List A -> Maybe A
safeHead [] = nothing
safeHead (x :: xs) = just x

mapDoubleMaybe : Maybe Nat -> Maybe Nat
mapDoubleMaybe = mapMaybe double
