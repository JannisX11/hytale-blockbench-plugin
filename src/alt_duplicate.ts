import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";

/**
 * Implements Blender-style Alt+drag duplication for the transform gizmo.
 * Duplicates selection and transfers the drag operation to the new elements.
 */
export function setupAltDuplicate() {
    const action = new Action('hytale_duplicate_drag_modifier', {
        name: 'Duplicate While Dragging',
        icon: 'content_copy',
        category: 'edit',
        condition: { formats: FORMAT_IDS, modes: ['edit'] },
        keybind: new Keybind({ key: 18 }),
        click: () => Blockbench.showQuickMessage('Hold this key while dragging the gizmo to duplicate')
    });
    track(action);

    let isDragging = false;
    let modifierWasPressed = false;
    let justDuplicated = false;

    function isModifierPressed(event: MouseEvent | KeyboardEvent): boolean {
        const kb = action.keybind;
        if (kb.key === 18 || kb.alt) return event.altKey;
        if (kb.key === 17 || kb.ctrl) return event.ctrlKey;
        if (kb.key === 16 || kb.shift) return event.shiftKey;
        return Pressing.alt;
    }

    function isModifierKey(event: KeyboardEvent): boolean {
        const kb = action.keybind;
        return event.keyCode === kb.key ||
            (event.key === 'Alt' && (kb.key === 18 || kb.alt)) ||
            (event.key === 'Control' && (kb.key === 17 || kb.ctrl)) ||
            (event.key === 'Shift' && (kb.key === 16 || kb.shift));
    }

    function hasSelectedAncestor(node: OutlinerNode, selectedGroupUuids: Set<string>): boolean {
        let current = node.parent;
        while (current && current !== 'root') {
            if (current instanceof Group && selectedGroupUuids.has(current.uuid)) {
                return true;
            }
            current = (current as Group).parent;
        }
        return false;
    }

    function duplicateElement(element: OutlinerElement): OutlinerElement | null {
        const copy = element.getSaveCopy?.(true);
        if (!copy) return null;

        const newElement = OutlinerElement.fromSave(copy, false);
        if (!newElement) return null;

        newElement.init();
        if (element.parent && element.parent !== 'root') {
            newElement.addTo(element.parent);
        }
        return newElement;
    }

    function performDuplication(): boolean {
        const selectedGroups = Group.all.filter(g => g.selected);
        const selectedElements = [...selected];

        if (selectedElements.length === 0 && selectedGroups.length === 0) return false;

        const selectedGroupUuids = new Set(selectedGroups.map(g => g.uuid));
        const groupsToDuplicate = selectedGroups.filter(g => !hasSelectedAncestor(g, selectedGroupUuids));
        const elementsToDuplicate = selectedElements.filter(el => !hasSelectedAncestor(el, selectedGroupUuids));

        if (groupsToDuplicate.length === 0 && elementsToDuplicate.length === 0) return false;

        Undo.initEdit({ outliner: true, elements: selectedElements, selection: true });

        const newGroups: Group[] = [];
        const newElements: OutlinerElement[] = [];

        for (const group of groupsToDuplicate) {
            const dup = group.duplicate();
            newGroups.push(dup);
            dup.forEachChild(child => {
                if (child instanceof OutlinerElement) newElements.push(child);
            }, OutlinerElement, true);
        }

        for (const element of elementsToDuplicate) {
            const dup = duplicateElement(element);
            if (dup) newElements.push(dup);
        }

        unselectAllElements();
        Group.all.forEach(g => g.selected && (g.selected = false));

        newGroups.forEach((g, i) => g.select(i > 0 ? { shiftKey: true } : undefined));
        newElements
            .filter(el => !newGroups.some(g => g.contains(el)))
            .forEach(el => el.select({ shiftKey: true }, true));

        Canvas.updateView({
            elements: newElements,
            element_aspects: { transform: true, geometry: true },
            selection: true
        });

        Undo.finishEdit('Alt + Drag Duplicate', {
            outliner: true,
            elements: newElements,
            selection: true
        });

        return true;
    }

    function onMouseDown(event: MouseEvent) {
        // Guard against re-dispatched event to prevent infinite loop
        if (justDuplicated) {
            justDuplicated = false;
            return;
        }

        const axis = (Transformer as any)?.axis;
        const hasSelection = selected.length > 0 || Group.all.some(g => g.selected);

        if (axis && hasSelection && isModifierPressed(event)) {
            event.stopImmediatePropagation();
            modifierWasPressed = true;

            if (performDuplication()) {
                // Re-dispatch pointerdown so Transformer starts a fresh drag on the new selection.
                // Without this, groups duplicate but their pivot doesn't follow the transform.
                justDuplicated = true;
                setTimeout(() => {
                    (event.target as EventTarget)?.dispatchEvent(new MouseEvent('pointerdown', {
                        bubbles: true,
                        cancelable: true,
                        clientX: event.clientX,
                        clientY: event.clientY,
                        button: event.button,
                        buttons: event.buttons,
                        view: window
                    }));
                    isDragging = true;
                }, 0);
            }
        } else if (axis && hasSelection) {
            isDragging = true;
        }
    }

    function onKeyDown(event: KeyboardEvent) {
        if (isModifierKey(event) && isDragging && !modifierWasPressed) {
            modifierWasPressed = true;
            performDuplication();
        }
    }

    function onKeyUp(event: KeyboardEvent) {
        if (isModifierKey(event)) modifierWasPressed = false;
    }

    function onMouseUp() {
        if (isDragging) {
            isDragging = false;
            modifierWasPressed = false;
        }
    }

    const events: [string, EventListener][] = [
        ['pointerdown', onMouseDown as EventListener],
        ['mousedown', onMouseDown as EventListener],
        ['pointerup', onMouseUp as EventListener],
        ['mouseup', onMouseUp as EventListener],
        ['keydown', onKeyDown as EventListener],
        ['keyup', onKeyUp as EventListener]
    ];

    events.forEach(([type, handler]) => document.addEventListener(type, handler, true));

    track({
        delete: () => events.forEach(([type, handler]) => document.removeEventListener(type, handler, true))
    });
}
