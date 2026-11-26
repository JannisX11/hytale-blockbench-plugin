import { track } from "./cleanup";
import { commitPivotFollow, resumePivotFollow } from "./pivot_control";

/**
 * Blender-style Alt+drag duplication for the move gizmo.
 * Each Alt press creates a combined undo entry (duplication + movement).
 */
export function setupAltDuplicate() {
    const keybindItem = new KeybindItem('hytale_duplicate_drag_modifier', {
        name: 'Duplicate While Dragging',
        description: 'Hold this key while dragging the gizmo to duplicate',
        keybind: new Keybind({ key: 18 }),
        category: 'edit'
    });
    track(keybindItem);

    let isDragging = false;
    let modifierWasPressed = false;

    // Combined undo state - merges duplication + movement into single entry
    let isCombinedUndoActive = false;
    let combinedUndoCubesBefore = 0;
    let combinedUndoGroups: Group[] = [];
    // Originals listed by a taken-over Transformer edit; kept in "after" so redo doesn't delete them
    let combinedUndoOriginals: { elements: OutlinerElement[], groups: Group[] } = { elements: [], groups: [] };
    let originalInitEdit: typeof Undo.initEdit | null = null;
    let originalFinishEdit: typeof Undo.finishEdit | null = null;

    function isModifierPressed(event: MouseEvent | KeyboardEvent): boolean {
        const kb = keybindItem.keybind;
        if (kb.key === 18 || kb.alt) return event.altKey || Pressing.overrides.alt;
        if (kb.key === 17 || kb.ctrl) return event.ctrlKey || Pressing.overrides.ctrl;
        if (kb.key === 16 || kb.shift) return event.shiftKey || Pressing.overrides.shift;
        if (kb.key === 91 || kb.ctrl) return event.metaKey || Pressing.overrides.ctrl;
    }

    function isModifierKey(event: KeyboardEvent): boolean {
        const kb = keybindItem.keybind;
        return event.keyCode === kb.key ||
            (event.key === 'Alt' && (kb.key === 18 || kb.alt)) ||
            (event.key === 'Control' && (kb.key === 17 || kb.ctrl)) ||
            (event.key === 'Shift' && (kb.key === 16 || kb.shift));
    }

    // Duplication logic follows native Blockbench patterns from outliner.js
    function duplicateGroups(): Group[] {
        const allNewGroups: Group[] = [];
        const oldSelectedGroups = Group.multi_selected.slice();
        Group.multi_selected.empty();

        for (const group of oldSelectedGroups) {
            group.selected = false;
            const newGroup = group.duplicate();
            // Collect all nested child groups for proper undo tracking
            newGroup.forEachChild((g: Group) => allNewGroups.push(g), Group, true);
            newGroup.multiSelect();
            allNewGroups.push(newGroup);
        }
        return allNewGroups;
    }

    function duplicateElements(): void {
        Outliner.selected.slice().forEach((obj, i) => {
            if (obj.parent instanceof OutlinerElement && (obj.parent as any).selected) return;
            Outliner.selected[i] = obj.duplicate();
        });
    }

    // Duplicates and temporarily disables Undo methods.
    // Transformer can't create a separate undo entry: restored in finishCombinedUndo().
    function performDuplicationForCombinedUndo(): boolean {
        const hasGroups = Group.all.some(g => g.selected);
        const hasElements = Outliner.selected.length > 0;
        if (!hasGroups && !hasElements) return false;

        combinedUndoCubesBefore = Outliner.elements.length;
        combinedUndoGroups = [];

        originalInitEdit = Undo.initEdit.bind(Undo);
        originalFinishEdit = Undo.finishEdit.bind(Undo);

        // Alt pressed mid-drag: take over the Transformer's open edit so the originals' move stays undoable
        const openAspects = Undo.current_save?.aspects;
        combinedUndoOriginals = {
            elements: openAspects?.elements?.slice() ?? [],
            groups: openAspects?.groups?.slice() ?? []
        };
        if (!openAspects) {
            originalInitEdit({ outliner: true, elements: [], groups: [], selection: true });
        }

        // Block Transformer from creating its own undo entry
        // @ts-expect-error
        Undo.initEdit = () => {};
        // @ts-expect-error
        Undo.finishEdit = () => {};

        if (hasGroups) {
            combinedUndoGroups = duplicateGroups();
        } else {
            duplicateElements();
        }

        updateSelection();
        isCombinedUndoActive = true;
        return true;
    }

    function finishCombinedUndo(): void {
        if (!isCombinedUndoActive) return;
        isCombinedUndoActive = false;

        if (originalInitEdit) Undo.initEdit = originalInitEdit;
        if (originalFinishEdit) Undo.finishEdit = originalFinishEdit;
        originalInitEdit = null;
        originalFinishEdit = null;

        Undo.finishEdit('Duplicate and move', {
            outliner: true,
            elements: [...combinedUndoOriginals.elements, ...Outliner.elements.slice(combinedUndoCubesBefore)],
            groups: [...combinedUndoOriginals.groups, ...combinedUndoGroups],
            selection: true
        });
        combinedUndoOriginals = { elements: [], groups: [] };
    }

    function onMouseDown(event: MouseEvent) {
        if (isCombinedUndoActive) return; // Ignore re-dispatched event

        const axis = Transformer?.axis;
        const hasSelection = Outliner.selected.length > 0 || Group.all.some(g => g.selected);
        const isTransformTool = Toolbox.selected?.id === 'move_tool' || Toolbox.selected?.id === 'rotate_tool';

        if (!axis || !hasSelection || !isTransformTool || !Modes.edit) return;

        if (isModifierPressed(event)) {
            event.stopImmediatePropagation();
            if (!performDuplicationForCombinedUndo()) return;

            isDragging = true;
            modifierWasPressed = true;

            // Re-dispatch so Transformer starts drag on new selection
            setTimeout(() => {
                (event.target as EventTarget)?.dispatchEvent(new PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    button: event.button,
                    buttons: event.buttons,
                    view: window,
                    pointerId: 1,
                    pointerType: 'mouse'
                }));
            }, 0);
        } else {
            isDragging = true;
            modifierWasPressed = false;
        }
    }

    function onKeyDown(event: KeyboardEvent) {
        if (!isDragging || !isModifierKey(event) || modifierWasPressed) return;
        const isTransformTool = Toolbox.selected?.id === 'move_tool' || Toolbox.selected?.id === 'rotate_tool';
        if (!isTransformTool || !Modes.edit) return;

        modifierWasPressed = true;

        // Settle pivots on the cubes being left behind, before they're copied
        commitPivotFollow();

        if (isCombinedUndoActive) finishCombinedUndo();
        performDuplicationForCombinedUndo();
        resumePivotFollow();
    }

    function onKeyUp(event: KeyboardEvent) {
        if (isModifierKey(event)) modifierWasPressed = false;
    }

    function onMouseUp() {
        isDragging = false;
        modifierWasPressed = false;

        // Defer to run after Transformer finalizes positions
        if (isCombinedUndoActive) setTimeout(finishCombinedUndo, 0);
    }

    const events: [string, EventListener][] = [
        ['pointerdown', onMouseDown as EventListener],
        ['pointerup', onMouseUp as EventListener],
        ['mouseup', onMouseUp as EventListener],
        ['keydown', onKeyDown as EventListener],
        ['keyup', onKeyUp as EventListener]
    ];

    events.forEach(([type, handler]) => document.addEventListener(type, handler, true));
    track({ delete: () => events.forEach(([type, handler]) => document.removeEventListener(type, handler, true)) });
}
