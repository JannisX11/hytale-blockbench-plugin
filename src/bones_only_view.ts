//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";
import { qualifiesAsMainShape } from "./util";

declare global {
	const StateMemory: any
}

/**
 * Bones View: Hides "main shape" cubes from the outliner to reduce clutter.
 * Main shapes are cubes with rotation [0,0,0] that are the only cube in their group.
 * When clicking a hidden cube's mesh, selection redirects to the parent group.
 */

const HIDDEN_CLASS = 'hytale_main_shape_hidden';
let bonesViewActive = false;
let hiddenUUIDs = new Set<string>();
let visibilityUpdatePending = false;
let outlinerObserver: MutationObserver | null = null;

function scheduleVisibilityUpdate() {
	if (!bonesViewActive || visibilityUpdatePending) return;
	visibilityUpdatePending = true;
	requestAnimationFrame(() => {
		visibilityUpdatePending = false;
		applyVisibility();
	});
}

/**
 * Setup MutationObserver to catch outliner DOM re-renders (e.g. group expand/collapse)
 */
function setupOutlinerObserver() {
	if (outlinerObserver) return;

	const outlinerNode = Panels.outliner?.node;
	if (!outlinerNode) return;

	outlinerObserver = new MutationObserver(() => {
		if (bonesViewActive) {
			scheduleVisibilityUpdate();
		}
	});

	outlinerObserver.observe(outlinerNode, {
		childList: true,
		subtree: true
	});
}

function disconnectOutlinerObserver() {
	if (outlinerObserver) {
		outlinerObserver.disconnect();
		outlinerObserver = null;
	}
}

/**
 * Finds cubes that qualify as "main shapes" and should be hidden.
 * A cube is hidden if:
 * - It has rotation = [0, 0, 0]
 * - It's the only cube in its parent group
 */
function getMainShapeUUIDs(): string[] {
	let uuids: string[] = [];

	for (let group of Group.all) {
		let cubes = group.children.filter(c => c instanceof Cube) as Cube[];
		// Only hide if single cube that qualifies as main shape
		if (cubes.length === 1 && qualifiesAsMainShape(cubes[0])) {
			uuids.push(cubes[0].uuid);
		}
	}

	// Also check root-level cubes with no rotation
	for (let element of Outliner.root) {
		if (element instanceof Cube && element.rotation.allEqual(0)) {
			uuids.push(element.uuid);
		}
	}

	return uuids;
}

/**
 * Apply or remove hidden class from main shape elements
 */
function applyVisibility() {
	if (!isHytaleFormat()) return;

	const outlinerNode = Panels.outliner?.node;
	if (!outlinerNode) return;

	if (!bonesViewActive) {
		// Remove hidden class from all elements
		outlinerNode.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => {
			el.classList.remove(HIDDEN_CLASS);
		});
		hiddenUUIDs.clear();
		disconnectOutlinerObserver();
		return;
	}

	// Ensure observer is running when active
	setupOutlinerObserver();

	// Calculate which cubes should be hidden
	hiddenUUIDs = new Set(getMainShapeUUIDs());

	// Apply hidden class to elements that don't already have it
	for (let uuid of hiddenUUIDs) {
		let node = outlinerNode.querySelector(`[id="${uuid}"]`);
		if (node && !node.classList.contains(HIDDEN_CLASS)) {
			node.classList.add(HIDDEN_CLASS);
		}
	}
}

export function setupBonesOnlyView() {
	// CSS for hiding elements
	let style = Blockbench.addCSS(`
		.outliner_node.${HIDDEN_CLASS} {
			display: none !important;
		}
	`);

	// Selection redirect: clicking a hidden main shape selects its parent group
	const originalSelect = Cube.prototype.select;
	Cube.prototype.select = function(event?: any, isOutlinerClick?: boolean) {
		if (bonesViewActive && hiddenUUIDs.has(this.uuid) && this.parent instanceof Group) {
			return this.parent.select(event, isOutlinerClick);
		}
		return originalSelect.call(this, event, isOutlinerClick);
	};

	// Initialize state from StateMemory
	StateMemory.init('hytale_bones_view', 'boolean');
	bonesViewActive = StateMemory.get('hytale_bones_view') ?? false;

	// Create toggle for outliner toolbar
	let toggle = new Toggle('toggle_bones_view', {
		name: 'Bones View',
		description: 'Hide main shapes, work with bones directly',
		icon: 'fa-bone',
		category: 'view',
		condition: { formats: FORMAT_IDS },
		default: bonesViewActive,
		onChange(value) {
			bonesViewActive = value;
			StateMemory.set('hytale_bones_view', value);
			applyVisibility();
		}
	});

	// Add to outliner toolbar
	let outlinerPanel = Panels.outliner;
	if (outlinerPanel && outlinerPanel.toolbars.length > 0) {
		outlinerPanel.toolbars[0].add(toggle, -1);
	}

	// Refresh visibility when outliner updates (debounced)
	let hookFinishedEdit = Blockbench.on('finished_edit', scheduleVisibilityUpdate);
	let hookSelectMode = Blockbench.on('select_mode', scheduleVisibilityUpdate);
	let hookSelection = Blockbench.on('update_selection', scheduleVisibilityUpdate);

	// Initial application
	if (bonesViewActive) {
		setTimeout(applyVisibility, 100);
	}

	track(toggle, hookFinishedEdit, hookSelectMode, hookSelection, style, {
		delete() {
			// Restore original select method
			Cube.prototype.select = originalSelect;
			// Disconnect observer
			disconnectOutlinerObserver();
			// Remove hidden class from all elements
			Panels.outliner?.node?.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => {
				el.classList.remove(HIDDEN_CLASS);
			});
		}
	});
}
