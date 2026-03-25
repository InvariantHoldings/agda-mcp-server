module UniverseLevels where

open import Agda.Primitive

-- Valid universe-polymorphic identity
id : {l : Level} {A : Set l} → A → A
id x = x

-- Valid universe-polymorphic composition
_∘_ : {a b c : Level} {A : Set a} {B : Set b} {C : Set c}
    → (B → C) → (A → B) → A → C
(g ∘ f) x = g (f x)

-- Valid: lifting between universe levels
record Lift {a : Level} (l : Level) (A : Set a) : Set (a ⊔ l) where
  constructor lift
  field lower : A
