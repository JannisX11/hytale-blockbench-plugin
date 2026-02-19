//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";
import { qualifiesAsMainShape } from "./util";

declare global {
	const StateMemory: any
}

/**
 * Compact View: Hides "main shape" cubes from the outliner to reduce clutter.
 * Main shapes are cubes with rotation [0,0,0] that are the only cube in their group.
 * When clicking a hidden cube's mesh, selection redirects to the parent group.
 * Groups with no visible children have their expand arrows hidden.
 */

const HIDDEN_CLASS = 'hytale_main_shape_hidden';
const EMPTY_GROUP_CLASS = 'hytale_empty_group';
let compactViewActive = false;
let hiddenUUIDs = new Set<string>();
let emptyGroupUUIDs = new Set<string>();
let visibilityUpdatePending = false;
let outlinerObserver: MutationObserver | null = null;

function scheduleVisibilityUpdate() {
	if (!compactViewActive || visibilityUpdatePending) return;
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
		if (compactViewActive) {
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
 * - It's NOT involved in cube-to-cube parenting (parent or child is a cube)
 */
function getMainShapeUUIDs(): string[] {
	let uuids: string[] = [];

	for (let group of Group.all) {
		let cubes = group.children.filter(c => c instanceof Cube) as Cube[];
		// Only hide if single cube that qualifies as main shape
		if (cubes.length === 1 && qualifiesAsMainShape(cubes[0])) {
			const cube = cubes[0];
			// Don't hide if cube has cube children (is a parent in cube-to-cube)
			const hasCubeChildren = cube.children?.some(c => c instanceof Cube);
			if (!hasCubeChildren) {
				uuids.push(cube.uuid);
			}
		}
	}

	// Also check root-level cubes with no rotation
	for (let element of Outliner.root) {
		if (element instanceof Cube && element.rotation.allEqual(0)) {
			// Don't hide if cube has cube children
			const hasCubeChildren = element.children?.some(c => c instanceof Cube);
			if (!hasCubeChildren) {
				uuids.push(element.uuid);
			}
		}
	}

	return uuids;
}

/**
 * Finds groups that have no visible children in compact view.
 * A group is "empty" if all its direct children are hidden cubes (no sub-groups, no visible cubes).
 */
function getEmptyGroupUUIDs(hiddenCubes: Set<string>): string[] {
	let emptyGroups = new Set<string>();

	for (let group of Group.all) {
		let hasVisibleChild = false;

		for (let child of group.children) {
			if (child instanceof Group) {
				// Sub-groups are always visible in outliner
				hasVisibleChild = true;
				break;
			} else if (child instanceof Cube) {
				// Cube is visible if not hidden
				if (!hiddenCubes.has(child.uuid)) {
					hasVisibleChild = true;
					break;
				}
			}
		}

		if (!hasVisibleChild) {
			emptyGroups.add(group.uuid);
		}
	}

	return Array.from(emptyGroups);
}

/**
 * Apply or remove hidden/empty classes from outliner elements
 */
function applyVisibility() {
	if (!isHytaleFormat()) return;

	const outlinerNode = Panels.outliner?.node;
	if (!outlinerNode) return;

	if (!compactViewActive) {
		// Remove all classes when disabled
		outlinerNode.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => {
			el.classList.remove(HIDDEN_CLASS);
		});
		outlinerNode.querySelectorAll(`.${EMPTY_GROUP_CLASS}`).forEach(el => {
			el.classList.remove(EMPTY_GROUP_CLASS);
		});
		hiddenUUIDs.clear();
		emptyGroupUUIDs.clear();
		disconnectOutlinerObserver();
		return;
	}

	// Ensure observer is running when active
	setupOutlinerObserver();

	// Calculate which cubes should be hidden
	hiddenUUIDs = new Set(getMainShapeUUIDs());

	// Calculate which groups have no visible children
	emptyGroupUUIDs = new Set(getEmptyGroupUUIDs(hiddenUUIDs));

	// Apply hidden class to cubes
	for (let uuid of hiddenUUIDs) {
		let node = outlinerNode.querySelector(`[id="${uuid}"]`);
		if (node && !node.classList.contains(HIDDEN_CLASS)) {
			node.classList.add(HIDDEN_CLASS);
		}
	}

	// Apply empty group class to groups with no visible children
	for (let uuid of emptyGroupUUIDs) {
		let node = outlinerNode.querySelector(`[id="${uuid}"]`);
		if (node && !node.classList.contains(EMPTY_GROUP_CLASS)) {
			node.classList.add(EMPTY_GROUP_CLASS);
		}
	}

	// Remove empty group class from groups that now have visible children
	outlinerNode.querySelectorAll(`.${EMPTY_GROUP_CLASS}`).forEach(el => {
		if (!emptyGroupUUIDs.has(el.id)) {
			el.classList.remove(EMPTY_GROUP_CLASS);
		}
	});
}

export function setupCompactView() {
	// CSS for hiding elements and expand arrows on empty groups
	let style = Blockbench.addCSS(`
		.outliner_node.${HIDDEN_CLASS} {
			display: none !important;
		}
		.outliner_node.${EMPTY_GROUP_CLASS} i.icon-open-state {
			visibility: hidden !important;
			pointer-events: none;
		}
	`);

	// Selection redirect: clicking a hidden main shape selects its parent group
	const originalSelect = Cube.prototype.select;
	Cube.prototype.select = function(event?: any, isOutlinerClick?: boolean) {
		if (compactViewActive && hiddenUUIDs.has(this.uuid) && this.parent instanceof Group) {
			return this.parent.select(event, isOutlinerClick);
		}
		return originalSelect.call(this, event, isOutlinerClick);
	};

	// Initialize state from StateMemory
	StateMemory.init('hytale_compact_view', 'boolean');
	compactViewActive = StateMemory.get('hytale_compact_view') ?? false;

	// Create toggle for outliner toolbar
	let toggle = new Toggle('toggle_compact_view', {
		name: 'Compact View',
		description: 'Hide main shapes, work with bones directly',
		icon: 'fa-compress',
		category: 'view',
		condition: { formats: FORMAT_IDS },
		default: compactViewActive,
		onChange(value) {
			compactViewActive = value;
			StateMemory.set('hytale_compact_view', value);
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
	if (compactViewActive) {
		setTimeout(applyVisibility, 100);
	}

	track(toggle, hookFinishedEdit, hookSelectMode, hookSelection, style, {
		delete() {
			// Restore original select method
			Cube.prototype.select = originalSelect;
			// Disconnect observer
			disconnectOutlinerObserver();
			// Remove all classes from elements
			Panels.outliner?.node?.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => {
				el.classList.remove(HIDDEN_CLASS);
			});
			Panels.outliner?.node?.querySelectorAll(`.${EMPTY_GROUP_CLASS}`).forEach(el => {
				el.classList.remove(EMPTY_GROUP_CLASS);
			});
		}
	});
}
