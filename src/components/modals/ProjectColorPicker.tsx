'use client';

import React, { useEffect, useRef, useState } from 'react';

const DEFAULT_COLORS = ['#195de6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const MAX_COLORS = 15;

interface ProjectColorPickerProps {
    value: string;
    onChange: (color: string) => void;
    disabled?: boolean;
}

const ProjectColorPicker: React.FC<ProjectColorPickerProps> = ({ value, onChange, disabled = false }) => {
    const [colors, setColors] = useState<string[]>(() => {
        if (!DEFAULT_COLORS.map(c => c.toLowerCase()).includes(value.toLowerCase())) {
            return [...DEFAULT_COLORS, value];
        }
        return [...DEFAULT_COLORS];
    });

    const wheelRef = useRef<HTMLInputElement>(null);
    // Stable ref so the native event listener always has the latest onChange without re-registration
    const onChangeRef = useRef(onChange);
    useEffect(() => { onChangeRef.current = onChange; });

    // Attach native DOM 'change' event — fires once when the OS color picker is dismissed,
    // unlike React's onChange which maps to 'input' and fires on every drag step.
    useEffect(() => {
        const el = wheelRef.current;
        if (!el) return;

        const onCommit = (e: Event) => {
            const picked = (e.target as HTMLInputElement).value;
            setColors(prev => {
                if (prev.map(c => c.toLowerCase()).includes(picked.toLowerCase())) return prev;
                const next = [...prev, picked];
                if (next.length > MAX_COLORS) next.shift();
                return next;
            });
            onChangeRef.current(picked);
        };

        el.addEventListener('change', onCommit);
        return () => el.removeEventListener('change', onCommit);
    }, []); // empty — el is stable after mount

    // Live preview while dragging in the picker
    const handleWheelInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled) return;
        onChangeRef.current(e.target.value);
    };

    const handleDelete = (colorToDelete: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (disabled) return;
        const next = colors.filter(c => c.toLowerCase() !== colorToDelete.toLowerCase());
        setColors(next);
        if (value.toLowerCase() === colorToDelete.toLowerCase()) {
            onChangeRef.current(next[0] ?? DEFAULT_COLORS[0]);
        }
    };

    return (
        <div className="space-y-2">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Brand Color</label>
            {/* pt-1.5 pr-1.5 give the -top-1 -right-1 delete badges room so overflow-y-auto doesn't clip them */}
            <div className="flex flex-wrap gap-2 max-h-[5.5rem] overflow-y-auto custom-scrollbar pt-1.5 pr-1.5 pb-1">
                {colors.map(c => {
                    const isSelected = value.toLowerCase() === c.toLowerCase();
                    return (
                        <div key={c} className="relative group shrink-0">
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => { if (!disabled) onChange(c); }}
                                aria-label={`Select project color ${c}`}
                                aria-pressed={isSelected}
                                className={`size-7 rounded-lg transition-all bg-(--swatch-color) disabled:cursor-not-allowed disabled:opacity-60 ${isSelected ? 'ring-4 ring-primary/20 scale-110 shadow-lg' : disabled ? '' : 'hover:scale-105'}`}
                                style={{ '--swatch-color': c } as React.CSSProperties}
                            >
                                {isSelected && (
                                    <span className="material-symbols-outlined text-white text-[13px] font-bold flex items-center justify-center">check</span>
                                )}
                            </button>

                            {colors.length > 1 && (
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={(e) => handleDelete(c, e)}
                                    aria-label={`Remove color ${c}`}
                                    className="cursor-pointer absolute -top-1 -right-1 size-3.5 rounded-full bg-gray-900 border border-white/30 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:border-red-500 transition-all z-10 disabled:hidden"
                                >
                                    <span className="text-[9px] font-black leading-none select-none">✕</span>
                                </button>
                            )}
                        </div>
                    );
                })}

                {/* Color wheel trigger */}
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => { if (!disabled) wheelRef.current?.click(); }}
                    title="Pick a custom color"
                    aria-label="Open color wheel"
                    className="size-7 rounded-lg border-2 border-dashed border-border-dark hover:border-white/30 flex items-center justify-center text-text-secondary hover:text-white transition-all shrink-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border-dark disabled:hover:text-text-secondary"
                >
                    <span className="material-symbols-outlined text-[16px]">palette</span>
                </button>

                {/* Hidden native color input. React onChange = DOM 'input' (live drag preview).
                    Commit-on-dismiss is handled by the native 'change' listener in useEffect. */}
                <input
                    ref={wheelRef}
                    type="color"
                    defaultValue={value}
                    onChange={handleWheelInput}
                    disabled={disabled}
                    className="sr-only"
                    aria-hidden="true"
                    tabIndex={-1}
                />
            </div>
        </div>
    );
};

export default ProjectColorPicker;
