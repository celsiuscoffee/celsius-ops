"use client";

import { Plus, Trash2, GripVertical } from "lucide-react";

export interface ModifierOption {
  id: string;
  label: string;
  priceDelta: number;
  isDefault: boolean;
}

export type ModifierChannel = "pos" | "pickup" | "grab" | "foodpanda" | "dinein";

// Channels the customer / cashier can see this modifier group on.
// Empty / missing = show everywhere (backward compatible with pre-channel data).
export interface ModifierGroup {
  id: string;
  name: string;
  multiSelect: boolean;
  options: ModifierOption[];
  channels?: ModifierChannel[];
}

const CHANNELS: { value: ModifierChannel; label: string }[] = [
  { value: "pos",       label: "POS" },
  { value: "pickup",    label: "Pickup" },
  { value: "grab",      label: "GrabFood" },
  { value: "foodpanda", label: "Foodpanda" },
  { value: "dinein",    label: "Dine-in" },
];

// Local id generator — modifier groups/options live as jsonb on the product
// row, so they don't have DB-generated ids. A short random suffix is enough
// to keep React keys + hidden_modifier_ids stable across edits.
function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

interface Props {
  value: ModifierGroup[];
  onChange: (next: ModifierGroup[]) => void;
}

export function ModifierGroupsEditor({ value, onChange }: Props) {
  const groups = value ?? [];

  const updateGroup = (idx: number, patch: Partial<ModifierGroup>) => {
    onChange(groups.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  };

  const updateOption = (gIdx: number, oIdx: number, patch: Partial<ModifierOption>) => {
    onChange(groups.map((g, i) =>
      i === gIdx
        ? { ...g, options: g.options.map((o, j) => (j === oIdx ? { ...o, ...patch } : o)) }
        : g,
    ));
  };

  const addGroup = () => {
    onChange([
      ...groups,
      { id: uid("mg"), name: "", multiSelect: false, options: [] },
    ]);
  };

  const removeGroup = (idx: number) => {
    onChange(groups.filter((_, i) => i !== idx));
  };

  const moveGroup = (idx: number, dir: -1 | 1) => {
    const next = [...groups];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  const addOption = (gIdx: number) => {
    onChange(groups.map((g, i) =>
      i === gIdx
        ? { ...g, options: [...g.options, { id: uid("mo"), label: "", priceDelta: 0, isDefault: false }] }
        : g,
    ));
  };

  const removeOption = (gIdx: number, oIdx: number) => {
    onChange(groups.map((g, i) =>
      i === gIdx ? { ...g, options: g.options.filter((_, j) => j !== oIdx) } : g,
    ));
  };

  return (
    <div className="space-y-3">
      {groups.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No modifier groups yet. Add one to let customers customise this item (e.g. Milk, Sweetness, Add-ons).
        </p>
      )}

      {groups.map((group, gIdx) => (
        <div key={group.id} className="border rounded-xl p-3 bg-muted/10 space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => moveGroup(gIdx, -1)}
                disabled={gIdx === 0}
                className="text-muted-foreground hover:text-[#160800] disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move up"
              >
                <GripVertical className="h-3 w-3 -mb-1 rotate-90" />
              </button>
              <button
                type="button"
                onClick={() => moveGroup(gIdx, 1)}
                disabled={gIdx === groups.length - 1}
                className="text-muted-foreground hover:text-[#160800] disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move down"
              >
                <GripVertical className="h-3 w-3 -mt-1 -rotate-90" />
              </button>
            </div>
            <input
              type="text"
              value={group.name}
              onChange={(e) => updateGroup(gIdx, { name: e.target.value })}
              placeholder="Group name (e.g. Milk)"
              className="flex-1 px-3 py-1.5 border rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                checked={group.multiSelect}
                onChange={(e) => updateGroup(gIdx, { multiSelect: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#160800]"
              />
              Multi-select
            </label>
            <button
              type="button"
              onClick={() => removeGroup(gIdx)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Remove group"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Channels — leave all unchecked = show everywhere */}
          <div className="pl-5 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Show on:
            </span>
            {CHANNELS.map(({ value, label }) => {
              const selected = group.channels ?? [];
              const on = selected.length === 0 || selected.includes(value);
              const allSelected = selected.length === 0;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    // Toggle channel. If toggling makes the set equal to "all
                    // channels", normalise to undefined (show-everywhere).
                    const allValues = CHANNELS.map((c) => c.value);
                    const current = allSelected ? allValues : [...selected];
                    const next = current.includes(value)
                      ? current.filter((c) => c !== value)
                      : [...current, value];
                    const normalised = next.length === 0 || next.length === allValues.length
                      ? undefined
                      : (next as ModifierChannel[]);
                    updateGroup(gIdx, { channels: normalised });
                  }}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    on
                      ? "bg-[#160800] text-white border-[#160800]"
                      : "bg-white text-muted-foreground border-gray-200 hover:border-[#160800]"
                  }`}
                  title={allSelected ? "All channels (default)" : on ? `Visible on ${label}` : `Hidden on ${label}`}
                >
                  {label}
                </button>
              );
            })}
            {(group.channels?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => updateGroup(gIdx, { channels: undefined })}
                className="text-[11px] text-muted-foreground hover:text-[#160800] underline"
                title="Reset to all channels"
              >
                reset
              </button>
            )}
          </div>

          {/* Options */}
          <div className="space-y-1.5 pl-5">
            {group.options.length === 0 && (
              <p className="text-[11px] text-muted-foreground italic">No options yet.</p>
            )}
            {group.options.map((opt, oIdx) => (
              <div key={opt.id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={opt.label}
                  onChange={(e) => updateOption(gIdx, oIdx, { label: e.target.value })}
                  placeholder="Option label (e.g. Oat Milk)"
                  className="flex-1 px-2.5 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <div className="relative w-24">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">+RM</span>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={opt.priceDelta}
                    onChange={(e) => updateOption(gIdx, oIdx, { priceDelta: Number(e.target.value) || 0 })}
                    className="w-full pl-9 pr-2 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={opt.isDefault}
                    onChange={(e) => updateOption(gIdx, oIdx, { isDefault: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[#160800]"
                  />
                  Default
                </label>
                <button
                  type="button"
                  onClick={() => removeOption(gIdx, oIdx)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Remove option"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addOption(gIdx)}
              className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-[#160800] transition-colors"
            >
              <Plus className="h-3 w-3" /> Add option
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addGroup}
        className="flex items-center gap-1.5 text-sm font-semibold text-[#160800] hover:text-[#2d1100] transition-colors"
      >
        <Plus className="h-4 w-4" /> Add modifier group
      </button>
    </div>
  );
}
