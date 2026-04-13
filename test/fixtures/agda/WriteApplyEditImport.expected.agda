module WriteApplyEditImport where

open import Agda.Primitive

-- Body uses Set directly — scenario is "agent adds an import to a
-- file that currently has none". The fixture exists to verify that
-- applyTextEdit inserts text at a unique anchor without disturbing
-- surrounding content.

myType : Set₁
myType = Set
