-- Agda successfully infers _ as Nat from context
module InferredMeta where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- _ is inferred as Nat from the return type and f's domain
inferred : (Nat → Nat) → Nat
inferred f = f _
