import { useEffect, useState } from "react";

import type { SavedRecipe } from "../lib/workspaceState";

interface RecipeLibraryProps {
  recipes: SavedRecipe[];
  selectedRecipeId: string;
  onSelectedRecipeIdChange: (id: string) => void;
  onSave: () => void;
  onApply: (recipe: SavedRecipe) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function RecipeLibrary({
  recipes,
  selectedRecipeId,
  onSelectedRecipeIdChange,
  onSave,
  onApply,
  onRename,
  onDelete,
}: RecipeLibraryProps) {
  const selectedRecipe = recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null;
  const [renameValue, setRenameValue] = useState(selectedRecipe?.name ?? "");
  useEffect(() => setRenameValue(selectedRecipe?.name ?? ""), [selectedRecipe]);
  const normalizedRename = renameValue.trim();
  return (
    <section className="sidebar-utility-section" aria-labelledby="saved-recipes-heading">
      <div>
        <p className="eyebrow">Reusable setup</p>
        <h3 id="saved-recipes-heading">Saved recipes</h3>
        <p>Save this split → subgroup → sort configuration and apply it to another source.</p>
      </div>
      <button type="button" className="secondary-button w-full" onClick={onSave}>
        Save current recipe
      </button>
      {recipes.length > 0 ? (
        <div className="space-y-2">
          <label className="control-field">
            <span>Recipe history</span>
            <select
              value={selectedRecipeId}
              onChange={(event) => onSelectedRecipeIdChange(event.target.value)}
            >
              <option value="">Choose a saved recipe…</option>
              {recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>{recipe.name}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <button
              type="button"
              className="primary-button"
              disabled={!selectedRecipe}
              onClick={() => selectedRecipe && onApply(selectedRecipe)}
            >
              Apply recipe
            </button>
            <button
              type="button"
              className="compact-button"
              disabled={!selectedRecipe}
              onClick={() => selectedRecipe && onDelete(selectedRecipe.id)}
            >
              Delete
            </button>
          </div>
          {selectedRecipe && (
            <div className="recipe-rename-row">
              <label className="control-field">
                <span>Recipe name</span>
                <input
                  value={renameValue}
                  maxLength={100}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="compact-button"
                disabled={!normalizedRename || normalizedRename === selectedRecipe.name}
                onClick={() => onRename(selectedRecipe.id, normalizedRename)}
              >
                Rename
              </button>
            </div>
          )}
          {selectedRecipe && (
            <small className="block text-[9px] leading-4 text-mist/40">
              Saved {new Date(selectedRecipe.savedAt).toLocaleString()}
            </small>
          )}
        </div>
      ) : (
        <p className="sidebar-empty-copy">No saved recipes yet.</p>
      )}
    </section>
  );
}
